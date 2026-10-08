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
    // Пол знаменателя $/mi. На 30 милях $/mi бессмыслен: подача, погрузка и время не бесплатны, а при
    // поиске по зонам/штатам DAT не отдаёт deadhead — и $500 за 30 миль светился green как $16.7/mi.
    // Топливо считаем по реальным милям, делим не меньше чем на minMiles.
    minMiles: 100,
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

  // true RPM = ставка / (груженые мили + deadhead до пикапа), не меньше чем на minMiles. Крауд-медиана
  // lane считается на бэкенде своей формулой (rpmCents) — пол её не трогает.
  function trueRpm(rate, loadedMiles, deadheadMiles, minMiles = DEFAULTS.minMiles) {
    const miles = (loadedMiles || 0) + (deadheadMiles || 0);
    if (!rate || miles <= 0) return null;
    return rate / Math.max(miles, minMiles || 0);
  }

  // net RPM = (ставка - топливо - tolls) / общие мили (не меньше minMiles). Учитывает затраты.
  function netRpm(load, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const total = (load.loadedMiles || 0) + (load.deadheadMiles || 0);
    if (!load.rate || total <= 0) return null;
    const cost = fuelCost(total, o.dieselPrice, o.mpg) + tollsCost(total, o.tollsPerMile);
    return (load.rate - cost) / Math.max(total, o.minMiles || 0);
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
    const o = { aboveMarketX: 1.5, creditRisk: 75, newAuthMedDays: 180, newAuthHighDays: 90,
      repostMinCount: 4, repostMinDays: 3, ...opts };
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
    // Fraud Shield: лицензия FMCSA (status — только из QCMobile; null = нет данных → молчим)
    const a = ctx.shield && ctx.shield.authority;
    if (a) {
      if (a.status === "inactive") flags.push({ code: "authority_inactive", sev: "high", label: "FMCSA: broker authority inactive" });
      if (a.status === "carrier_only") flags.push({ code: "carrier_brokering", sev: "high",
        label: "FMCSA: carrier authority only — possible double-brokering" });
      if (a.status === "not_found") flags.push({ code: "authority_not_found", sev: "high", label: "FMCSA: MC not found" });
      if (a.ageDays != null && a.ageDays < o.newAuthMedDays) flags.push({ code: "new_authority",
        sev: a.ageDays < o.newAuthHighDays ? "high" : "med", label: `new broker authority: ${a.ageDays} days` });
      if (a.incidents12m > 0) flags.push({ code: "authority_incidents", sev: "med",
        label: `FMCSA: ${a.incidents12m} suspension/revocation event${a.incidents12m > 1 ? "s" : ""} in 12 mo` });
    }
    const rp = ctx.shield && ctx.shield.repost;
    if (rp && rp.count >= o.repostMinCount && rp.days >= o.repostMinDays) flags.push({ code: "reposted", sev: "med",
      label: `reposted ${rp.count}× over ${rp.days} days` });
    return flags;
  }

  function redFlagLevel(flags) {
    return flags.some((f) => f.sev === "high") ? "high" : flags.length ? "med" : "none";
  }

  // Чип 🛡 в полосе брокера: сводка Fraud Shield одним словом. risk — любой high-сигнал лицензии;
  // warn — лицензии < 1 года или были инциденты; good — есть возраст/статус и всё чисто.
  function shieldBadge(shield) {
    const a = shield && shield.authority;
    if (!a || (a.status == null && a.ageDays == null)) return { level: "unknown", text: "🛡 ?", title: "FMCSA data unavailable" };
    const age = a.ageDays == null ? null
      : a.ageDays >= 365 ? Math.floor(a.ageDays / 365) + "y"
      : a.ageDays >= 90 ? Math.floor(a.ageDays / 30) + "mo" : a.ageDays + "d";
    const bad = a.status === "inactive" || a.status === "carrier_only" || a.status === "not_found";
    const title = [
      a.status ? "FMCSA status: " + a.status.replace("_", " ") : "FMCSA status: n/a",
      a.grantedAt ? "broker authority since " + a.grantedAt : null,
      a.incidents12m ? `${a.incidents12m} suspension/revocation event(s) in 12 mo` : null,
    ].filter(Boolean).join("\n");
    if (bad) return { level: "risk", text: "🛡 ✗", title };
    if (a.ageDays != null && a.ageDays < 90) return { level: "risk", text: "🛡 " + age, title };
    if ((a.ageDays != null && a.ageDays < 365) || a.incidents12m > 0) return { level: "warn", text: "🛡 " + (age || "?"), title };
    return { level: "good", text: ["🛡", age, a.status === "active" ? "✓" : null].filter(Boolean).join(" "), title };
  }

  const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

  // Контр-оффер: сколько просить у брокера и одной строкой — что сказать.
  // Постированная ставка — стартовая позиция брокера (в среднем 10–30% зазора), поэтому
  // просим минимум на 10% выше, но не ниже рынка и не ниже break-even с маржой.
  // ctx = { laneMedian (медиана true $/mi по lane), costPerMile }.
  // -> { ask, script } либо { ask: null, script: null }, если данных не хватает.
  function counterOffer(load, ctx = {}) {
    const none = { ask: null, script: null };
    const rate = Number(load && load.rate);
    const total = ((load && load.loadedMiles) || 0) + ((load && load.deadheadMiles) || 0);
    if (!rate || total <= 0) return none;

    const costPerMile = ctx.costPerMile != null ? Number(ctx.costPerMile) : DEFAULTS.costPerMile;
    const laneMedian = ctx.laneMedian != null ? Number(ctx.laneMedian) : null;
    const marketRate = laneMedian != null ? laneMedian * total : null;
    const minAsk = rate * 1.10;                       // нижняя граница: всегда выше постинга

    let raw = Math.max(minAsk, costPerMile * total * 1.15, marketRate || 0);
    // потолок «не проси абсурд»: не выше рынка +15%, но и не ниже минимального шага
    if (marketRate != null) raw = Math.min(raw, Math.max(marketRate * 1.15, minAsk));
    const ask = Math.ceil(raw / 25) * 25;

    const dh = (load.deadheadMiles || 0);
    const parts = [];
    if (laneMedian != null) parts.push(`market ≈ $${laneMedian.toFixed(2)}/mi`);
    if (dh > 0) parts.push(`+${dh}mi deadhead`);
    const tail = parts.length ? ` (${parts.join(", ")})` : "";
    return { ask, script: `Offered ${usd(rate)} — I can do ${usd(ask)}${tail}.` };
  }

  return { DEFAULTS, fuelCost, tollsCost, trueRpm, netRpm, targetForMiles, profitBadge, brokerBadge, redFlags, redFlagLevel, shieldBadge, counterOffer };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLSCORE;
if (typeof globalThis !== "undefined") globalThis.LLSCORE = LLSCORE;
