/* LoadLens — content script для DAT One / Truckstop.
   Парсит строки грузов через site-adapter, вешает два бейджа (выгодность + HOS),
   копит крауд-базу на сервере, строит «get out» цепочки в плавающей панели.
   Каркас (MutationObserver + debounce + флаш-буфер) — из PriceLens content.js. */
(() => {
  "use strict";
  const adapter = (typeof LLADAPT !== "undefined") && LLADAPT.adapterFor(location.host);
  if (!adapter) return; // не наш борд

  let panelCollapsed = false;
  let dieselPrice = 3.95;
  let baseCostPerMile = 1.80; // «базовая» (диспетчерская) настройка; не мутируется водителем
  let costPerMile = 1.80;     // текущий (resolveDriverContext → applyDriverContext)
  const _freshHos = (typeof LLHOS !== "undefined") ? LLHOS.fresh() : { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 4200 };
  let baseHos = { ..._freshHos }; // «базовый» HOS (диспетчерские часы из storage/popup)
  let hosState = { ..._freshHos }; // текущий (resolveDriverContext → applyDriverContext)
  let currentMarket = null; // рынок водителя для планировщика (по умолчанию — самый частый origin в выдаче)
  let drivers = [];              // парк диспетчера (LLAPI.getDrivers; пусто, если не залогинен)
  let activeDriver = null;       // выбранный водитель (LLDRV.pickActive)
  let activeEquipment = null;    // фильтр прицепа активного водителя (null = без фильтра)

  let gqlLoads = [];              // грузы из перехваченного ответа DAT FindLoads (inject.js)
  let expandedChainSig = null;   // сигнатура раскрытой цепочки (route path), переживает re-render
  const laneCache = new Map();    // "O>D|E" -> {medianRpm|null}  (из backend)
  const marketCache = new Map();  // market -> strength 0..1
  const repCache = new Map();     // brokerMc -> reputation (crowd)
  const crowdCache = new Map();   // market -> CrowdLoad[] (onward-плечи из бэкенда)
  const laneRequested = new Set();
  const marketRequested = new Set();
  const repRequested = new Set();
  const crowdRequested = new Set();

  // ---------- сбор строк ----------
  // Источник грузов для панели/скоринга/sync: DAT — GraphQL-перехват (gqlLoads), Truckstop — DOM (collect).
  function currentLoads() {
    if (gqlLoads.length) return gqlLoads;
    try { return adapter.collect ? uniqueLoads(adapter.collect()) : []; } catch { return []; }
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
      if (items.length && typeof LLAPI !== "undefined") LLAPI.sendLoads(items).catch(() => {});
    }, 1500);
  }

  // ---------- lane / market статистика (ленивая загрузка + перерисовка) ----------
  function laneKeyOf(l) { return `${l.originMarket}>${l.destMarket}|${l.equipment}`; }
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
  // подтянуть крауд-грузы из рынков назначения — это origin'ы следующих плеч цепочки
  function fetchCrowdLoads(markets) {
    if (typeof LLAPI === "undefined") return;
    markets.slice(0, 25).forEach((m) => {            // bound: не больше 25 запросов
      if (crowdRequested.has(m)) return;
      crowdRequested.add(m);
      LLAPI.getLoadsByOrigin(m).then((rows) => {
        if (rows && rows.length) { crowdCache.set(m, rows); schedule(); }
      }).catch(() => {});
    });
  }
  // пул для планировщика: видимые грузы + крауд onward-плечи (дедуп по loadId)
  function chainPool(visible) {
    const byId = new Map();
    visible.forEach((l) => byId.set(l.loadId, l));
    crowdCache.forEach((rows) => rows.forEach((l) => { if (!byId.has(l.loadId)) byId.set(l.loadId, l); }));
    return [...byId.values()];
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
    const profit = LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian });
    const hos = hosBadge(load);

    // полоса под строкой: full-width, ничего не перекрывает (строка просто чуть выше)
    const host = document.createElement("div");
    host.className = "ll-badge ll-rowstrip ll-" + profit.level;
    // red-flag чип (фрод/double-broker) — первым, как самый важный сигнал
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: repCache.get(String(load.brokerMc)) });
    if (flags.length) {
      const lvl = LLSCORE.redFlagLevel(flags);
      const fc = chip(lvl === "high" ? "🚩 риск" : "🚩 проверь", "ll-flag " + (lvl === "high" ? "ll-red" : "ll-amber"));
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
    const txt = m.best ? `👤 ${m.best.name} (${m.feasibleCount}/${m.total})` : `👤 нет (0/${m.total})`;
    const c = chip(txt, "ll-fleet " + cls);
    c.style.cursor = "pointer";
    c.title = m.matches.map((x) =>
      `${x.feasible ? "✓" : "✕"} ${x.name}: HOS ${x.hosBadge}${x.equipMatch ? "" : " · прицеп≠"} · DH ${x.deadhead}mi` +
      `${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`).join("\n");
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openLoadDetail(load); });
    return c;
  }
  function detailChip(load) {
    const c = chip("ⓘ детали", "ll-detail-chip");
    c.style.cursor = "pointer";
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openLoadDetail(load); });
    return c;
  }
  function brokerText(b) {
    const parts = [];
    if (b.creditScore != null) parts.push(b.creditScore + " CS");
    if (b.daysToPay != null) parts.push(b.daysToPay + " DTP");
    const tag = b.level === "good" ? "🛡 надёжный" : b.level === "ok" ? "брокер ок" : "⚠ риск";
    return tag + (parts.length ? " · " + parts.join(" · ") : "");
  }

  const CROWD_CLS = { good: "ll-good", mixed: "ll-ok", bad: "ll-risk", thin: "ll-thin", none: "ll-thin" };
  function crowdText(rep) {
    if (!rep || !rep.n) return "👥 +отзыв";
    if (rep.level === "bad") {
      const why = rep.doubleBrokered ? `${rep.doubleBrokered}× double-brokered` : `${rep.flaked}× флейк`;
      return `👥 ⚠ ${why} (${rep.n})`;
    }
    if (rep.level === "good") return `👥 ${rep.paid + rep.noIssue}/${rep.n} ок`;
    if (rep.level === "thin") return `👥 ${rep.n} отзыв.`;
    return `👥 смешанно (${rep.n})`;
  }
  function crowdChip(mc) {
    const rep = repCache.get(String(mc));
    const c = chip(crowdText(rep), "ll-broker ll-crowd " + (rep ? CROWD_CLS[rep.level] : "ll-thin"));
    c.style.cursor = "pointer";
    c.title = "Crowdsourced репутация брокера. Нажми, чтобы оставить отзыв.";
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openReportMenu(mc, e.clientX, e.clientY); });
    return c;
  }

  // ---------- меню отзыва о брокере ----------
  const REPORT_OPTS = [
    { o: "paid", t: "✅ Заплатил" },
    { o: "no_issue", t: "👍 Без проблем" },
    { o: "slow", t: "🐢 Платит медленно" },
    { o: "flaked", t: "🚫 Слил/отменил" },
    { o: "double_brokered", t: "⛔ Double-broker" },
  ];
  function openReportMenu(mc, x, y) {
    closeReportMenu();
    const m = document.createElement("div");
    m.id = "ll-report-menu";
    m.style.left = Math.min(x, window.innerWidth - 200) + "px";
    m.style.top = Math.min(y, window.innerHeight - 220) + "px";
    const title = document.createElement("div");
    title.className = "hd"; title.textContent = "Отзыв о брокере " + mc;
    m.appendChild(title);
    REPORT_OPTS.forEach(({ o, t }) => {
      const b = document.createElement("button");
      b.className = "ll-rep-opt"; b.textContent = t;
      b.onclick = async () => {
        m.querySelectorAll("button").forEach((x) => (x.disabled = true));
        title.textContent = "Отправка…";
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

  // ---------- карточка детали груза ----------
  // bookingUrl приходит от брокера — допускаем только http/https (иначе javascript:/data: = XSS).
  function safeHttpUrl(raw) {
    if (!raw) return null;
    try { const u = new URL(String(raw)); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null; }
    catch { return null; }
  }
  function closeLoadDetail() { const d = document.getElementById("ll-detail"); if (d) d.remove(); }
  function drow(label, valueEl) {
    const r = document.createElement("div"); r.className = "drow";
    const k = document.createElement("span"); k.className = "k"; k.textContent = label;
    const v = document.createElement("span"); v.className = "v";
    if (typeof valueEl === "string") v.textContent = valueEl; else if (valueEl) v.appendChild(valueEl);
    r.append(k, v); return r;
  }
  function openLoadDetail(load) {
    closeLoadDetail();
    const laneMedian = laneCache.has(laneKeyOf(load)) ? laneCache.get(laneKeyOf(load)) : null;
    const profit = LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian });
    const hos = hosBadge(load);
    const broker = LLSCORE.brokerBadge(load);
    const rep = repCache.get(String(load.brokerMc));
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: rep });
    const trueRpm = LLSCORE.trueRpm(load.rate, load.loadedMiles, load.deadheadMiles);

    const d = document.createElement("div");
    d.id = "ll-detail";
    const hd = document.createElement("div"); hd.className = "hd";
    const ttl = document.createElement("span");
    ttl.textContent = `${load.originMarket} → ${load.destMarket} · ${load.equipment}`;
    const x = document.createElement("button"); x.textContent = "×"; x.onclick = closeLoadDetail;
    hd.append(ttl, x);
    const bd = document.createElement("div"); bd.className = "bd";

    bd.appendChild(drow("Ставка", load.rate != null
      ? `$${load.rate.toLocaleString("en-US")}${load.rateBasis ? " (" + load.rateBasis + ")" : ""}` : "—"));
    bd.appendChild(drow("RPM", [
      trueRpm != null ? `true $${trueRpm.toFixed(2)}` : null,
      profit.netRpm != null ? `net $${profit.netRpm.toFixed(2)}` : null,
      load.estimatedRatePerMile != null ? `DAT est $${Number(load.estimatedRatePerMile).toFixed(2)}` : null,
      laneMedian != null ? `рынок $${laneMedian.toFixed(2)}` : null,
    ].filter(Boolean).join(" · ") || "—"));
    bd.appendChild(drow("Мили", `${load.loadedMiles ?? "—"} груж · ${load.deadheadMiles ?? 0} DH`));
    if (load.weight) bd.appendChild(drow("Вес", `${load.weight.toLocaleString("en-US")} lbs`));
    if (load.availability) bd.appendChild(drow("Когда", `${load.availability.earliest || "?"} – ${load.availability.latest || "?"}`));

    bd.appendChild(drow("Оценка", `${profitText(profit)} · HOS ${hosIcon(hos)}${flags.length ? " · 🚩 " + (LLSCORE.redFlagLevel(flags) === "high" ? "риск" : "проверь") : ""}`));
    if (flags.length) { const f = document.createElement("div"); f.className = "flags"; f.textContent = flags.map((x) => "• " + x.label).join("\n"); bd.appendChild(f); }

    const brokerLine = [load.brokerName, load.brokerMc ? "MC " + load.brokerMc : null,
      broker.creditScore != null ? broker.creditScore + " CS" : null,
      broker.daysToPay != null ? broker.daysToPay + " DTP" : null,
      rep && rep.n ? "crowd: " + crowdText(rep).replace("👥 ", "") : null].filter(Boolean).join(" · ");
    bd.appendChild(drow("Брокер", brokerLine || "—"));

    if (load.contactPhone) { const a = document.createElement("a"); a.href = "tel:" + load.contactPhone; a.textContent = load.contactPhone; bd.appendChild(drow("Телефон", a)); }
    if (load.contactEmail) { const a = document.createElement("a"); a.href = "mailto:" + load.contactEmail; a.textContent = load.contactEmail; bd.appendChild(drow("Email", a)); }
    if (load.comments) { const c = document.createElement("div"); c.className = "comments"; c.textContent = load.comments; bd.appendChild(drow("Заметки", c)); }

    // «Кому подходит» — разбивка по парку (все водители сразу)
    if (drivers.length && typeof LLFLEET !== "undefined") {
      const m = fleetMatch(load);
      const wrap = document.createElement("div"); wrap.className = "fleet-match";
      const h = document.createElement("div"); h.className = "fleet-h";
      h.textContent = `Кому подходит (${m.feasibleCount}/${m.total})`;
      wrap.appendChild(h);
      m.matches.forEach((x) => {
        const r = document.createElement("div"); r.className = "fleet-row ll-" + (x.feasible ? "ok" : "no");
        r.textContent = `${x.feasible ? "✓" : "✕"} ${x.name} · HOS ${x.hosBadge}` +
          `${x.equipMatch ? "" : " · прицеп≠"} · DH ${x.deadhead}mi` +
          `${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`;
        wrap.appendChild(r);
      });
      bd.appendChild(wrap);
    }

    // действия
    const act = document.createElement("div"); act.className = "actions";
    const bookUrl = safeHttpUrl(load.bookingUrl);   // bookingUrl от брокера — пускаем только http/https
    if (bookUrl) {
      const b = document.createElement("a"); b.href = bookUrl; b.target = "_blank"; b.rel = "noopener noreferrer";
      b.className = "btn primary"; b.textContent = load.bookNow ? "Book Now ↗" : "Открыть ↗";
      act.appendChild(b);
    }
    const copyBtn = document.createElement("button"); copyBtn.className = "btn"; copyBtn.textContent = "Копировать";
    copyBtn.onclick = () => {
      const txt = `${load.originMarket} → ${load.destMarket} ${load.equipment}\n` +
        `Rate: $${load.rate ?? "?"} ${load.rateBasis || ""} | ${load.loadedMiles ?? "?"}mi +${load.deadheadMiles ?? 0}DH\n` +
        `Broker: ${load.brokerName || "?"} MC ${load.brokerMc || "?"} | ${load.creditScore ?? "?"} CS ${load.daysToPay ?? "?"} DTP\n` +
        (load.contactPhone ? `Tel: ${load.contactPhone}\n` : "") + (load.comments ? `Notes: ${load.comments}` : "");
      try { navigator.clipboard.writeText(txt); copyBtn.textContent = "Скопировано ✓"; setTimeout(() => (copyBtn.textContent = "Копировать"), 1200); } catch { /* нет доступа */ }
    };
    act.appendChild(copyBtn);
    if (load.brokerMc) {
      const r = document.createElement("button"); r.className = "btn"; r.textContent = "Отзыв о брокере";
      r.onclick = (e) => openReportMenu(String(load.brokerMc), e.clientX, e.clientY);
      act.appendChild(r);
    }
    bd.appendChild(act);

    d.append(hd, bd);
    document.body.appendChild(d);
  }
  function chip(text, cls) { const s = document.createElement("span"); s.className = "ll-chip " + cls; s.textContent = text; return s; }
  function profitText(p) {
    if (p.level === "unknown") return "— нет ставки";
    const rpm = p.netRpm != null ? "$" + p.netRpm.toFixed(2) + "/mi" : "—";
    const tag = p.level === "green" ? "▲ выгодно" : p.level === "amber" ? "≈ в плюс" : "▼ убыток";
    return `${tag} · ${rpm}`;
  }
  function hosIcon(level) { return level === "green" ? "✓" : level === "amber" ? "!" : "✕"; }
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

  // ---------- панель ----------
  function showFab() {
    let f = document.getElementById("ll-fab");
    if (!f) {
      f = document.createElement("button");
      f.id = "ll-fab"; f.textContent = "🚚 LoadLens";
      document.body.appendChild(f);
      f.onclick = () => { panelCollapsed = false; f.remove(); render(); };
    }
  }
  function buildPanel() {
    let p = document.getElementById("ll-panel");
    if (!p) {
      p = document.createElement("div");
      p.id = "ll-panel";
      p.innerHTML = '<div class="hd"><span class="logo">Load<b>Lens</b></span>' +
        '<button data-act="collapse" title="Свернуть">–</button></div><div class="bd"></div>';
      document.body.appendChild(p);
      p.querySelector('[data-act="collapse"]').onclick = () => { panelCollapsed = true; render(); };
    }
    return p;
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

    clearBadges();
    // построчные бейджи: матчим видимые DOM-строки с грузами (DAT — по resultId, TS — parseRow)
    (adapter.anchor ? adapter.anchor(loads) : []).forEach((p) => badgeRow(p.anchor || p.row, p.load));

    if (panelCollapsed) {
      const p = document.getElementById("ll-panel"); if (p) p.remove();
      showFab();
      return;
    }
    const fab = document.getElementById("ll-fab"); if (fab) fab.remove();

    const pool = chainPool(loads);
    const chains = buildChains(pool, start).filter((c) => c.legs.length >= 1);
    const chainsCtx = chainCtx(loads, pool);
    const deals = loads.map((l) => ({ l, b: LLSCORE.profitBadge(l, { costPerMile, dieselPrice, laneMedian: laneCache.get(laneKeyOf(l)) }) }))
      .filter((d) => d.b.level === "green").slice(0, 5);

    const p = buildPanel();
    const bd = p.querySelector(".bd");
    bd.innerHTML =
      (drivers.length ? `<div class="ll-driver"><span class="k">Водитель</span>` +
        `<select id="ll-driver">` + drivers.map((d) =>
          `<option value="${esc(d.id)}"${activeDriver && d.id === activeDriver.id ? " selected" : ""}>` +
          `${esc(d.name)}${d.currentMarket ? " · " + esc(d.currentMarket) : ""}${d.equipment ? " · " + esc(d.equipment) : ""}</option>`).join("") +
        `</select></div>` : "") +
      row("Грузов в выдаче", String(loads.length)) +
      row("Рынок старта", start ? esc(start) : "—") +
      row("Дизель", "$" + dieselPrice.toFixed(2) + "/гал") +
      `<div class="ll-cfg">Cost/mi: <input id="ll-cpm" type="number" step="0.05" value="${costPerMile}" style="width:60px"> ` +
      `Старт: <input id="ll-start" type="text" value="${start ? esc(start) : ""}" style="width:110px" placeholder="CHICAGO_IL"></div>` +
      (chains.length ? "<h4>Get-out цепочки</h4>" + chains.map((c) => chainCard(c, chainsCtx)).join("") : "<div class='note'>Цепочки появятся, когда видно достаточно грузов из рынка старта.</div>") +
      (deals.length ? "<h4>Выгодные сейчас</h4>" + deals.map((d) =>
        `<div class="deal"><span class="m">${esc(d.l.originMarket)} → ${esc(d.l.destMarket)} ${esc(d.l.equipment)}</span>` +
        `<span class="p">$${d.b.netRpm.toFixed(2)}/mi</span></div>`).join("") : "") +
      '<div class="ll-ft"><button data-act="csv" title="Экспорт видимых грузов в CSV">⬇ CSV</button>' +
      '<span class="pro-tag">Pro</span></div>' +
      '<div class="note">Скоринг учитывает deadhead, топливо и медиану рынка по lane. Ставка с борда — запрос брокера. HOS-бейдж — выполнимость по часам водителя.</div>';

    const drvSel = bd.querySelector("#ll-driver");
    if (drvSel) drvSel.onchange = async () => {
      activeDriver = (typeof LLDRV !== "undefined") ? LLDRV.pickActive(drivers, drvSel.value) : null;
      if (typeof LLDRV !== "undefined") await LLDRV.setActive(drvSel.value);
      render();
    };
    const cpm = bd.querySelector("#ll-cpm");
    if (cpm) cpm.onchange = () => { const v = parseFloat(cpm.value); if (v > 0) { baseCostPerMile = v; render(); } };
    const st = bd.querySelector("#ll-start");
    if (st) st.onchange = () => { currentMarket = st.value.trim().toUpperCase() || null; render(); };
    const csvBtn = bd.querySelector('[data-act="csv"]');
    if (csvBtn) csvBtn.onclick = () => exportCsv(loads);
    bd.querySelectorAll(".chain-hd").forEach((hd) => {
      hd.addEventListener("click", () => {
        const sig = hd.getAttribute("data-sig");
        expandedChainSig = (expandedChainSig === sig) ? null : sig;
        render();
      });
    });
    bd.querySelectorAll(".leg.leg-live").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const rid = el.getAttribute("data-result");
        if (rid != null && adapter && typeof adapter.scrollToRow === "function") adapter.scrollToRow(rid);
      });
    });
  }

  // Pro-экспорт CSV видимых грузов (гейт через LLAPI.getMe().plan, как в PriceLens).
  async function exportCsv(loads) {
    const me = typeof LLAPI !== "undefined" ? await LLAPI.getMe() : null;
    if (!me || me.plan !== "pro") {
      alert("Экспорт CSV доступен в Pro. Войдите в аккаунт в попапе LoadLens (иконка расширения).");
      return;
    }
    if (!loads.length) { alert("Нет грузов для экспорта."); return; }
    const csv = LLCSV.buildLoadsCsv(loads);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `loadlens_${adapter.board}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // сигнатура цепочки = путь рынков (стабильна между рендерами)
  function chainSig(c) { return c.legs.map((l) => l.origin).concat(c.finalMarket).join(">") + "|" + c.chainNetRpm + "|" + c.totalMiles; }

  // контекст рендера: индекс пула по loadId + множество «живых» loadId (видимых в выдаче)
  function chainCtx(visible, pool) {
    const poolById = new Map(pool.map((l) => [l.loadId, l]));
    const liveIds = new Set(visible.map((l) => l.loadId));
    return { poolById, liveIds };
  }

  const HOS_ICON = { green: "✓", amber: "!", red: "✕" };

  // свёрнутая/раскрытая карточка цепочки
  function chainCard(c, ctx) {
    const sig = chainSig(c);
    const open = sig === expandedChainSig;
    const path = c.legs.map((l) => l.origin).concat(c.finalMarket).join(" → ");
    const h = LLPLAN.horizon(c);
    const caret = open ? "▾" : "▸";
    const meta = `$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ~${h.days}д · $${h.perDay}/д · HOS ${HOS_ICON[c.hosBadge] || "?"}`;
    let html = `<div class="chain ll-${c.hosBadge}${open ? " open" : ""}">` +
      `<div class="chain-hd" data-sig="${esc(sig)}">` +
      `<div class="route">${esc(path)} <span class="caret">${caret}</span></div>` +
      `<div class="meta">${esc(meta)}</div></div>`;
    if (open) html += `<div class="chain-legs">` + c.legs.map((l, i) => legRow(l, i, c, ctx)).join("") + `</div>`;
    return html + `</div>`;
  }

  // одно плечо: live (из выдачи) или forecast (крауд)
  function legRow(leg, i, c, ctx) {
    const full = ctx.poolById.get(leg.loadId) || {};
    const isLive = ctx.liveIds.has(leg.loadId);
    const rpm = (leg.loadedMiles + leg.deadhead) > 0 ? leg.rate / (leg.loadedMiles + leg.deadhead) : 0;
    const route = `${esc(leg.origin)} → ${esc(leg.dest)}`;
    if (isLive) {
      const idx = `плечо ${i + 1} · ${esc(leg.equipment || "")}`;
      const rid = full.resultId != null ? ` data-result="${esc(String(full.resultId))}"` : "";
      const eco = `$${money(leg.rate)} · ${leg.loadedMiles}mi${leg.deadhead ? " +" + leg.deadhead + "dh" : ""} · $${rpm.toFixed(2)}/mi · HOS ${HOS_ICON[leg.hosBadge] || "?"}`;
      return `<div class="leg leg-live"${rid}>` +
        `<div class="leg-top"><span class="leg-tag live">● СЕЙЧАС В ВЫДАЧЕ ↗</span><span class="leg-idx">${idx}</span></div>` +
        `<div class="leg-route">${route}</div>` +
        `<div class="leg-eco">${esc(eco)}</div>` +
        `<div class="leg-chips">${liveChips(full)}</div></div>`;
    }
    // forecast (крауд) плечо. laneKeyOf ждёт originMarket/destMarket — у leg поля origin/dest, маппим.
    const laneKey = laneKeyOf({ originMarket: leg.origin, destMarket: leg.dest, equipment: leg.equipment });
    const median = laneCache.has(laneKey) ? laneCache.get(laneKey) : null;
    const rpmTxt = median != null ? `$${median.toFixed(2)}/mi медиана lane` : `$${rpm.toFixed(2)}/mi`;
    const fresh = freshnessText(full.lastSeen);
    const density = (crowdCache.get(leg.origin) || []).length;
    const densTxt = density ? ` · ~${density} груз. из рынка` : "";
    const isLast = i === c.legs.length - 1;
    const strengthTxt = isLast ? ` · финиш ${strengthBar(strengthOf(leg.dest))}` : "";
    return `<div class="leg leg-fc">` +
      `<div class="leg-top"><span class="leg-tag fc">◔ ПРОГНОЗ ПО РЫНКУ</span><span class="leg-idx">${esc(fresh)}</span></div>` +
      `<div class="leg-route">${route}</div>` +
      `<div class="leg-eco">${esc(rpmTxt)}${esc(densTxt)}${esc(strengthTxt)} · HOS ${HOS_ICON[leg.hosBadge] || "?"}</div></div>`;
  }

  // чипы живого плеча из распарсенного Load
  function liveChips(load) {
    const out = [];
    // репутация брокера: crowd (если есть отзывы) иначе CS-бейдж
    const rep = load.brokerMc ? repCache.get(String(load.brokerMc)) : null;
    if (rep && rep.n) {
      const repCls = { good: "good", bad: "risk", mixed: "ok" }[rep.level] || "";
      out.push(`<span class="lchip ${repCls}">${esc((load.brokerName ? load.brokerName + " · " : "") + crowdShort(rep))}</span>`);
    } else if (typeof LLSCORE !== "undefined") {
      const b = LLSCORE.brokerBadge(load);
      if (b.level !== "unknown") {
        const cls = b.level === "good" ? "good" : b.level === "ok" ? "ok" : "risk";
        const tag = b.level === "good" ? "🛡 надёжный" : b.level === "ok" ? "ок" : "⚠ риск";
        out.push(`<span class="lchip ${cls}">${esc((load.brokerName ? load.brokerName + " · " : "") + tag + (b.creditScore != null ? " " + b.creditScore + "CS" : ""))}</span>`);
      }
    }
    const pick = fmtPickup(load.availability);
    if (pick) out.push(`<span class="lchip">pickup ${esc(pick)}</span>`);
    if (load.weight || load.lengthFt) {
      const wl = [load.weight ? Math.round(load.weight / 1000) + "klb" : null, load.lengthFt ? load.lengthFt + "ft" : null].filter(Boolean).join(" · ");
      out.push(`<span class="lchip">${esc(wl)}</span>`);
    }
    if (load.isNegotiable) out.push(`<span class="lchip">торг</span>`);
    if (load.isFactorable) out.push(`<span class="lchip">факторинг</span>`);
    if (load.bookNow) out.push(`<span class="lchip book">Book Now</span>`);
    return out.join("");
  }

  // короткий crowd-вердикт для чипа плеча
  function crowdShort(rep) {
    if (rep.level === "good") return "🛡 ок";
    if (rep.level === "bad") return "⚠ риск";
    if (rep.level === "thin") return rep.n + " отзыв.";
    return "смешанно";
  }

  function fmtPickup(av) {
    if (!av || !av.earliest) return null;
    const d = new Date(av.earliest);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "сегодня";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  function freshnessText(lastSeen) {
    if (!lastSeen) return "прогноз";
    const d = new Date(lastSeen);
    if (isNaN(d.getTime())) return "прогноз";
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "видели сегодня";
    if (days === 1) return "видели вчера";
    return `видели ${days} дн назад`;
  }

  function strengthBar(s) {
    const n = Math.max(0, Math.min(5, Math.round((s || 0) * 5)));
    return "▰".repeat(n) + "▱".repeat(5 - n);
  }

  const money = (n) => Math.round(n || 0).toLocaleString("en-US");

  function uniqueMarkets(loads) {
    const s = new Set();
    loads.forEach((l) => { s.add(l.originMarket); s.add(l.destMarket); });
    return [...s];
  }
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
        schedule();
      });
    } catch { /* нет API */ }

    // приём перехваченных ответов DAT FindLoads из MAIN-world inject.js
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== "loadlens" || d.type !== "dat-findloads") return;
      if (typeof DAT_GQL !== "undefined") {
        const parsed = DAT_GQL.parseFindLoads(d.payload);
        if (parsed.length) { gqlLoads = parsed; schedule(); }
      }
    });

    render();
    const obs = new MutationObserver(() => schedule());
    obs.observe(document.body, { childList: true, subtree: true });
    let lastPath = location.pathname + location.search;
    setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== lastPath) { lastPath = cur; schedule(); }
    }, 600);
  }
  boot();
})();
