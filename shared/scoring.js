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

  return { DEFAULTS, fuelCost, tollsCost, trueRpm, netRpm, profitBadge };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLSCORE;
if (typeof globalThis !== "undefined") globalThis.LLSCORE = LLSCORE;
