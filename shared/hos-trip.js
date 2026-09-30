/* LoadLens — HOS-калькулятор для страницы лендинга /hos-calculator/.
   Zero-dep (браузер + Node + тесты), все величины — минуты. Модель упрощённая (см. спеку
   2026-09-30-hos-calculator-page-design): 11h driving, окно 14h, 30-мин перерыв после 8h вождения,
   цикл 70/8 или 60/7, 10h reset, 34h restart. Split sleeper, adverse conditions, short-haul и
   «скатывание» часов цикла по дням не моделируются. planner.stepHos сознательно не трогаем —
   он питает скоринг расширения. */
const LLHOSTRIP = (() => {
  "use strict";

  const DRIVE = 660, WINDOW = 840, BREAK_AFTER = 480, BREAK = 30, RESET = 600, RESTART = 2040;
  const CYCLES = { "70-8": 4200, "60-7": 3600 };
  const LIMITS = { drive: DRIVE, window: WINDOW, break: BREAK_AFTER };
  const MAX_STEPS = 400;                         // страховка от бесконечного цикла; при mph ≥ 30 недостижимо
  const ORDER = ["cycle", "window", "drive", "break"]; // при равенстве — то, что лечится дольше

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));
  const orDefault = (v, d) => (v == null || v === "" ? d : v);

  function normalize(s = {}) {
    const cycle = CYCLES[s.cycle] ? s.cycle : "70-8";
    const drivenMin = clamp(s.drivenMin, 0, DRIVE);
    return {
      cycle,
      drivenMin,
      shiftMin: clamp(s.shiftMin, 0, WINDOW),
      // 10h reset тоже перерыв, поэтому вождение после перерыва не может превышать вождение в смене
      sinceBreakMin: clamp(s.sinceBreakMin, 0, Math.min(BREAK_AFTER, drivenMin)),
      cycleUsedMin: clamp(s.cycleUsedMin, 0, CYCLES[cycle]),
    };
  }

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
    return { ...r, driveNow: r[limitedBy], limitedBy };
  }

  function plan(state, trip = {}) {
    const s = normalize(state);
    const limit = CYCLES[s.cycle];
    const miles = clamp(trip.miles, 0, 5000);
    const mph = clamp(orDefault(trip.mph, 55), 30, 75);
    const loadMin = clamp(orDefault(trip.loadMin, 60), 0, 600);
    const unloadMin = clamp(orDefault(trip.unloadMin, 60), 0, 600);
    let driven = s.drivenMin, shift = s.shiftMin, since = s.sinceBreakMin, used = s.cycleUsedMin;
    const raw = [];

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
      shift += min; used += min;
      if (min >= BREAK) since = 0;
    };

    duty(loadMin);
    let left = Math.round((miles / mph) * 60);
    for (let step = 0; left > 0 && step < MAX_STEPS; step++) {
      const now = Math.max(0, Math.min(DRIVE - driven, WINDOW - shift, BREAK_AFTER - since, limit - used));
      if (now > 0) {
        const d = Math.min(left, now);
        push("drive", d, (d * mph) / 60);
        driven += d; shift += d; since += d; used += d; left -= d;
      } else if (limit - used <= 0) {
        push("restart", RESTART);
        driven = 0; shift = 0; since = 0; used = 0;
      } else if (DRIVE - driven <= 0 || WINDOW - shift <= BREAK) {
        // окно почти закрыто — 30-мин перерыв бесполезен, нужен 10h reset
        push("reset", RESET);
        driven = 0; shift = 0; since = 0;
      } else {
        push("break", BREAK);
        shift += BREAK; since = 0;
      }
    }
    duty(unloadMin);

    const segments = raw.map((x) => (x.type === "drive" ? { type: x.type, min: x.min, miles: Math.round(x.mi) } : { type: x.type, min: x.min }));
    const sum = (types) => segments.filter((x) => types.includes(x.type)).reduce((a, x) => a + x.min, 0);
    return {
      segments,
      totalMin: sum(["duty", "drive", "break", "reset", "restart"]),
      driveMin: sum(["drive"]),
      restMin: sum(["break", "reset", "restart"]),
      resets: segments.filter((x) => x.type === "reset").length,
      restarts: segments.filter((x) => x.type === "restart").length,
    };
  }

  return { normalize, remaining, plan, LIMITS, CYCLES };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLHOSTRIP;
if (typeof globalThis !== "undefined") globalThis.LLHOSTRIP = LLHOSTRIP;
