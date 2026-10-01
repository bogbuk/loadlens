/* AUTO-GENERATED копия из /shared — НЕ РЕДАКТИРОВАТЬ. Источник правды: shared/. Пересобрать: npm run sync:shared */
/* LoadLens — HOS-калькулятор для страницы лендинга /hos-calculator/.
   Zero-dep (браузер + Node + тесты), все величины — минуты. Модель упрощённая (см. спеку
   2026-09-30-hos-calculator-page-design): 11h driving, окно 14h, 30-мин перерыв после 8h вождения,
   цикл 70/8 или 60/7, 10h reset, 34h restart. Split sleeper — только остаток часов (splitPair),
   план рейса по-прежнему ставит полные 10h reset. Recap — если заданы часы по дням (days[0] = сегодня,
   days[i] = i дней назад): в полночь самый старый день выпадает из цикла, а при исчерпанном цикле план
   ждёт ближайшую полночь, вернувшую часы, вместо 34h restart (если это быстрее). Без days цикл в рейсе
   постоянный. Adverse conditions и short-haul не моделируются. planner.stepHos сознательно не трогаем —
   он питает скоринг расширения. */
const LLHOSTRIP = (() => {
  "use strict";

  const DRIVE = 660, WINDOW = 840, BREAK_AFTER = 480, BREAK = 30, RESET = 600, RESTART = 2040;
  const CYCLES = { "70-8": 4200, "60-7": 3600 };
  const DAYS = { "70-8": 8, "60-7": 7 };
  const DAY = 1440;
  const RECAP_MIN_GAIN = 60;                     // ждать полночь ради пары минут цикла бессмысленно
  const LIMITS = { drive: DRIVE, window: WINDOW, break: BREAK_AFTER };
  const SPLIT_LONG = 420, SPLIT_SHORT = 120;     // пара: ≥7h в sleeper + ≥2h, сумма ≥10h
  const MAX_STEPS = 400;                         // страховка от бесконечного цикла; при mph ≥ 30 недостижимо
  const ORDER = ["cycle", "window", "drive", "break"]; // при равенстве — то, что лечится дольше

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));
  const orDefault = (v, d) => (v == null || v === "" ? d : v);

  function normalize(s = {}) {
    const cycle = CYCLES[s.cycle] ? s.cycle : "70-8";
    const drivenMin = clamp(s.drivenMin, 0, DRIVE);
    const days = Array.isArray(s.days)
      ? Array.from({ length: DAYS[cycle] }, (_, i) => clamp(s.days[i], 0, DAY)) : null;
    const out = {
      cycle,
      drivenMin,
      shiftMin: clamp(s.shiftMin, 0, WINDOW),
      // 10h reset тоже перерыв, поэтому вождение после перерыва не может превышать вождение в смене.
      // Не заполнено → перерыва в смене не было (консервативно: иначе план мог бы нарушить правило 30 мин).
      sinceBreakMin: clamp(orDefault(s.sinceBreakMin, drivenMin), 0, Math.min(BREAK_AFTER, drivenMin)),
      cycleUsedMin: clamp(days ? sumOf(days) : s.cycleUsedMin, 0, CYCLES[cycle]),
    };
    if (days) out.days = days;
    return out;
  }

  function sumOf(a) { return a.reduce((x, y) => x + y, 0); }

  function remaining(state) {
    const s = normalize(state);
    const r = {
      drive: DRIVE - s.drivenMin,
      window: WINDOW - s.shiftMin,
      break: BREAK_AFTER - s.sinceBreakMin,
      cycle: CYCLES[s.cycle] - s.cycleUsedMin,
    };
    let limitedBy = ORDER[0];
    for (const k of ORDER) if (r[k] < r[limitedBy]) limitedBy = k;
    const driveNow = r[limitedBy];
    // Перерыв наступит первым, но после него от окна останется ≤30 мин — дальше всё равно 10h reset (как в plan()).
    if (limitedBy === "break" && r.window - r.break <= BREAK) limitedBy = "window";
    const out = { ...r, driveNow, limitedBy };
    if (s.days) out.recapMin = s.days[s.days.length - 1];
    return out;
  }

  function plan(state, trip = {}) {
    const s = normalize(state);
    const limit = CYCLES[s.cycle];
    const miles = clamp(trip.miles, 0, 5000);
    const mph = clamp(orDefault(trip.mph, 55), 30, 75);
    const loadMin = clamp(orDefault(trip.loadMin, 60), 0, 600);
    const unloadMin = clamp(orDefault(trip.unloadMin, 60), 0, 600);
    let driven = s.drivenMin, shift = s.shiftMin, since = s.sinceBreakMin, flatUsed = s.cycleUsedMin;
    // Часы по дням: часы машины (минуты от полуночи) нужны, чтобы знать, когда выпадет старый день.
    let days = s.days ? s.days.slice() : null;
    let clock = clamp(trip.clockMin, 0, DAY - 1);
    const used = () => (days ? Math.min(limit, sumOf(days)) : flatUsed);
    const toMidnight = () => DAY - clock;
    const raw = [];

    // Время идёт: on-duty копится в сегодняшний день, на полуночи старейший день выпадает.
    const advance = (min, onDuty) => {
      if (!days) { if (onDuty) flatUsed += min; return; }
      while (min > 0) {
        const c = Math.min(min, toMidnight());
        if (onDuty) days[0] += c;
        clock += c; min -= c;
        if (clock >= DAY) { clock = 0; days = [0, ...days.slice(0, -1)]; }
      }
    };
    // Через сколько минут ожидания вернётся хотя бы need минут цикла; null — не раньше 34h.
    const recapWait = (need) => {
      let a = days.slice(), t = toMidnight();
      for (; t < RESTART; t += DAY) {
        a = [0, ...a.slice(0, -1)];
        if (limit - sumOf(a) >= need) return t;
      }
      return null;
    };

    const push = (type, min, mi) => {
      if (min <= 0) return;
      const last = raw[raw.length - 1];
      if (last && last.type === type) { last.min += min; last.mi += mi || 0; }
      else raw.push({ type, min, mi: mi || 0 });
    };
    // Погрузка/разгрузка — on duty, не driving: правила её не запрещают даже при исчерпанных
    // лимитах; с 2020 on-duty ≥30 мин засчитывается как 30-минутный перерыв.
    const duty = (min) => {
      push("duty", min);
      shift += min; advance(min, true);
      if (min >= BREAK) since = 0;
    };

    duty(loadMin);
    let left = Math.round((miles / mph) * 60);
    for (let step = 0; left > 0 && step < MAX_STEPS; step++) {
      // С днями режем вождение по полуночи: после неё цикл может вырасти (сегменты всё равно склеятся).
      const now = Math.max(0, Math.min(DRIVE - driven, WINDOW - shift, BREAK_AFTER - since, limit - used(),
        days ? toMidnight() : Infinity));
      const shiftOut = DRIVE - driven <= 0 || WINDOW - shift <= BREAK;
      const wait = days && limit - used() <= 0 ? recapWait(Math.min(RECAP_MIN_GAIN, left)) : null;
      if (now > 0) {
        const d = Math.min(left, now);
        push("drive", d, (d * mph) / 60);
        driven += d; shift += d; since += d; left -= d; advance(d, true);
      } else if (limit - used() <= 0 && wait == null) {
        push("restart", RESTART);
        if (days) days = days.map(() => 0);
        advance(RESTART, false);
        driven = 0; shift = 0; since = 0; flatUsed = 0;
      } else if (shiftOut && (wait == null || wait < RESET)) {
        // окно почти закрыто — 30-мин перерыв бесполезен, нужен 10h reset (за него может пройти и полночь recap)
        push("reset", RESET);
        advance(RESET, false);
        driven = 0; shift = 0; since = 0;
      } else if (wait != null) {
        // цикл исчерпан, ждём полночь, которая вернёт часы; ≥10h подряд — это заодно и reset
        push("recap", wait);
        advance(wait, false);
        if (wait >= RESET) { driven = 0; shift = 0; } else shift += wait;
        if (wait >= BREAK) since = 0;
      } else {
        push("break", BREAK);
        shift += BREAK; since = 0; advance(BREAK, false);
      }
    }
    duty(unloadMin);

    const segments = raw.map((x) => (x.type === "drive" ? { type: x.type, min: x.min, miles: Math.round(x.mi) } : { type: x.type, min: x.min }));
    const sum = (types) => segments.filter((x) => types.includes(x.type)).reduce((a, x) => a + x.min, 0);
    return {
      segments,
      totalMin: sum(["duty", "drive", "break", "reset", "restart", "recap"]),
      driveMin: sum(["drive"]),
      restMin: sum(["break", "reset", "restart", "recap"]),
      resets: segments.filter((x) => x.type === "reset").length,
      restarts: segments.filter((x) => x.type === "restart").length,
      recaps: segments.filter((x) => x.type === "recap").length,
    };
  }

  // Водитель уже взял первый период пары (49 CFR 395.1(g)(1)(ii)). state — вся смена от начала, ВКЛЮЧАЯ
  // первый отдых; split — сам отдых и что было после него. Пока пара не закрыта, первый отдых не идёт в окно
  // 14h (при условии, что водитель возьмёт второй); после второго 11h/14h считаются от конца первого.
  // Несогласованный ввод зажимаем так, чтобы остаток не вышел больше настоящего.
  function splitPair(state, split = {}) {
    const s = normalize(state);
    const firstMin = Math.max(0, num(split.firstMin));
    if (firstMin < SPLIT_SHORT || firstMin >= RESET) {
      return { ok: false, reason: firstMin < SPLIT_SHORT ? "short" : "full", state: s, now: remaining(s) };
    }
    const drivenAfter = clamp(split.drivenAfterMin, 0, DRIVE);
    const since = clamp(split.sinceMin, 0, WINDOW);
    const longFirst = firstMin >= SPLIT_LONG && !!split.firstSleeper;
    const eff = normalize({
      cycle: s.cycle,
      drivenMin: Math.max(s.drivenMin, drivenAfter),
      shiftMin: Math.max(s.shiftMin - firstMin, since),
      // отдых ≥2h — это и 30-минутный перерыв
      sinceBreakMin: Math.min(s.sinceBreakMin, drivenAfter),
      cycleUsedMin: s.cycleUsedMin,
      days: s.days,
    });
    const afterState = { cycle: s.cycle, drivenMin: drivenAfter, shiftMin: since, sinceBreakMin: 0, cycleUsedMin: s.cycleUsedMin, days: s.days };
    return {
      ok: true,
      secondMin: Math.max(longFirst ? SPLIT_SHORT : SPLIT_LONG, RESET - firstMin),
      secondSleeper: !longFirst,
      state: eff,
      now: remaining(eff),
      after: remaining(afterState),
    };
  }

  return { normalize, remaining, plan, splitPair, LIMITS, CYCLES };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLHOSTRIP;
if (typeof globalThis !== "undefined") globalThis.LLHOSTRIP = LLHOSTRIP;
