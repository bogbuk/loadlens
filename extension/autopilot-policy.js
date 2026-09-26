/* LoadLens — политика авто-пилота: КОГДА тикать, МОЖНО ли перезагружать страницу и СКОЛЬКО
   доскролливать. Вынесено из content.js отдельным чистым модулем, чтобы решения о нагрузке на
   DAT были видимы и тестируемы в одном месте (ToS: см. CLAUDE.md, прецедент DAT v. Convoy).

   Зачем именно так (2026-09-15, после отвала лида по ToS-страху):
   - живой SSE-поток live-матчей DAT сам приносит новые грузы (нулевой футпринт) → при нём поллинг
     нужен лишь чтобы не разойтись с выдачей, и база тика поднимается до 10 минут;
   - location.reload() — самый грубый сигнал (полный bootstrap приложения), поэтому он больше не
     штатная ветка каждого тика, а исключение с собственным потолком в 15 минут;
   - авто-скролл провоцирует fetchMore приложения DAT (limit:150) — полный доскролл оправдан один
     раз на новую выдачу, дальше двух страниц хватает;
   - ночью брокеры почти не постят, а ровный круглосуточный паттерн — самое заметное в телеметрии,
     поэтому окно тишины включено по умолчанию.

   Время окна тишины — ЛОКАЛЬНОЕ время машины (в облаке это TZ контейнера, не водителя; попап
   поэтому показывает рядом текущее время машины). */
