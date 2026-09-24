/* LoadLens — content script для DAT One / Truckstop.
   Парсит строки грузов через site-adapter, вешает два бейджа (выгодность + HOS),
   копит крауд-базу на сервере, строит «get out» цепочки и шлёт снапшот в боковую панель (LLVIEW → sidepanel.js).
   Каркас (MutationObserver + debounce + флаш-буфер) — из PriceLens content.js. */
(() => {
  "use strict";
  const adapter = (typeof LLADAPT !== "undefined") && LLADAPT.adapterFor(location.host);
  if (!adapter) return; // не наш борд

  // debug-логи под флагом: localStorage.LL_DEBUG = "1" (парн. с inject.js; читаем каждый раз)
  const llDebug = () => { try { return localStorage.getItem("LL_DEBUG") != null; } catch (_) { return false; } };
  const log = (...a) => { if (llDebug()) { try { console.log("[LoadLens/content]", ...a); } catch (_) {} } };
  // тексты бейджей — из LLVIEW, чтобы страница и боковая панель говорили одно и то же
  const profitText = LLVIEW.profitText, crowdText = LLVIEW.crowdText, hosIcon = LLVIEW.hosIcon;

  let hintsOff = false; // per-tab: скрыть наши подсказки (бейджи + панель) на этой вкладке
  let hideBadges = false; // глобальная настройка попапа (ll_hide_badges): скрыть построчные бейджи
  let dieselPrice = 3.95;
  let baseCostPerMile = 1.80; // «базовая» (диспетчерская) настройка; не мутируется водителем
  let costPerMile = 1.80;     // текущий (resolveDriverContext → applyDriverContext)
  let targets = LLSCORE.DEFAULTS.targets; // целевые $/mi по бакетам дистанции (ll_targets); порог green
  let equipFilter = null;     // ручной фильтр прицепа из попапа (ll_equip_filter): string[] | null; null = без фильтра
  let alertRules = { version: 1, rules: [] }; // правила Telegram-алертов из попапа (ll_alert_rules); пусто → green+equip
  let mailTemplate = (typeof LLMAIL !== "undefined") ? LLMAIL.DEFAULT_TEMPLATE : ""; // шаблон письма брокеру (ll_mail_template)
  const _freshHos = (typeof LLHOS !== "undefined") ? LLHOS.fresh() : { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 4200 };
  let baseHos = { ..._freshHos }; // «базовый» HOS (диспетчерские часы из storage/popup)
  let hosState = { ..._freshHos }; // текущий (resolveDriverContext → applyDriverContext)
  let currentMarket = null; // рынок водителя для планировщика (по умолчанию — самый частый origin в выдаче)
  let drivers = [];              // парк диспетчера (LLAPI.getDrivers; пусто, если не залогинен)
  let activeDriver = null;       // выбранный водитель (LLDRV.pickActive)
  let activeEquipment = null;    // фильтр прицепа активного водителя (null = без фильтра)

  let gqlLoads = [];              // грузы текущей выдачи (накопленные по страницам, см. accState)
  let accState = (typeof LLACC !== "undefined") ? LLACC.emptyState() : { searchId: null, byId: new Map() };
  let scrolling = false;         // авто-скролл выдачи в процессе (гард от параллельных запусков)
  // авто-пилот: фоновый таб сам кликает Search DAT, удерживает сортировку и доскролливает выдачу
  // до конца (см. spec 2026-06-22). ToS: НЕ вызываем API DAT — кликаем/скроллим её же UI как
  // пользователь в своей сессии; по умолчанию ВЫКЛ, opt-in.
  let autoRefresh = { on: false, intervalMs: 180000, scroll: true, maxSteps: 10, quiet: null }; // базу тика и бюджет скролла решает LLPOLICY
  let sortPref = null;           // {field, dir:'asc'|'desc'} — удерживаемая сортировка DAT
  let pendingSortReapply = false;// true сразу после нашего clickRefresh → переприменить сорт по новой выдаче
  let cloudCfg = null;           // cloud mode (LLCLOUD.config) — авто-пилот всегда ВКЛ, heartbeat на бэкенд
  let sseAlerts = false;         // ll_sse_alerts: слушать нативный SSE-поток live-матчей DAT (inject → dat-match-event)
  let liveTs = 0;                // ts последнего SSE-события (фолбэк для индикатора «live»)
  const LIVE_FRESH_MS = 90000;   // «live» горит, если событие было не позже этого окна
  const sseStreams = new Set();  // searchId открытых SSE-потоков (dat-sse-open/close из inject.js)
  let lastDataAt = 0;            // ts последнего ответа DAT FindLoads — «выдача ещё свежая?»
  let lastReloadAt = 0;          // ts нашего последнего location.reload() (переживает reload в sessionStorage)
  let scrolledSearchId;          // выдача, которую уже доскроллили полностью (undefined = ещё ни разу)
  const HEARTBEAT_TICK_MS = 60000; // проверка «пора ли heartbeat» (сам период — LLCLOUD.HEARTBEAT_MS)
  let panelPort = null;          // порт боковой панели (runtime.onConnect "ll-panel"), null — панель не смотрит на эту вкладку
  let lastSnapJson = "";         // последний отправленный снапшот — не слать одинаковые (MutationObserver DAT шумит)
  let detailLoadId = null;       // груз, открытый в карточке боковой панели
  let booted = false;            // boot() дочитал настройки — можно рисовать и принимать команды панели
  const laneCache = new Map();    // "O>D|E" -> {medianRpm|null}  (из backend)
  const marketCache = new Map();  // market -> strength 0..1
  const repCache = new Map();     // brokerMc -> reputation (crowd)
  const crowdCache = new Map();   // market -> CrowdLoad[] (onward-плечи из бэкенда)
  const goneIds = new Set();      // loadId, помеченные сервером likelyGone — исключаем из цепочек
  const crowdSince = new Map();   // market -> серверный ts последнего near-ответа (для delta-poll)
  const RADIUS_MI = 75;           // радиус соседних рынков (тот же, что в LLGEO.nearby и бэке)
  const POLL_MS = 7000;           // интервал живого delta-poll при открытой панели
  const laneRequested = new Set();
  const marketRequested = new Set();
  const repRequested = new Set();
  const crowdRequested = new Set();

  // ---------- сбор строк ----------
  // Источник грузов для панели/скоринга/sync: DAT — GraphQL-перехват (gqlLoads), Truckstop — DOM (collect).
  function currentLoads() {
    if (gqlLoads.length) { log("currentLoads: source=GraphQL intercept,", gqlLoads.length, "loads"); return gqlLoads; }
    try {
      const dom = adapter.collect ? uniqueLoads(adapter.collect()) : [];
      log("currentLoads: source=DOM adapter,", dom.length, "loads");
      return dom;
    } catch (_) { return []; }
  }

  // уникальные грузы (без дублей строк) для статистики/планировщика
  function uniqueLoads(loads) {
    const m = new Map();
    loads.forEach((l) => m.set(l.loadId, l));
    return [...m.values()];
  }

  // ---------- серверный sync (буфер + флаш, таймер НЕ сбрасывается — см. PriceLens fix) ----------
  const _pending = new Map();
  let _flushTimer = null;
  function queueSync(loads) {
    loads.forEach((l) => _pending.set(l.loadId, l));
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      const items = [..._pending.values()];
      _pending.clear();
      if (items.length && typeof LLAPI !== "undefined") {
        log("sync → POST /loads (aggregate after sanitizeLoad):", items.length, "loads");
        LLAPI.sendLoads(items).catch(() => {});
      }
    }, 1500);
  }

  // ---------- lane / market статистика (ленивая загрузка + перерисовка) ----------
  function laneKeyOf(l) { return `${l.originMarket}>${l.destMarket}|${l.equipment}`; }
  // целевой $/mi для груза по его trip-милям (бакет из ll_targets); порог green в profitBadge
  function targetFor(l) { return LLSCORE.targetForMiles(l.loadedMiles, targets); }
  // ручной equipment-фильтр из попапа: груз проходит, если фильтр не задан или прицеп в наборе
  function passEquip(l) { return LLEQUIP.matches(equipFilter, l.equipment); }
  function fetchLanes(loads) {
    if (typeof LLAPI === "undefined") return;
    const keys = new Map();
    loads.forEach((l) => keys.set(laneKeyOf(l), l));
    keys.forEach((l, k) => {
      if (laneRequested.has(k)) return;
      laneRequested.add(k);
      LLAPI.getLane(l.originMarket, l.destMarket, l.equipment).then((s) => {
        laneCache.set(k, s && s.level === "lane" ? s.medianRpm : null);
        schedule();
      }).catch(() => {});
    });
  }
  function fetchMarkets(markets) {
    markets.forEach((m) => {
      if (marketRequested.has(m)) return;
      marketRequested.add(m);
      const seedStrength = (globalThis.LLSEED && LLSEED.markets[m] && LLSEED.markets[m].strength);
      if (seedStrength != null) marketCache.set(m, seedStrength); // мгновенный seed, уточним с backend
      if (typeof LLAPI === "undefined") return;
      LLAPI.getMarket(m).then((s) => {
        if (s && typeof s.strength === "number") { marketCache.set(m, s.strength); schedule(); }
      }).catch(() => {});
    });
  }
  function fetchBrokerReps(loads) {
    if (typeof LLAPI === "undefined") return;
    const mcs = [...new Set(loads.map((l) => l.brokerMc).filter(Boolean))];
    mcs.forEach((mc) => {
      if (repRequested.has(mc)) return;
      repRequested.add(mc);
      LLAPI.getBrokerReputation(mc).then((r) => { if (r) { repCache.set(String(mc), r); schedule(); } }).catch(() => {});
    });
  }
  function refreshRep(mc) {              // после отправки отзыва — перезапросить
    repRequested.delete(mc);
    if (typeof LLAPI !== "undefined") LLAPI.getBrokerReputation(mc).then((r) => { if (r) { repCache.set(String(mc), r); schedule(); } }).catch(() => {});
  }
  // подтянуть neighborhood грузов из рынков назначения (рынок + соседи) — origin'ы следующих плеч.
  // opts.poll=true: живой delta-poll (игнорируем crowdRequested, шлём since); иначе разовый снимок.
  function fetchCrowdLoads(markets, opts = {}) {
    if (typeof LLAPI === "undefined") return;
    markets.slice(0, 25).forEach((m) => {            // bound: не больше 25 запросов
      if (!opts.poll && crowdRequested.has(m)) return;
      crowdRequested.add(m);
      const since = opts.poll ? crowdSince.get(m) : undefined;
      // фетчим neighborhood equipment-agnostically (планировщик сам фильтрует по equipment);
      // иначе при смене водителя кэш остаётся под старый equipment до следующего poll.
      LLAPI.getLoadsNear(m, { since }).then((res) => {
        if (res) mergeNear(m, res);
      }).catch(() => {});
    });
  }

  // Слить near-ответ в crowdCache: added/updated upsert по loadId, gone — удалить и запомнить.
  function mergeNear(market, res) {
    const prev = crowdCache.get(market) || [];
    const byId = new Map(prev.map((l) => [l.loadId, l]));
    (res.loads || []).forEach((l) => { byId.set(l.loadId, l); goneIds.delete(l.loadId); });
    (res.gone || []).forEach((id) => { byId.delete(id); goneIds.add(id); });
    crowdCache.set(market, [...byId.values()]);
    if (res.ts) crowdSince.set(market, res.ts);
    if ((res.loads && res.loads.length) || (res.gone && res.gone.length)) schedule();
  }
  // пул для планировщика: видимые грузы + крауд onward-плечи (дедуп по loadId)
  function chainPool(visible) {
    const byId = new Map();
    visible.forEach((l) => byId.set(l.loadId, l));
    crowdCache.forEach((rows) => rows.forEach((l) => { if (!byId.has(l.loadId)) byId.set(l.loadId, l); }));
    return [...byId.values()].filter((l) => !goneIds.has(l.loadId)); // ушедшие грузы — вон из цепочек
  }
  function strengthOf(market) {
    if (marketCache.has(market)) return marketCache.get(market);
    const seed = globalThis.LLSEED && LLSEED.markets[market];
    return seed ? seed.strength : 0.5;
  }

  // ---------- бейджи ----------
  function clearBadges() { document.querySelectorAll(".ll-badge").forEach((b) => b.remove()); }

  function badgeRow(anchorEl, load) {
    if (!anchorEl) return;
    const laneMedian = laneCache.has(laneKeyOf(load)) ? laneCache.get(laneKeyOf(load)) : null;
    const profit = LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian, targetRpm: targetFor(load) });
    const hos = hosBadge(load);

    // полоса под строкой: full-width, ничего не перекрывает (строка просто чуть выше)
    const host = document.createElement("div");
    host.className = "ll-badge ll-rowstrip ll-" + profit.level;
    // red-flag чип (фрод/double-broker) — первым, как самый важный сигнал
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: repCache.get(String(load.brokerMc)) });
    if (flags.length) {
      const lvl = LLSCORE.redFlagLevel(flags);
      const fc = chip(lvl === "high" ? "🚩 risk" : "🚩 verify", "ll-flag " + (lvl === "high" ? "ll-red" : "ll-amber"));
      fc.title = flags.map((f) => f.label).join("\n");
      host.appendChild(fc);
    }
    host.appendChild(chip(profitText(profit), "ll-profit"));
    host.appendChild(chip("HOS " + hosIcon(hos), "ll-hos ll-" + hos));
    const broker = LLSCORE.brokerBadge(load);
    if (broker.level !== "unknown") host.appendChild(chip(brokerText(broker), "ll-broker ll-" + broker.level));
    // crowd-репутация: кликабельный чип (показывает агрегат + открывает меню отзыва)
    if (load.brokerMc) host.appendChild(crowdChip(load.brokerMc));
    if (drivers.length && typeof LLFLEET !== "undefined") host.appendChild(fleetChip(load));
    host.appendChild(detailChip(load));
    anchorEl.appendChild(host);
  }
  // «все водители сразу»: чип лучшего подходящего водителя из парка + (N/M)
  function fleetMatch(load) {
    return LLFLEET.matchLoadToFleet(load, drivers,
      { distance: (a, b) => LLGEO.sync(a, b), dieselPrice, costPerMile: baseCostPerMile });
  }
  function fleetChip(load) {
    const m = fleetMatch(load);
    const lvl = m.best ? m.best.hosBadge : "thin";
    const cls = lvl === "green" ? "ll-good" : lvl === "amber" ? "ll-ok" : lvl === "red" ? "ll-risk" : "ll-thin";
    const txt = m.best ? `👤 ${m.best.name} (${m.feasibleCount}/${m.total})` : `👤 none (0/${m.total})`;
    const c = chip(txt, "ll-fleet " + cls);
    c.style.cursor = "pointer";
    c.title = m.matches.map((x) =>
      `${x.feasible ? "✓" : "✕"} ${x.name}: HOS ${x.hosBadge}${x.equipMatch ? "" : " · equipment mismatch"} · DH ${x.deadhead}mi` +
      `${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`).join("\n");
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openDetailInPanel(load); });
    return c;
  }
  function detailChip(load) {
    const c = chip("ⓘ details", "ll-detail-chip");
    c.style.cursor = "pointer";
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openDetailInPanel(load); });
    return c;
  }
  function brokerText(b) {
    const parts = [];
    if (b.creditScore != null) parts.push(b.creditScore + " CS");
    if (b.daysToPay != null) parts.push(b.daysToPay + " DTP");
    const tag = b.level === "good" ? "🛡 trusted" : b.level === "ok" ? "broker ok" : "⚠ risk";
    return tag + (parts.length ? " · " + parts.join(" · ") : "");
  }

  const CROWD_CLS = { good: "ll-good", mixed: "ll-ok", bad: "ll-risk", thin: "ll-thin", none: "ll-thin" };
  function crowdChip(mc) {
    const rep = repCache.get(String(mc));
    const c = chip(crowdText(rep), "ll-broker ll-crowd " + (rep ? CROWD_CLS[rep.level] : "ll-thin"));
    c.style.cursor = "pointer";
    c.title = "Crowdsourced broker reputation. Click to leave a review.";
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openReportMenu(mc, e.clientX, e.clientY); });
    return c;
  }

  // ---------- меню отзыва о брокере ----------
  const REPORT_OPTS = [
    { o: "paid", t: "✅ Paid" },
    { o: "no_issue", t: "👍 No issues" },
    { o: "slow", t: "🐢 Slow pay" },
    { o: "flaked", t: "🚫 Flaked / canceled" },
    { o: "double_brokered", t: "⛔ Double-broker" },
  ];
  function openReportMenu(mc, x, y) {
    closeReportMenu();
    const m = document.createElement("div");
    m.id = "ll-report-menu";
    m.style.left = Math.min(x, window.innerWidth - 200) + "px";
    m.style.top = Math.min(y, window.innerHeight - 220) + "px";
    const title = document.createElement("div");
    title.className = "hd"; title.textContent = "Broker review " + mc;
    m.appendChild(title);
    REPORT_OPTS.forEach(({ o, t }) => {
      const b = document.createElement("button");
      b.className = "ll-rep-opt"; b.textContent = t;
      b.onclick = async () => {
        m.querySelectorAll("button").forEach((x) => (x.disabled = true));
        title.textContent = "Sending…";
        const ok = typeof LLAPI !== "undefined" && await LLAPI.reportBroker(String(mc), o);
        closeReportMenu();
        if (ok) refreshRep(String(mc));
      };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("click", closeReportMenu, { once: true }), 0);
  }
  function closeReportMenu() { const m = document.getElementById("ll-report-menu"); if (m) m.remove(); }

  function chip(text, cls) { const s = document.createElement("span"); s.className = "ll-chip " + cls; s.textContent = text; return s; }
  function hosBadge(load) {
    const dh = load.deadheadMiles || 0;
    const driveMin = LLPLAN.legMinutes((load.loadedMiles || 0) + dh);
    const r = LLPLAN.stepHos(hosState, driveMin, 2 * 60);
    return r.feasible ? r.badge : "red";
  }

  // ---------- планировщик цепочек ----------
  function buildChains(pool, start) {
    if (typeof LLPLAN === "undefined" || !start) return [];
    return LLPLAN.plan({
      start: { market: start },
      hosState,
      loads: pool,
      distance: (a, b) => LLGEO.sync(a, b),
      nearby: (m) => LLGEO.nearby(m, RADIUS_MI),
      marketStrength: strengthOf,
      equipment: activeEquipment || undefined,
      dieselPrice, costPerMile, maxLegs: 3, topN: 5,
    });
  }
  function topOriginMarket(loads) {
    const c = {};
    loads.forEach((l) => { c[l.originMarket] = (c[l.originMarket] || 0) + 1; });
    let best = null, n = -1;
    for (const m in c) if (c[m] > n) { n = c[m]; best = m; }
    return best;
  }

  // Применить активного водителя к параметрам планировщика/скоринга (или аноним-фолбэк).
  // Всегда читает из СТАБИЛЬНЫХ базовых настроек (baseHos/baseCostPerMile), чтобы переключение
  // между водителями с explicit-cost и без не накапливало грязь от предыдущего водителя.
  function applyDriverContext(loads) {
    const fallbackMarket = currentMarket || topOriginMarket(loads);
    const ctx = (typeof LLDRV !== "undefined")
      ? LLDRV.resolveDriverContext(activeDriver, { market: fallbackMarket, hos: baseHos, costPerMile: baseCostPerMile })
      : { market: fallbackMarket, hos: baseHos, equipment: null, costPerMile: baseCostPerMile };
    // ВСЕГДА присваиваем: аноним → base-значения; водитель → его значения (или base, если null).
    hosState = ctx.hos;
    costPerMile = ctx.costPerMile;
    activeEquipment = ctx.equipment;
    return ctx.market;
  }

  // ---------- вход в боковую панель ----------
  // Открыть боковую панель можно только по жесту пользователя: вызываем СИНХРОННО из click-обработчика.
  function openSidePanel() {
    const fail = () => toast("Click the LoadLens icon in the Chrome toolbar to open the panel");
    try {
      chrome.runtime.sendMessage({ type: "open-panel" }, (r) => { if (chrome.runtime.lastError || !r || !r.ok) fail(); });
    } catch (_) { fail(); } // контекст расширения инвалидирован (расширение обновили) — вкладку надо перезагрузить
  }
  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById("ll-toast");
    if (!t) { t = document.createElement("div"); t.id = "ll-toast"; document.body.appendChild(t); }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 4000);
  }
  function showFab() {
    if (document.getElementById("ll-fab")) return;
    const f = document.createElement("button");
    f.id = "ll-fab"; f.textContent = "🚚 LoadLens"; f.title = "Open the LoadLens side panel";
    f.onclick = openSidePanel;
    document.body.appendChild(f);
  }
  function removeFab() { const f = document.getElementById("ll-fab"); if (f) f.remove(); }
  function openDetailInPanel(load) {
    openSidePanel();                 // первым — пока жест клика жив
    detailLoadId = String(load.loadId);
    render();
  }

  // Бейдж выгодности с текущими настройками (cost/mile, дизель, медиана lane, целевой $/mi по бакету).
  function badgeFor(l) {
    return LLSCORE.profitBadge(l, { costPerMile, dieselPrice, laneMedian: laneCache.get(laneKeyOf(l)), targetRpm: targetFor(l) });
  }

  // Свежесть постинга: servicedWhen из перехвата GraphQL, фолбэк — postedAge DOM-адаптера (LLMODEL).
  // Возраст решает после ставки: протухший пост чаще всего уже взят или это репост-приманка.
  function ageOf(load) {
    return (typeof LLMODEL !== "undefined") ? LLMODEL.ageMinutes(load, Date.now()) : null;
  }
  function freshestFirst(loads) {
    return (typeof LLMODEL !== "undefined") ? LLMODEL.byFreshness(loads, Date.now()) : loads;
  }

  // Отбор грузов для Telegram-алертов. Есть включённые правила (ll_alert_rules) → LLRULES.select (OR между
  // правилами, AND внутри); нет → прежнее поведение: green + passEquip (те же грузы, что «Выгодные сейчас»).
  // Используется и в render (вся выдача), и для одиночных live-событий SSE (dat-match-event).
  function selectAlertHits(loads) {
    const activeRules = (typeof LLRULES !== "undefined") ? LLRULES.active(alertRules) : [];
    if (activeRules.length) return LLRULES.select(activeRules, loads, { equipFilter, badgeFor, ageOf });
    return loads.filter(passEquip).filter((l) => badgeFor(l).level === "green").map((load) => ({ load, rule: null }));
  }

  // Живой ли канал live-матчей: открытый поток (надёжно) или недавнее событие (фолбэк на случай,
  // если поток открылся до того, как content.js навесил слушатель). От этого зависит, насколько
  // редко тикает авто-пилот и нужно ли вообще скроллить (см. autopilot-policy.js).
  function sseLive() {
    if (!sseAlerts) return false;
    return sseStreams.size > 0 || Date.now() - liveTs < LIVE_FRESH_MS;
  }

  // Событие нативных Load Match Alerts DAT (SSE, перехват клона потока в inject.js). За флагом ll_sse_alerts.
  // Create/Update того же поиска, что на экране (searchId совпал с накопителем) → доливаем в выдачу и
  // перерисовываем (render сам прогонит алерты). Событие другой вкладки поиска (DAT держит поток на каждую)
  // → только алерты, в панель не подмешиваем. Cancel → убираем из накопителя.
  function onMatchEvent(payload) {
    if (!sseAlerts || typeof DAT_GQL === "undefined" || !payload) return;
    const r = DAT_GQL.parseMatchEvent(payload);
    if (!r) return;
    liveTs = Date.now();
    const sameSearch = !!(accState.searchId && payload.searchId && payload.searchId === accState.searchId);
    log("SSE match event:", r.action, r.loadId, sameSearch ? "(current search)" : "(other search tab)");
    if (r.action === "cancel") {
      if (sameSearch && accState.byId.delete(r.loadId)) { gqlLoads = [...accState.byId.values()]; schedule(); }
      return;
    }
    if (sameSearch) {
      const acc = LLACC.accumulate(accState, [r.load], accState.searchId);
      accState = acc.state; gqlLoads = acc.loads; schedule();
    } else {
      if (typeof LLALERT !== "undefined") {
        applyDriverContext([r.load]);
        LLALERT.push(selectAlertHits([r.load])).catch(() => {});
      }
      schedule(); // перерисовать шапку панели (индикатор «● live»), выдача не меняется
    }
  }

  // ---------- боковая панель: снапшот ----------
  function postSnapshot(snap) {
    if (!panelPort) return;
    const json = JSON.stringify(snap);
    if (json === lastSnapJson) return; // ничего не поменялось — не будим панель
    lastSnapJson = json;
    panelSend({ type: "snapshot", data: snap });
  }
  function panelSend(msg) {
    if (!panelPort) return;
    try { panelPort.postMessage(msg); } catch (_) { panelPort = null; }
  }
  const look = {
    laneMedianOf: (o, d, e) => { const v = laneCache.get(laneKeyOf({ originMarket: o, destMarket: d, equipment: e })); return v == null ? null : v; },
    rep: (mc) => repCache.get(String(mc)) || null,
    strength: strengthOf,
    density: (m) => (crowdCache.get(m) || []).length,
    age: ageOf,
    brokerBadge: (l) => LLSCORE.brokerBadge(l),
  };
  // факты для карточки груза — те же расчёты, что были в openLoadDetail
  function detailFacts(load) {
    const laneMedian = look.laneMedianOf(load.originMarket, load.destMarket, load.equipment);
    const rep = load.brokerMc ? look.rep(load.brokerMc) : null;
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: rep });
    const offer = LLSCORE.counterOffer(load, { laneMedian, costPerMile });
    let mail = null;
    if (load.contactEmail && typeof LLMAIL !== "undefined") {
      const subject = LLMAIL.subjectFor(load);
      const body = LLMAIL.fillTemplate(mailTemplate, load, activeDriver, { counterOffer: offer.script });
      mail = { url: LLMAIL.gmailComposeUrl(load.contactEmail, subject, body), text: subject + "\n\n" + body };
    }
    return {
      laneMedian, rep, flags, offer, mail,
      profit: LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian, targetRpm: targetFor(load) }),
      hos: hosBadge(load),
      broker: LLSCORE.brokerBadge(load),
      flagLevel: flags.length ? LLSCORE.redFlagLevel(flags) : null,
      trueRpm: LLSCORE.trueRpm(load.rate, load.loadedMiles, load.deadheadMiles),
      fleet: drivers.length && typeof LLFLEET !== "undefined" ? fleetMatch(load) : null,
    };
  }

  // Pro-экспорт CSV видимых грузов (гейт через LLAPI.getMe().plan). Файл скачивает боковая панель:
  // у content-скрипта после async-проверки плана уже нет жеста, а страница расширения качать может.
  async function exportCsv(loads) {
    const me = typeof LLAPI !== "undefined" ? await LLAPI.getMe() : null;
    if (!me || me.plan !== "pro") return panelSend({ type: "notice", text: "CSV export is a Pro feature. Sign in on the Settings tab." });
    if (!loads.length) return panelSend({ type: "notice", text: "No loads to export." });
    panelSend({ type: "csv", filename: `loadlens_${adapter.board}_${new Date().toISOString().slice(0, 10)}.csv`, csv: LLCSV.buildLoadsCsv(loads) });
  }

  // ---------- боковая панель: команды ----------
  async function onPanelCmd(m) {
    if (!m || m.type !== "cmd") return;
    switch (m.cmd) {
      case "setDriver":
        activeDriver = (typeof LLDRV !== "undefined") ? LLDRV.pickActive(drivers, m.id) : null;
        if (typeof LLDRV !== "undefined") await LLDRV.setActive(m.id);
        break;
      case "setCpm": { const v = parseFloat(m.value); if (v > 0) baseCostPerMile = v; break; }
      case "setStart": currentMarket = String(m.market || "").trim().toUpperCase() || null; break;
      case "setAutorefresh":
        if (cloudCfg) break; // в облаке авто-пилот всегда ВКЛ — снапшот вернёт галку назад
        autoRefresh.on = !!m.on;
        if (typeof LLTAB !== "undefined") LLTAB.setAutorefresh(sessionStorage, autoRefresh.on);
        scheduleAuto();
        if (autoRefresh.on && autoRefresh.scroll) scrollToLoadAll(); // доскроллить уже открытую выдачу сразу
        break;
      case "setSort": {
        const patch = {};
        if ("field" in m) patch.field = m.field || null;
        if ("dir" in m) patch.dir = m.dir === "asc" ? "asc" : "desc";
        await persistSort(patch); // storage.onChanged → applySortPref + schedule
        break;
      }
      case "scrollToRow": {
        const ok = m.resultId != null && adapter && typeof adapter.scrollToRow === "function" && adapter.scrollToRow(m.resultId);
        panelSend({ type: "scrollResult", ok: !!ok });
        return;
      }
      case "openDetail": detailLoadId = m.loadId != null ? String(m.loadId) : null; break;
      case "closeDetail": detailLoadId = null; break;
      case "exportCsv": exportCsv(currentLoads()); return;
      case "setHintsOff":
        hintsOff = !!m.on;
        if (typeof LLTAB !== "undefined") LLTAB.setHintsOff(sessionStorage, hintsOff);
        break;
      case "reportBroker":
        if (m.mc && typeof LLAPI !== "undefined") {
          const ok = await LLAPI.reportBroker(String(m.mc), m.outcome);
          panelSend({ type: "notice", text: ok ? "Thanks — review saved." : "Could not save the review." });
          if (ok) refreshRep(String(m.mc));
        }
        return;
      default: return;
    }
    render();
  }

  function render() {
    const loads = currentLoads();                   // DAT: gqlLoads (перехват) · Truckstop: DOM
    queueSync(loads);
    fetchLanes(loads);
    fetchMarkets(uniqueMarkets(loads));
    fetchBrokerReps(loads);
    fetchCrowdLoads([...new Set(loads.map((l) => l.destMarket))]); // origin'ы следующих плеч

    // Сначала применяем контекст водителя: мутирует hosState/costPerMile/activeEquipment,
    // которые читают построчные бейджи (hosBadge/badgeRow) — иначе бейджи отстают на один рендер.
    const start = applyDriverContext(loads);

    // green + passEquip — те же грузы, что в «Выгодные сейчас» (используется и панелью Hot loads ниже,
    // и как фолбэк для Telegram-алертов). Считаем до early-return, чтобы алерты работали и без открытой боковой панели.
    const greens = loads.filter(passEquip)
      .map((l) => ({ l, b: badgeFor(l) }))
      .filter((d) => d.b.level === "green");
    // Telegram-алерты: отбор в selectAlertHits (правила или green+equip). Гейт/дедуп/cap внутри LLALERT и на сервере.
    if (typeof LLALERT !== "undefined") LLALERT.push(selectAlertHits(loads)).catch(() => {});

    clearBadges();
    const vis = { hintsOff, hideBadges, panelOpen: !!panelPort };
    // построчные бейджи: матчим видимые DOM-строки с грузами (DAT — по resultId, TS — parseRow).
    if (LLVIS.badgesVisible(vis)) {
      (adapter.anchor ? adapter.anchor(loads) : []).forEach((p) => badgeRow(p.anchor || p.row, p.load));
    }
    if (LLVIS.fabVisible(vis)) showFab(); else removeFab();

    // Цепочки/Hot loads/деталь нужны только боковой панели — без подключённого порта не считаем.
    if (!panelPort) return;
    const pool = chainPool(loads);
    const chains = buildChains(pool, start).filter((c) => c.legs.length >= 1);
    // «Выгодные сейчас» — свежие вперёд: из двух зелёных первым нужен тот, что ещё не разобрали.
    const dealOrder = new Map(freshestFirst(greens.map((d) => d.l)).map((l, i) => [l, i]));
    const deals = greens.slice().sort((a, b) => dealOrder.get(a.l) - dealOrder.get(b.l)).slice(0, 5);
    // груз ушёл из выдачи (новый поиск) → карточка закрывается, панель возвращается к списку
    const detailLoad = detailLoadId != null ? loads.find((l) => String(l.loadId) === detailLoadId) || null : null;
    if (!detailLoad) detailLoadId = null;
    postSnapshot(LLVIEW.build({
      board: adapter.board, loads, pool, chains, deals, start, dieselPrice, costPerMile, equipFilter,
      autoRefreshOn: autoRefresh.on, cloud: !!cloudCfg, sseLive: sseLive(), sortPref, sortFields: SORT_FIELDS,
      drivers, activeDriverId: activeDriver ? activeDriver.id : null, hintsOff,
      detailLoad, detailFacts: detailLoad ? detailFacts(detailLoad) : null, now: Date.now(), look,
    }));
  }















  function uniqueMarkets(loads) {
    const s = new Set();
    loads.forEach((l) => { s.add(l.originMarket); s.add(l.destMarket); });
    return [...s];
  }

  // ---------- авто-пилот: таймер Search-клика + удержание сортировки ----------
  // Поля сортировки для контрола (фолбэк, если родной дропдаун DAT ещё не прочитан readSortOptions).
  const SORT_FIELDS = [
    { field: "rate", label: "Rate" },
    { field: "age", label: "Age" },
    { field: "trip", label: "Trip miles" },
    { field: "deadhead", label: "Deadhead" },
  ];
  // (field,dir) → ключ опции DAT. DAT-опции парные ("Rate - Highest"/"Rate - Lowest"); desc=highest.
  // ★ Единственная точка маппинга — уточнить, когда придёт живой HTML сорт-дропдаупа DAT.
  function desiredSortKey(sort) {
    if (!sort || !sort.field) return null;
    return `${sort.field}-${sort.dir === "asc" ? "lowest" : "highest"}`;
  }
  // следующий интервал тика: base + [0, jitter). Чистая, тестируемая (rnd инъектится).
  function nextDelay(base, jitter, rnd) {
    const r = typeof rnd === "function" ? rnd : Math.random;
    return base + Math.floor(r() * jitter);
  }
  let autoTimer = null;
  let autoTimerSseLive = false;  // режим, в котором взведён текущий таймер (чтобы не пересоздавать зря)
  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  function scheduleAuto() {
    clearAuto();
    if (/^login\./i.test(location.hostname)) return; // страница логина: reload убил бы форму входа
    if (!autoRefresh.on) return;
    const plan = LLPOLICY.nextTick({
      now: Date.now(), sseLive: sseLive(), quiet: autoRefresh.quiet, intervalMs: autoRefresh.intervalMs,
    });
    autoTimerSseLive = sseLive();
    if (plan.skip) log("auto-refresh: quiet hours, sleeping", Math.round(plan.delayMs / 60000), "min");
    autoTimer = setTimeout(() => {
      // Окно тишины: таймер тикает, но страницу не трогаем — свежесть в это время несёт только
      // пассивный SSE-поток (своих запросов не шлём).
      if (plan.skip || LLPOLICY.inQuiet(Date.now(), autoRefresh.quiet)) { scheduleAuto(); return; }
      let clicked = false;
      try { clicked = !!(adapter.clickRefresh && adapter.clickRefresh()); }
      catch (e) { log("auto-refresh error", e); }
      if (clicked) {
        // DAT включила SEARCH (критерии менялись) → клик перезапускает поиск без перезагрузки
        pendingSortReapply = true; log("auto-refresh: clicked Search");
        scheduleAuto();
        return;
      }
      // SEARCH задизейблена/не найдена (тот же поиск нечего повторять). Раньше здесь был reload на
      // КАЖДЫЙ тик — самый грубый сигнал для DAT (полный bootstrap приложения). Теперь это
      // исключение: свой потолок в 15 минут и только если выдача действительно протухла.
      const may = LLPOLICY.allowReload({ now: Date.now(), lastReloadAt, lastDataAt });
      if (!may) { log("auto-refresh: Search disabled, reload not due → skip"); scheduleAuto(); return; }
      log("auto-refresh: Search disabled → page reload");
      lastReloadAt = Date.now();
      // Маркеры в sessionStorage: после reload переприменим сортировку и не забудем момент
      // последней перезагрузки (переменные модуля её не переживают).
      try {
        sessionStorage.setItem("ll_autopilot_reload", "1");
        sessionStorage.setItem("ll_autopilot_reload_at", String(lastReloadAt));
      } catch (_) {}
      try { location.reload(); } catch (_) { scheduleAuto(); } // boot после reload сам перезапустит таймер
    }, plan.delayMs);
  }
  // ---- авто-скролл: доскроллить выдачу до конца, чтобы DAT lazy-load'нул все страницы ----
  // Данные копятся событийно (inject → message → LLACC.accumulate); скролл лишь провоцирует fetchMore
  // приложения DAT. Стоп: нет роста K=2 шага подряд или достигнут maxSteps. Гард scrolling — без гонок.
  const SCROLL_STEP_BASE = 700, SCROLL_STEP_JITTER = 500, SCROLL_DRY = 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function scrollToLoadAll() {
    if (scrolling || !autoRefresh.on || !autoRefresh.scroll) return;
    // Каждый шаг скролла провоцирует fetchMore приложения DAT (limit:150) — это основной объём
    // нашего футпринта. Полный доскролл оправдан один раз на новую выдачу; дальше хватает пары
    // страниц, а при живом SSE новые грузы приходят сами и скроллить незачем.
    const first = accState.searchId !== scrolledSearchId;
    const maxSteps = LLPOLICY.scrollBudget({ first, sseLive: sseLive(), maxSteps: autoRefresh.maxSteps });
    if (maxSteps <= 0) { log("auto-scroll: skipped (live matches are carrying freshness)"); return; }
    const container = adapter && adapter.findScrollContainer && adapter.findScrollContainer();
    if (!container) { log("auto-scroll: container not found"); return; }
    scrolling = true;
    if (first) scrolledSearchId = accState.searchId;
    const startTop = container.scrollTop || 0; // куда вернуть пользователя после доскролла
    try {
      let dry = 0, prevSize = accState.byId.size, prevH = 0;
      for (let i = 0; i < maxSteps; i++) {
        if (!autoRefresh.on || !autoRefresh.scroll) break;
        const m = adapter.scrollStep(container) || {};
        await sleep(nextDelay(SCROLL_STEP_BASE, SCROLL_STEP_JITTER)); // дать DAT догрузить страницу
        const size = accState.byId.size, h = m.scrollHeight || 0;
        if (size > prevSize || h > prevH) { dry = 0; prevSize = size; prevH = h; }
        else if (++dry >= SCROLL_DRY) break;                          // выдача исчерпана
      }
      log("auto-scroll done:", accState.byId.size, "loads");
    } finally {
      // вернуть выдачу на исходную позицию: иначе после reload вкладка стоит в самом низу списка
      // (хвост сортировки — старые/«no rate» грузы), и «лучшие сверху» пользователь не видит
      try { if (adapter.scrollRestore) adapter.scrollRestore(container, startTop); } catch (_) { /* нет */ }
      scrolling = false;
    }
  }

  // применить удерживаемую сортировку через родной дропдаун DAT (вручную или после авто-рефреша)
  function applySortPref() {
    const key = desiredSortKey(sortPref);
    if (key && adapter.applySort) adapter.applySort(key).then((ok) => log("DAT sort:", key, ok ? "ok" : "miss")).catch(() => {});
  }
  async function persistSort(patch) {
    const base = sortPref || { field: null, dir: "desc" };
    const next = { ...base, ...patch };
    sortPref = next.field ? { field: next.field, dir: next.dir === "asc" ? "asc" : "desc" } : null;
    try { await chrome.storage.local.set({ ll_sort: sortPref || { field: null } }); } catch (_) { applySortPref(); schedule(); }
  }

  // ---------- boot + observe ----------
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 400); }

  async function boot() {
    if (typeof LLAPI !== "undefined") {
      try { dieselPrice = await LLAPI.getDiesel(); } catch { /* фолбэк */ }
    }
    if (typeof LLHOS !== "undefined") { try { hosState = await LLHOS.load(); } catch { /* fresh */ } }
    baseHos = { ...hosState }; // зафиксировать базу после загрузки из storage
    try { const { ll_cpm } = await chrome.storage.local.get("ll_cpm"); if (ll_cpm > 0) { costPerMile = ll_cpm; baseCostPerMile = ll_cpm; } } catch { /* дефолт */ }
    // Cloud mode: авто-пилот форсим независимо от попапа/per-tab override (спека §4). Вычисляем ДО
    // try со storage, чтобы сбой chrome.storage.local не отключал форс молча.
    cloudCfg = (typeof LLCLOUD !== "undefined") ? LLCLOUD.config(globalThis) : null;
    try {
      const { ll_targets, ll_equip_filter, ll_autorefresh, ll_sort, ll_hide_badges, ll_mail_template, ll_alert_rules, ll_sse_alerts } = await chrome.storage.local.get(["ll_targets", "ll_equip_filter", "ll_autorefresh", "ll_sort", "ll_hide_badges", "ll_mail_template", "ll_alert_rules", "ll_sse_alerts"]);
      sseAlerts = !!ll_sse_alerts;
      if (Array.isArray(ll_targets) && ll_targets.length) targets = ll_targets;
      equipFilter = LLEQUIP.normalize(ll_equip_filter);
      if (typeof LLRULES !== "undefined") alertRules = LLRULES.normalize(ll_alert_rules);
      if (typeof ll_mail_template === "string" && ll_mail_template.trim()) mailTemplate = ll_mail_template;
      hideBadges = !!ll_hide_badges;
      // on = глобальный тумблер попапа (ll_autorefresh.on) с per-tab override из панели (sessionStorage).
      const globalOn = !!(ll_autorefresh && ll_autorefresh.on);
      autoRefresh = {
        on: (typeof LLTAB !== "undefined") ? LLTAB.resolveAutorefresh(sessionStorage, globalOn) : globalOn,
        intervalMs: (ll_autorefresh && ll_autorefresh.intervalMs) || 180000,
        scroll: !ll_autorefresh || ll_autorefresh.autoscroll !== false, // дефолт ВКЛ
        maxSteps: (ll_autorefresh && ll_autorefresh.maxSteps) || LLPOLICY.DEFAULT_MAX_STEPS,
        // окно тишины: ключа нет → дефолт 22–5 (в том числе у всех, кто настраивал авто-пилот раньше)
        quiet: LLPOLICY.normalizeQuiet(ll_autorefresh ? ll_autorefresh.quiet : undefined),
      };
      if (ll_sort && ll_sort.field) sortPref = { field: ll_sort.field, dir: ll_sort.dir === "asc" ? "asc" : "desc" };
    } catch { /* дефолт */ }
    if (cloudCfg) autoRefresh.on = true;
    // если эта загрузка — наш авто-рефреш через reload, переприменим сортировку к свежей выдаче
    try {
      if (sessionStorage.getItem("ll_autopilot_reload")) {
        sessionStorage.removeItem("ll_autopilot_reload");
        if (sortPref) pendingSortReapply = true;
      }
      // Момент последнего reload переживает саму перезагрузку — иначе потолок «раз в 15 минут»
      // обнулялся бы каждым reload и не ограничивал ничего.
      const at = Number(sessionStorage.getItem("ll_autopilot_reload_at"));
      if (Number.isFinite(at) && at > 0) lastReloadAt = at;
    } catch { /* нет sessionStorage */ }
    try { if (typeof LLTAB !== "undefined") hintsOff = LLTAB.getHintsOff(sessionStorage); } catch (_) { /* нет sessionStorage */ }
    // парк водителей диспетчера (если залогинен); активный — per-device выбор
    if (typeof LLAPI !== "undefined" && typeof LLDRV !== "undefined") {
      try {
        drivers = await LLAPI.getDrivers();
        if (drivers.length) activeDriver = LLDRV.pickActive(drivers, await LLDRV.getActiveId());
      } catch { drivers = []; activeDriver = null; }
    }
    // живое применение настроек из попапа без перезагрузки страницы
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (ch.ll_cpm && ch.ll_cpm.newValue > 0) baseCostPerMile = ch.ll_cpm.newValue; // обновляем базу; render→applyDriverContext применит
        if (ch.ll_hos && ch.ll_hos.newValue) baseHos = ch.ll_hos.newValue;              // аналогично для HOS
        if (ch.ll_targets) targets = (Array.isArray(ch.ll_targets.newValue) && ch.ll_targets.newValue.length) ? ch.ll_targets.newValue : LLSCORE.DEFAULTS.targets;
        if (ch.ll_equip_filter) equipFilter = LLEQUIP.normalize(ch.ll_equip_filter.newValue);
        if (ch.ll_alert_rules && typeof LLRULES !== "undefined") alertRules = LLRULES.normalize(ch.ll_alert_rules.newValue);
        if (ch.ll_sse_alerts) sseAlerts = !!ch.ll_sse_alerts.newValue;
        if (ch.ll_mail_template) {
          const v = ch.ll_mail_template.newValue;
          mailTemplate = (typeof v === "string" && v.trim()) ? v : LLMAIL.DEFAULT_TEMPLATE;
        }
        if (ch.ll_hide_badges) hideBadges = !!ch.ll_hide_badges.newValue;
        if (ch.ll_autorefresh) {
          const v = ch.ll_autorefresh.newValue, prev = ch.ll_autorefresh.oldValue;
          autoRefresh.intervalMs = (v && v.intervalMs) || 180000;
          autoRefresh.scroll = !v || v.autoscroll !== false;
          autoRefresh.maxSteps = (v && v.maxSteps) || LLPOLICY.DEFAULT_MAX_STEPS;
          autoRefresh.quiet = LLPOLICY.normalizeQuiet(v ? v.quiet : undefined);
          // Глобальный тумблер переключили в попапе → побеждает последнее действие: снимаем per-tab
          // override и применяем глобальное значение ко всем вкладкам DAT.
          const on = !!(v && v.on);
          if (on !== !!(prev && prev.on)) {
            if (typeof LLTAB !== "undefined") LLTAB.clearAutorefresh(sessionStorage);
            autoRefresh.on = cloudCfg ? true : on;
            if (on && autoRefresh.scroll) scrollToLoadAll();
          }
          scheduleAuto();
        }
        if (ch.ll_sort) {
          const v = ch.ll_sort.newValue;
          sortPref = (v && v.field) ? { field: v.field, dir: v.dir === "asc" ? "asc" : "desc" } : null;
          applySortPref(); // применить новую сортировку сразу
        }
        schedule();
      });
    } catch { /* нет API */ }

    // приём перехваченных ответов DAT FindLoads из MAIN-world inject.js
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== "loadlens") return;
      if (d.type === "dat-match-event") { try { onMatchEvent(d.payload); } catch (err) { log("match event error", err); } return; }
      // Поток live-матчей открылся/закрылся: от этого зависит база тика авто-пилота и бюджет
      // скролла, поэтому таймер переводим сразу, не дожидаясь следующего срабатывания.
      if (d.type === "dat-sse-open" || d.type === "dat-sse-close") {
        const sid = d.payload && d.payload.searchId;
        if (d.type === "dat-sse-open") sseStreams.add(sid); else sseStreams.delete(sid);
        log("SSE stream", d.type === "dat-sse-open" ? "open" : "closed", sid, "— live streams:", sseStreams.size);
        // Перевзводим таймер, ТОЛЬКО если сменился сам режим (был/стал живой SSE). DAT переоткрывает
        // потоки регулярно, а при базе в 10 минут пересоздание на каждое открытие означало бы, что
        // тик не наступит никогда.
        if (autoRefresh.on && sseLive() !== autoTimerSseLive) scheduleAuto();
        schedule();
        return;
      }
      if (d.type !== "dat-findloads") return;
      if (typeof DAT_GQL !== "undefined") {
        const res = DAT_GQL.parseFindLoadsResult(d.payload);
        log("received dat-findloads → parse:", res.loads.length, "loads, searchId", res.searchId || "—", res.loads.length ? "" : "(empty — the DAT schema may have changed)");
        lastDataAt = Date.now(); // выдача обновилась — reload точно не нужен (см. LLPOLICY.allowReload)
        if (cloudCfg) LLCLOUD.markFindLoads(sessionStorage, Date.now());
        if (res.loads.length) {
          // накапливаем по searchId: та же выдача (пагинация) доливает, новый поиск сбрасывает
          const acc = LLACC.accumulate(accState, res.loads, res.searchId);
          accState = acc.state; gqlLoads = acc.loads; schedule();
          // только сразу после НАШЕГО clickRefresh переприменяем удерживаемую сортировку (не на каждый ответ DAT)
          if (pendingSortReapply) { pendingSortReapply = false; applySortPref(); }
          // первая страница новой выдачи → запустить доскролл остальных (гард scrolling от повторов)
          if (autoRefresh.on && autoRefresh.scroll && !scrolling) scrollToLoadAll();
        }
      } else {
        log("received dat-findloads, but DAT_GQL is not loaded");
      }
    });

    // Cloud mode: heartbeat на бэкенд (раз в 5 мин или при смене состояния). Метки — в sessionStorage,
    // т.к. авто-пилот перезагружает вкладку каждые 60–120 с и таймеры в памяти не доживают.
    // Метка «отправлено» ставится только после ответа 2xx (LLCLOUD.tickHeartbeat): без JWT/сети
    // повтор на следующем тике, а не через 5 мин. hbInFlight — не дублировать при зависшем запросе.
    if (cloudCfg && typeof LLAPI !== "undefined") {
      let hbInFlight = false;
      const tick = async () => {
        if (hbInFlight) return;
        const now = Date.now();
        const hb = LLCLOUD.heartbeat({
          hostname: location.hostname, lastFindLoadsAt: LLCLOUD.lastFindLoads(sessionStorage),
          now, intervalMs: autoRefresh.intervalMs, loadsSeen: gqlLoads.length,
        });
        hbInFlight = true;
        try { await LLCLOUD.tickHeartbeat({ ss: sessionStorage, now, hb, send: LLAPI.cloudHeartbeat }); }
        finally { hbInFlight = false; }
      };
      // первый тик с задержкой: DAT ещё восстанавливает поиск после reload; на странице логина — сразу
      setTimeout(tick, /^login\./i.test(location.hostname) ? 0 : 20000);
      setInterval(tick, HEARTBEAT_TICK_MS);
    }

    booted = true; // порт мог подключиться раньше — финальный render ниже отдаст ему первый снапшот
    render();
    scheduleAuto(); // запустить авто-рефреш, если включён в настройках
    const obs = new MutationObserver(() => schedule());
    obs.observe(document.body, { childList: true, subtree: true });
    let lastPath = location.pathname + location.search;
    setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== lastPath) { lastPath = cur; schedule(); }
    }, 600);
    // живой монитор: пока боковая панель смотрит на эту вкладку и та видима — delta-poll neighborhood'ов цепочки
    setInterval(() => {
      if (!panelPort || document.visibilityState !== "visible") return;
      const onward = [...new Set(currentLoads().map((l) => l.destMarket))];
      if (onward.length) fetchCrowdLoads(onward, { poll: true });
    }, POLL_MS);
  }
  // Боковая панель подключается портом ll-panel. Слушатель вешаем СИНХРОННО до boot(): boot ждёт сеть
  // (дизель, парк водителей), и панель, постучавшаяся в это время, получила бы «Receiving end does not
  // exist». Порт запоминаем сразу, а рисуем только после boot — до него настройки ещё дефолтные.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "ll-panel") return;
    panelPort = port;
    lastSnapJson = ""; // новому слушателю — полный снапшот сразу
    port.onMessage.addListener((m) => { if (booted) onPanelCmd(m).catch((err) => log("panel cmd error", err)); });
    port.onDisconnect.addListener(() => { if (panelPort === port) { panelPort = null; if (booted) render(); } });
    if (booted) render();
  });
  boot();
})();
