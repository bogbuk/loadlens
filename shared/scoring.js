/* LoadLens — profit-scoring (чистые функции). Zero-dep CommonJS: браузер + Node + тесты.
   Считает true RPM / net RPM / бейдж выгодности относительно break-even и медианы lane. */
const LLSCORE = (() => {
  "use strict";

  const DEFAULTS = {
    costPerMile: 1.80,   // конфиг пользователя; ATRI 2024: all-in $2.26, non-fuel $1.779
    mpg: 6.5,            // средний расход тягача
    tollsPerMile: 0.04,  // грубая оценка платных дорог (HERE/реальные tolls — фаза 2)
    greenMult: 1.25,     // green требует netRpm >= greenMult * breakeven
  };

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

    let level;
    if (nr == null) level = "unknown";
    else if (nr < breakeven) level = "red";                                  // в убыток
    else if (laneMedian != null && nr >= laneMedian && nr >= o.greenMult * breakeven) level = "green";
    else if (laneMedian == null && nr >= o.greenMult * breakeven) level = "green"; // нет рынка — по break-even
    else level = "amber";                                                    // в плюс, но ниже рынка/порога
    return { level, netRpm: nr, trueRpm: tr, laneMedian, breakeven };
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
      label: `ставка $${rpm.toFixed(2)}/mi сильно выше рынка ($${laneMedian.toFixed(2)})` });
    if (!load.brokerMc) flags.push({ code: "no_mc", sev: "med", label: "нет MC-номера брокера" });
    if (aboveMarket && lowCredit) flags.push({ code: "bait_combo", sev: "high",
      label: `приманка: ставка выше рынка + низкий credit (${load.creditScore})` });
    if (ctx.reputation && ctx.reputation.level === "bad") flags.push({ code: "crowd_bad", sev: "high",
      label: ctx.reputation.doubleBrokered ? "crowd: double-brokered" : "crowd: флейкал" });
    return flags;
  }

  function redFlagLevel(flags) {
    return flags.some((f) => f.sev === "high") ? "high" : flags.length ? "med" : "none";
  }

  return { DEFAULTS, fuelCost, tollsCost, trueRpm, netRpm, profitBadge, brokerBadge, redFlags, redFlagLevel };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLSCORE;
if (typeof globalThis !== "undefined") globalThis.LLSCORE = LLSCORE;