const LLPOLICY = (() => {
  const MIN_INTERVAL_MS = 120000;     // жёсткий нижний потолок тика (имитация человека)
  const SSE_INTERVAL_MS = 600000;     // база тика, пока живой SSE-поток несёт свежесть
  const RELOAD_GAP_MS = 900000;       // не чаще одного location.reload() в 15 минут
  const DATA_STALE_MS = 600000;       // выдача считается протухшей, если ответов DAT не было столько
  const WAKE_JITTER_MS = 300000;      // размазать пробуждение из окна тишины (не ровно в 05:00)
  const TICK_SCROLL_STEPS = 2;        // сколько страниц доскролливаем на обычном тике
  const DEFAULT_MAX_STEPS = 10;       // потолок полного доскролла новой выдачи
  const DEFAULT_QUIET = { from: 22, to: 5 };
  // DAT One: «Search activity in excess of five hundred (500) searches per user per month will be
  // considered breach» (Product and Delivery Schedule, ред. 30.07.2026). 450 — запас под ручные
  // поиски с других устройств, которых мы не видим. Ресерч: docs/research/2026-09-26-dat-tos-on-extensions.md
  const DEFAULT_SEARCH_LIMIT = 450;
  const RECENT_SEARCH_IDS = 50;       // сколько последних searchId помним для дедупа между вкладками

  // Number(null) === 0 и Number("") === 0 — для часов это молчаливый «полночь», а не «не задано».
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

  // Настройка окна тишины: undefined → дефолт, null → пользователь выключил окно, мусор → дефолт.
  function normalizeQuiet(quiet) {
    if (quiet === null) return null;
    if (quiet === undefined) return { ...DEFAULT_QUIET };
    const from = Math.floor(num(quiet.from)), to = Math.floor(num(quiet.to));
    const ok = (v) => Number.isFinite(v) && v >= 0 && v <= 23;
    if (!ok(from) || !ok(to)) return { ...DEFAULT_QUIET };
    return { from, to };
  }

  // Попадает ли момент now в окно тишины. from > to — окно через полночь (22→5).
  // from === to трактуем как «выключено»: иначе непонятно, это ноль часов или все сутки.
  function inQuiet(now, quiet) {
    if (!quiet) return false;
    const from = num(quiet.from), to = num(quiet.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
    const h = new Date(now).getHours();
    return from < to ? (h >= from && h < to) : (h >= from || h < to);
  }

  // Сколько мс спать до конца окна тишины (0, если сейчас не в окне).
  function msUntilQuietEnd(now, quiet) {
    if (!inQuiet(now, quiet)) return 0;
    const d = new Date(now);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), num(quiet.to), 0, 0, 0);
    if (end.getTime() <= d.getTime()) end.setDate(end.getDate() + 1);
    return end.getTime() - d.getTime();
  }

  // Когда планировать следующий тик и нужно ли его пропустить.
  // skip=true — таймер взводим, но ничего не трогаем на странице (окно тишины).
  function nextTick({ now, sseLive, quiet, intervalMs, rnd } = {}) {
    const r = typeof rnd === "function" ? rnd : Math.random;
    const at = now || Date.now();
    if (inQuiet(at, quiet)) {
      return { skip: true, delayMs: msUntilQuietEnd(at, quiet) + Math.floor(r() * WAKE_JITTER_MS) };
    }
    const floor = sseLive ? SSE_INTERVAL_MS : MIN_INTERVAL_MS;
    const base = Math.max(floor, intervalMs > 0 ? intervalMs : 0);
    return { skip: false, delayMs: base + Math.floor(r() * base) };   // [base, 2·base)
  }

  // Можно ли перезагрузить страницу (кнопка SEARCH у DAT задизейблена — повторять нечего).
  // Два условия: прошёл собственный потолок И выдача действительно протухла.
  function allowReload({ now, lastReloadAt, lastDataAt, minGapMs, staleMs } = {}) {
    const at = now || Date.now();
    const gap = minGapMs > 0 ? minGapMs : RELOAD_GAP_MS;
    const stale = staleMs > 0 ? staleMs : DATA_STALE_MS;
    if (lastReloadAt && at - lastReloadAt < gap) return false;
    if (lastDataAt && at - lastDataAt < stale) return false;
    return true;
  }

  // Сколько шагов доскролла позволяем: новая выдача — полный бюджет, живой SSE — нисколько,
  // обычный тик — две страницы (но не больше общего потолка).
  function scrollBudget({ first, sseLive, maxSteps } = {}) {
    const cap = maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS;
    if (first) return cap;
    if (sseLive) return 0;
    return Math.min(TICK_SCROLL_STEPS, cap);
  }

  // ---- бюджет поисков DAT ----
  // Поиск = новый searchId в ответе FindLoads (пагинация fetchMore приходит с тем же searchId).
  // Считаем ВСЕ поиски на устройстве, ручные тоже: лимит DAT — на пользователя, а не на авто-пилот.
  // Точного определения «search» DAT не даёт — это наша лучшая оценка, не их счётчик.
  function monthKey(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // ll_search_budget → { limit, ignore }. ignore — осознанный выбор пользователя «не ограничивать».
  function normalizeBudget(b) {
    const lim = Math.floor(num(b && b.limit));
    return {
      limit: Number.isFinite(lim) && lim > 0 ? lim : DEFAULT_SEARCH_LIMIT,
      ignore: !!(b && b.ignore),
    };
  }

  // ll_search_count → { month, count, recent }. Возвращает ТУ ЖЕ ссылку, если считать нечего —
  // вызывающий по ней понимает, что писать в storage не нужно.
  function countSearch(rec, searchId, now) {
    const month = monthKey(now);
    const cur = rec && rec.month === month && Array.isArray(rec.recent) ? rec : null;
    if (!searchId) return cur || rec;
    if (cur && cur.recent.includes(searchId)) return cur;
    const base = cur || { month, count: 0, recent: [] };
    return { month, count: base.count + 1, recent: base.recent.concat(searchId).slice(-RECENT_SEARCH_IDS) };
  }

  function searchesUsed(rec, now) {
    return rec && rec.month === monthKey(now) ? (Number(rec.count) || 0) : 0;
  }

  // Можно ли авто-пилоту запустить ещё один поиск (клик SEARCH или reload). Кроме месячного
  // потолка — равномерный темп: к концу d-го дня тратим не больше limit·d/D, иначе интервал в
  // 3 минуты выжег бы месяц за пару дней, и остаток месяца авто-пилот бы молчал.
  function allowSearch({ used, budget, now } = {}) {
    const b = normalizeBudget(budget);
    if (b.ignore) return { allow: true, reason: "ignored", limit: b.limit };
    const n = Number(used) || 0;
    if (n >= b.limit) return { allow: false, reason: "limit", limit: b.limit };
    const d = new Date(now || Date.now());
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const pace = Math.ceil(b.limit * d.getDate() / days);
    if (n >= pace) return { allow: false, reason: "pace", pace, limit: b.limit };
    return { allow: true, reason: "ok", pace, limit: b.limit };
  }

  return {
    normalizeQuiet, inQuiet, msUntilQuietEnd, nextTick, allowReload, scrollBudget,
    monthKey, normalizeBudget, countSearch, searchesUsed, allowSearch,
    MIN_INTERVAL_MS, SSE_INTERVAL_MS, RELOAD_GAP_MS, DATA_STALE_MS, WAKE_JITTER_MS,
    TICK_SCROLL_STEPS, DEFAULT_MAX_STEPS, DEFAULT_QUIET, DEFAULT_SEARCH_LIMIT, RECENT_SEARCH_IDS,
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLPOLICY; }
if (typeof globalThis !== "undefined") globalThis.LLPOLICY = LLPOLICY;
