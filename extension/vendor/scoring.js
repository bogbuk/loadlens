/* AUTO-GENERATED копия из /shared — НЕ РЕДАКТИРОВАТЬ. Источник правды: shared/. Пересобрать: npm run sync:shared */
/* LoadLens — profit-scoring (чистые функции). Zero-dep CommonJS: браузер + Node + тесты.
   Считает true RPM / net RPM / бейдж выгодности относительно break-even и медианы lane. */
const LLSCORE = (() => {
  "use strict";

  const DEFAULTS = {
    costPerMile: 1.80,   // конфиг пользователя; ATRI 2024: all-in $2.26, non-fuel $1.779
    mpg: 6.5,            // средний расход тягача
    tollsPerMile: 0.04,  // грубая оценка платных дорог (HERE/реальные tolls — фаза 2)
    greenMult: 1.25,     // фолбэк-порог green (netRpm >= greenMult*breakeven), когда цель не задана
    // Целевая (gross true $/mi) ставка по бакетам trip-миль: короткие плечи требуют выше $/милю.
    // Упорядочены по возрастанию maxMi; последняя строка maxMi:null = «и больше».
    targets: [{ maxMi: 500, rpm: 7.0 }, { maxMi: 1000, rpm: 6.0 }, { maxMi: null, rpm: 5.0 }],
  };

  // Целевой $/милю для груза по его trip-милям (loadedMiles). table — массив {maxMi, rpm},
  // упорядоченный по возрастанию maxMi (последняя строка maxMi:null/Infinity = overflow).
  // Граница включительна (miles <= maxMi). Без дистанции -> null (бакет неопределим).
  function targetForMiles(miles, table = DEFAULTS.targets) {
    const m = Number(miles);
    if (!m || m <= 0 || !Array.isArray(table) || !table.length) return null;
    for (const row of table) {
      if (row.maxMi == null || m <= row.maxMi) return row.rpm;
    }
    return table[table.length - 1].rpm;
  }

  // топливо на плечо: (loaded + deadhead) миль / mpg * цена дизеля
  function fuelCost(miles, dieselPrice, mpg = DEFAULTS.mpg) {
    if (!miles || !dieselPrice) return 0;
    return (miles / mpg) * dieselPrice;
  }

  function tollsCost(miles, perMile = DEFAULTS.tollsPerMile) {
    return (miles || 0) * perMile;
  }

  // true RPM = ставка / (груженые мили + deadhead до пикапа). Главная метрика (= metric в lane-базе).
  function trueRpm(rate, loadedMiles, deadheadMiles) {
    const denom = (loadedMiles || 0) + (deadheadMiles || 0);
    if (!rate || denom <= 0) return null;
    return rate / denom;
  }

  // net RPM = (ставка - топливо - tolls) / общие мили. Учитывает затраты.
  function netRpm(load, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const total = (load.loadedMiles || 0) + (load.deadheadMiles || 0);
    if (!load.rate || total <= 0) return null;
    const cost = fuelCost(total, o.dieselPrice, o.mpg) + tollsCost(total, o.tollsPerMile);
    return (load.rate - cost) / total;
  }

  // Бейдж выгодности груза. laneMedian — медиана trueRpm по lane из крауд-базы (или null).
  // -> { level: 'red'|'amber'|'green'|'unknown', netRpm, trueRpm, laneMedian, breakeven }
  function profitBadge(load, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const nr = netRpm(load, o);
    const tr = trueRpm(load.rate, load.loadedMiles, load.deadheadMiles);
    const breakeven = o.costPerMile;
    const laneMedian = o.laneMedian != null ? o.laneMedian : null;

    const targetRpm = o.targetRpm != null ? Number(o.targetRpm) : null;

    let level;
    if (nr == null) level = "unknown";
    else if (nr < breakeven) level = "red";                                  // в убыток (нижняя граница)
    else if (targetRpm != null) level = (tr != null && tr >= targetRpm) ? "green" : "amber"; // цель = порог green
    else if (laneMedian != null && nr >= laneMedian && nr >= o.greenMult * breakeven) level = "green";
    else if (laneMedian == null && nr >= o.greenMult * breakeven) level = "green"; // нет рынка/цели — по break-even
    else level = "amber";                                                    // в плюс, но ниже рынка/порога
    return { level, netRpm: nr, trueRpm: tr, laneMedian, breakeven, targetRpm };
  }

  // Broker-trust бейдж по DAT-данным: creditScore (0..100, выше=лучше) + daysToPay (ниже=лучше).
  // Это carrier-сторона фрод-защиты (исследование: фрод = baseline-боль, инструменты защищают брокера).
  // -> { level: 'good'|'ok'|'risk'|'unknown', creditScore, daysToPay }
  function brokerBadge(load, opts = {}) {
    const o = { creditMin: 90, creditRisk: 75, dtpOk: 30, dtpRisk: 40, ...opts };
    const cs = load.creditScore == null ? null : Number(load.creditScore);
    const dtp = load.daysToPay == null ? null : Number(load.daysToPay);
    if (cs == null && dtp == null) return { level: "unknown", creditScore: null, daysToPay: null };
    let level = "good";
    if ((cs != null && cs < o.creditRisk) || (dtp != null && dtp > o.dtpRisk)) level = "risk";
    else if ((cs != null && cs < o.creditMin) || (dtp != null && dtp > o.dtpOk)) level = "ok";
    return { level, creditScore: cs, daysToPay: dtp };
  }

  // Red-flag эвристики фрода/double-brokering (исследование: фрод = baseline-боль).
  // ctx = { laneMedian, reputation } (медиана RPM рынка по lane + crowd-репутация брокера).
  // -> [{ code, sev: 'high'|'med', label }]
  function redFlags(load, ctx = {}, opts = {}) {
    const o = { aboveMarketX: 1.5, creditRisk: 75, ...opts };
    const flags = [];
    const rpm = load.estimatedRatePerMile != null
      ? Number(load.estimatedRatePerMile)
      : trueRpm(load.rate, load.loadedMiles, load.deadheadMiles);
    const laneMedian = ctx.laneMedian != null ? Number(ctx.laneMedian) : null;
    const aboveMarket = laneMedian != null && rpm != null && rpm > laneMedian * o.aboveMarketX;
    const lowCredit = load.creditScore != null && Number(load.creditScore) < o.creditRisk;

    if (aboveMarket) flags.push({ code: "rate_above_market", sev: "med",
      label: `rate $${rpm.toFixed(2)}/mi far above market ($${laneMedian.toFixed(2)})` });
    if (!load.brokerMc) flags.push({ code: "no_mc", sev: "med", label: "no broker MC number" });
    if (aboveMarket && lowCredit) flags.push({ code: "bait_combo", sev: "high",
      label: `bait: rate above market + low credit (${load.creditScore})` });
    if (ctx.reputation && ctx.reputation.level === "bad") flags.push({ code: "crowd_bad", sev: "high",
      label: ctx.reputation.doubleBrokered ? "crowd: double-brokered" : "crowd: flaked" });
    return flags;
  }

  function redFlagLevel(flags) {
    return flags.some((f) => f.sev === "high") ? "high" : flags.length ? "med" : "none";
  }

  return { DEFAULTS, fuelCost, tollsCost, trueRpm, netRpm, targetForMiles, profitBadge, brokerBadge, redFlags, redFlagLevel };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLSCORE;
if (typeof globalThis !== "undefined") globalThis.LLSCORE = LLSCORE;
