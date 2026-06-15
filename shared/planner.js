/* LoadLens — HERO: multi-leg «get out» планировщик цепочек грузов.
   Zero-dep CommonJS (браузер + Node + тесты). Чистая функция с инъекцией зависимостей
   (distance, marketStrength, hosState) — поэтому юнит-тестируется синтетикой без сети/DOM.

   Граф: узлы = markets, рёбра = грузы (Load). Алгоритм — beam search, depth-limited.
   Objective — cycle net-RPM, умноженный на силу рынка финиша (чтобы «выгрести» в сильный рынок).
   HOS-гейт: каждое плечо проверяется на выполнимость по остатку часов (forward-simulation). */
const LLPLAN = (() => {
  "use strict";

  const HOS = { DRIVE: 11 * 60, DUTY: 14 * 60, RESET: 10 * 60 }; // минуты; cycle лимит — в стартовом state
  const AVG_SPEED = 50;            // mph для оценки времени плеча
  const LOAD_UNLOAD_MIN = 2 * 60;  // on-duty (not driving) на загрузку+разгрузку
  const DEFAULTS = {
    mpg: 6.5, dieselPrice: 4.0, tollsPerMile: 0.04, costPerMile: 1.80,
    maxLegs: 3, beamWidth: 8, topN: 5, alpha: 0.5,
  };

  // ---- HOS forward-simulation одного плеча (мультисменная модель) ----
  // state: { remainingDrive, remainingOnDuty, remainingCycle } в минутах.
  // Длинный рейс (>11ч driving) штатно растягивается на несколько смен через 10h reset'ы —
  // это нормальный дальнобой, а не нарушение. Жёсткий лимит — только cycle (70h/8d).
  // Возвращает { feasible, badge, state, idleMin } — после плеча.
  function stepHos(state, driveMin, dutyMin) {
    const { remainingDrive, remainingOnDuty, remainingCycle } = state;
    const totalDuty = driveMin + dutyMin;       // вся on-duty работа плеча (driving + загрузка/разгрузка)
    if (remainingCycle < totalDuty) {           // 70h/8d исчерпан — невыполнимо без 34h restart (вне MVP)
      return { feasible: false, badge: "red", state, idleMin: 0 };
    }

    let badge = "green", idleMin = 0;
    let curDrive = remainingDrive, curDuty = remainingOnDuty;

    // 1) часть driving, влезающая в текущую смену
    const firstDrive = Math.min(driveMin, curDrive, Math.max(0, curDuty - dutyMin));
    let driveLeft = driveMin - firstDrive;
    curDrive -= firstDrive;
    curDuty -= firstDrive;

    // 2) остаток driving — по полным сменам, каждая через 10h reset (добавляет idle)
    while (driveLeft > 0) {
      idleMin += HOS.RESET;
      badge = "amber";                          // понадобился вынужденный сон в рейсе
      curDrive = HOS.DRIVE;
      curDuty = HOS.DUTY;
      const d = Math.min(driveLeft, curDrive);
      driveLeft -= d;
      curDrive -= d;
      curDuty -= d;
    }

    // 3) загрузка/разгрузка (on-duty, не driving) в финальной смене; если не лезет в окно — ещё reset
    if (curDuty < dutyMin) {
      idleMin += HOS.RESET;
      badge = "amber";
      curDrive = HOS.DRIVE;
      curDuty = HOS.DUTY;
    }
    curDuty -= dutyMin;

    if (badge === "green" && (firstDrive > remainingDrive * 0.85 || totalDuty > remainingOnDuty * 0.85))
      badge = "amber";                          // впритык в смену — предупреждаем

    return {
      feasible: true,
      badge,
      state: {
        remainingDrive: curDrive,
        remainingOnDuty: curDuty,
        remainingCycle: remainingCycle - totalDuty,
      },
      idleMin,
    };
  }

  // ТОЛЬКО время вождения (мин). Погрузка/разгрузка передаётся отдельно как dutyMin в stepHos,
  // иначе она засчитывалась бы дважды и как driving (баг «HOS ! на каждом грузе»).
  function legMinutes(miles) {
    return Math.round((miles / AVG_SPEED) * 60);
  }

  // ---- экономика плеча ----
  function legEconomics(load, deadhead, o) {
    const totalMiles = (load.loadedMiles || 0) + deadhead;
    const fuel = (totalMiles / o.mpg) * o.dieselPrice;
    const tolls = totalMiles * o.tollsPerMile;
    return { totalMiles, fuel, tolls, net: (load.rate || 0) - fuel - tolls };
  }

  /**
   * plan(opts) -> ранжированные цепочки.
   * opts:
   *   start:        { market }                         — текущий рынок водителя
   *   hosState:     { remainingDrive, remainingOnDuty, remainingCycle } (мин)
   *   loads:        Load[]                              — видимые + крауд грузы
   *   distance(aMarket, bMarket) -> miles              — дорожные мили (geo.js / fallback)
   *   marketStrength(market) -> 0..1                   — сила рынка (backend / seed)
   *   equipment?:   'V'|'R'|...  — фильтр по типу прицепа (по умолчанию без фильтра)
   *   costPerMile, dieselPrice, mpg, tollsPerMile, maxLegs, beamWidth, topN, alpha
   * Возвращает: [{ legs:[{load,deadhead,driveMin,idleMin,badge,net}], chainNetRpm, rank,
   *               totalMiles, totalNet, totalIdleMin, finalMarket, hosBadge }]
   */
  function plan(opts) {
    const o = { ...DEFAULTS, ...opts };
    const distance = o.distance || (() => 0);
    const strength = o.marketStrength || (() => 0.5);
    const loads = (o.loads || []).filter((l) =>
      l && l.rate != null && (!o.equipment || l.equipment === o.equipment));

    // Индекс грузов по рынку отправления — чтобы не сканировать все на каждом шаге.
    const byOrigin = new Map();
    for (const l of loads) {
      if (!byOrigin.has(l.originMarket)) byOrigin.set(l.originMarket, []);
      byOrigin.get(l.originMarket).push(l);
    }

    const seed = {
      legs: [], node: o.start.market, hos: o.hosState,
      totalRev: 0, totalCost: 0, totalMiles: 0, totalIdleMin: 0,
      visited: new Set([o.start.market]), worstBadge: "green",
    };
    let beam = [seed];
    const results = [];

    for (let depth = 1; depth <= o.maxLegs; depth++) {
      const next = [];
      for (const p of beam) {
        const candidates = byOrigin.get(p.node) || [];
        for (const load of candidates) {
          if (p.visited.has(load.destMarket)) continue;            // без циклов
          const deadhead = Math.round(distance(p.node, load.originMarket)); // 0, если уже в точке
          const driveMin = legMinutes((load.loadedMiles || 0) + deadhead);
          const hos = stepHos(p.hos, driveMin, LOAD_UNLOAD_MIN);
          if (!hos.feasible) continue;                              // HOS-ГЕЙТ

          const eco = legEconomics(load, deadhead, o);
          const leg = {
            load, deadhead, driveMin, idleMin: hos.idleMin,
            badge: hos.badge, net: eco.net,
          };
          const visited = new Set(p.visited); visited.add(load.destMarket);
          const cand = {
            legs: [...p.legs, leg], node: load.destMarket, hos: hos.state,
            totalRev: p.totalRev + (load.rate || 0),
            totalCost: p.totalCost + eco.fuel + eco.tolls,
            totalMiles: p.totalMiles + eco.totalMiles,
            totalIdleMin: p.totalIdleMin + hos.idleMin,
            visited,
            worstBadge: worse(p.worstBadge, hos.badge),
          };
          next.push(score(cand, strength, o));
        }
      }
      next.sort((a, b) => b.rank - a.rank);
      beam = next.slice(0, o.beamWidth);
      // цепочки длиной >= 2 плеч идут в результат (одиночное плечо — это просто скоринг груза)
      for (const c of beam) if (c.legs.length >= 1) results.push(c);
    }

    results.sort((a, b) => b.rank - a.rank);
    return dedupeBySignature(results).slice(0, o.topN).map(finalize);
  }

  // chainNetRpm = (Σrev - Σcost) / Σmiles; rank = chainNetRpm * strength(finalDest)^alpha.
  // Обязательный HOS-сон (idleMin) НЕ штрафуем — он неизбежен для любого дальнобоя;
  // лишние мили repositioning уже учтены в стоимости (fuel+tolls) и в знаменателе RPM.
  function score(cand, strength, o) {
    const chainNetRpm = cand.totalMiles > 0 ? (cand.totalRev - cand.totalCost) / cand.totalMiles : 0;
    const s = clamp01(strength(cand.node));
    cand.chainNetRpm = chainNetRpm;
    cand.rank = chainNetRpm * Math.pow(Math.max(s, 0.01), o.alpha);
    return cand;
  }

  function finalize(c) {
    return {
      legs: c.legs.map((l) => ({
        board: l.load.board, loadId: l.load.loadId,
        origin: l.load.originMarket, dest: l.load.destMarket,
        equipment: l.load.equipment, rate: l.load.rate,
        loadedMiles: l.load.loadedMiles, deadhead: l.deadhead,
        driveMin: l.driveMin, idleMin: l.idleMin, hosBadge: l.badge,
        net: Math.round(l.net),
      })),
      chainNetRpm: round2(c.chainNetRpm),
      rank: round2(c.rank),
      totalMiles: Math.round(c.totalMiles),
      totalDriveMin: c.legs.reduce((s, l) => s + l.driveMin, 0),
      totalNet: Math.round(c.totalRev - c.totalCost),
      totalIdleMin: c.totalIdleMin,
      finalMarket: c.node,
      hosBadge: c.worstBadge,
    };
  }

  // Грубая оценка горизонта цепочки в днях и дохода в день — для сводки в UI.
  // elapsed = чистое вождение + вынужденный HOS-сон (idle) + погрузка/разгрузка (2ч × плечи).
  // Делим на сутки; пол-дня — минимальная гранулярность. Чистая функция (для теста/UI).
  function horizon(chain) {
    const legs = (chain.legs && chain.legs.length) || 0;
    const elapsedMin = (chain.totalDriveMin || 0) + (chain.totalIdleMin || 0) + legs * LOAD_UNLOAD_MIN;
    const days = Math.max(0.5, Math.round((elapsedMin / (60 * 24)) * 2) / 2);
    const perDay = Math.round((chain.totalNet || 0) / days);
    return { days, perDay };
  }

  // ---- утилиты ----
  const BADGE_RANK = { green: 0, amber: 1, red: 2 };
  function worse(a, b) { return BADGE_RANK[b] > BADGE_RANK[a] ? b : a; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function round2(x) { return Math.round(x * 100) / 100; }
  // Дедуп по ВИДИМОЙ сигнатуре цепочки (путь рынков + округлённый RPM + мили), а не по loadId.
  // На борде один груз часто публикуется несколькими записями с разными loadId (репост брокера,
  // дубль в выдаче DAT) — по loadId они не дубли, но для пользователя это одна и та же строка.
  // Разные ставки по одному lane дают разный RPM → остаются отдельными вариантами.
  function dedupeBySignature(list) {
    const seen = new Set(), out = [];
    for (const c of list) {
      const route = c.legs.map((l) => l.load.originMarket).concat(c.node).join(">");
      const sig = `${route}|${round2(c.chainNetRpm)}|${Math.round(c.totalMiles)}`;
      if (seen.has(sig)) continue;
      seen.add(sig); out.push(c);
    }
    return out;
  }

  return { plan, stepHos, legMinutes, legEconomics, horizon, DEFAULTS, HOS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLPLAN;
if (typeof globalThis !== "undefined") globalThis.LLPLAN = LLPLAN;
