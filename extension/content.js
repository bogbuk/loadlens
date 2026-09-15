/* LoadLens — content script для DAT One / Truckstop.
   Парсит строки грузов через site-adapter, вешает два бейджа (выгодность + HOS),
   копит крауд-базу на сервере, строит «get out» цепочки в плавающей панели.
   Каркас (MutationObserver + debounce + флаш-буфер) — из PriceLens content.js. */
(() => {
  "use strict";
  const adapter = (typeof LLADAPT !== "undefined") && LLADAPT.adapterFor(location.host);
  if (!adapter) return; // не наш борд

  // debug-логи под флагом: localStorage.LL_DEBUG = "1" (парн. с inject.js; читаем каждый раз)
  const llDebug = () => { try { return localStorage.getItem("LL_DEBUG") != null; } catch (_) { return false; } };
  const log = (...a) => { if (llDebug()) { try { console.log("[LoadLens/content]", ...a); } catch (_) {} } };

  let panelCollapsed = false;
  let hintsOff = false; // per-tab: скрыть наши подсказки (бейджи + панель) на этой вкладке
  let hidePanel = false;  // глобальная настройка попапа (ll_hide_panel): скрыть панель на странице
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
  let autoRefresh = { on: false, intervalMs: 60000, scroll: true, maxSteps: 40 }; // base; jitter=intervalMs → [base,2·base)
  let sortPref = null;           // {field, dir:'asc'|'desc'} — удерживаемая сортировка DAT
  let pendingSortReapply = false;// true сразу после нашего clickRefresh → переприменить сорт по новой выдаче
  let cloudCfg = null;           // cloud mode (LLCLOUD.config) — авто-пилот всегда ВКЛ, heartbeat на бэкенд
  let sseAlerts = false;         // ll_sse_alerts: слушать нативный SSE-поток live-матчей DAT (inject → dat-match-event)
  let liveTs = 0;                // ts последнего SSE-события (индикатор «live» в шапке панели)
  const LIVE_FRESH_MS = 90000;   // «live» горит, если событие было не позже этого окна
  const HEARTBEAT_TICK_MS = 60000; // проверка «пора ли heartbeat» (сам период — LLCLOUD.HEARTBEAT_MS)
  let expandedChainSig = null;   // сигнатура раскрытой цепочки (route path), переживает re-render
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
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openLoadDetail(load); });
    return c;
  }
  function detailChip(load) {
    const c = chip("ⓘ details", "ll-detail-chip");
    c.style.cursor = "pointer";
    c.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); openLoadDetail(load); });
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
  function crowdText(rep) {
    if (!rep || !rep.n) return "👥 +review";
    if (rep.level === "bad") {
      const why = rep.doubleBrokered ? `${rep.doubleBrokered}× double-brokered` : `${rep.flaked}× flaked`;
      return `👥 ⚠ ${why} (${rep.n})`;
    }
    if (rep.level === "good") return `👥 ${rep.paid + rep.noIssue}/${rep.n} ok`;
    if (rep.level === "thin") return `👥 ${rep.n} ${rep.n === 1 ? "review" : "reviews"}`;
    return `👥 mixed (${rep.n})`;
  }
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
    const profit = LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian, targetRpm: targetFor(load) });
    const hos = hosBadge(load);
    const broker = LLSCORE.brokerBadge(load);
    const rep = repCache.get(String(load.brokerMc));
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: rep });
    const trueRpm = LLSCORE.trueRpm(load.rate, load.loadedMiles, load.deadheadMiles);
    // контр-оффер: сколько просить (постированная ставка — стартовая позиция брокера)
    const offer = LLSCORE.counterOffer(load, { laneMedian, costPerMile });

    const d = document.createElement("div");
    d.id = "ll-detail";
    const hd = document.createElement("div"); hd.className = "hd";
    const ttl = document.createElement("span");
    ttl.textContent = `${load.originMarket} → ${load.destMarket} · ${load.equipment}`;
    const x = document.createElement("button"); x.textContent = "×"; x.onclick = closeLoadDetail;
    hd.append(ttl, x);
    const bd = document.createElement("div"); bd.className = "bd";

    bd.appendChild(drow("Rate", load.rate != null
      ? `$${load.rate.toLocaleString("en-US")}${load.rateBasis ? " (" + load.rateBasis + ")" : ""}` : "—"));
    bd.appendChild(drow("RPM", [
      trueRpm != null ? `true $${trueRpm.toFixed(2)}` : null,
      profit.netRpm != null ? `net $${profit.netRpm.toFixed(2)}` : null,
      load.estimatedRatePerMile != null ? `DAT est $${Number(load.estimatedRatePerMile).toFixed(2)}` : null,
      laneMedian != null ? `market $${laneMedian.toFixed(2)}` : null,
    ].filter(Boolean).join(" · ") || "—"));
    bd.appendChild(drow("Miles", `${load.loadedMiles ?? "—"} loaded · ${load.deadheadMiles ?? 0} DH`));
    if (load.weight) bd.appendChild(drow("Weight", `${load.weight.toLocaleString("en-US")} lbs`));
    if (load.availability) bd.appendChild(drow("Available", `${load.availability.earliest || "?"} – ${load.availability.latest || "?"}`));

    bd.appendChild(drow("Score", `${profitText(profit)} · HOS ${hosIcon(hos)}${flags.length ? " · 🚩 " + (LLSCORE.redFlagLevel(flags) === "high" ? "risk" : "verify") : ""}`));
    if (offer.ask != null) bd.appendChild(drow("Ask", offer.script));
    if (flags.length) { const f = document.createElement("div"); f.className = "flags"; f.textContent = flags.map((x) => "• " + x.label).join("\n"); bd.appendChild(f); }

    const brokerLine = [load.brokerName, load.brokerMc ? "MC " + load.brokerMc : null,
      broker.creditScore != null ? broker.creditScore + " CS" : null,
      broker.daysToPay != null ? broker.daysToPay + " DTP" : null,
      rep && rep.n ? "crowd: " + crowdText(rep).replace("👥 ", "") : null].filter(Boolean).join(" · ");
    bd.appendChild(drow("Broker", brokerLine || "—"));

    if (load.contactPhone) { const a = document.createElement("a"); a.href = "tel:" + load.contactPhone; a.textContent = load.contactPhone; bd.appendChild(drow("Phone", a)); }
    if (load.contactEmail) { const a = document.createElement("a"); a.href = "mailto:" + load.contactEmail; a.textContent = load.contactEmail; bd.appendChild(drow("Email", a)); }
    if (load.comments) { const c = document.createElement("div"); c.className = "comments"; c.textContent = load.comments; bd.appendChild(drow("Notes", c)); }

    // «Кому подходит» — разбивка по парку (все водители сразу)
    if (drivers.length && typeof LLFLEET !== "undefined") {
      const m = fleetMatch(load);
      const wrap = document.createElement("div"); wrap.className = "fleet-match";
      const h = document.createElement("div"); h.className = "fleet-h";
      h.textContent = `Fits drivers (${m.feasibleCount}/${m.total})`;
      wrap.appendChild(h);
      m.matches.forEach((x) => {
        const r = document.createElement("div"); r.className = "fleet-row ll-" + (x.feasible ? "ok" : "no");
        r.textContent = `${x.feasible ? "✓" : "✕"} ${x.name} · HOS ${x.hosBadge}` +
          `${x.equipMatch ? "" : " · equipment mismatch"} · DH ${x.deadhead}mi` +
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
      b.className = "btn primary"; b.textContent = load.bookNow ? "Book Now ↗" : "Open ↗";
      act.appendChild(b);
    }
    // Контакт брокера: письмо с готовым контр-оффером (prefill, Send жмёт пользователь).
    // Ведущая кнопка выбирается по preferredContactMethod — брокер сам указал канал.
    const phonePreferred = String(load.preferredContactMethod || "").indexOf("PHONE") >= 0;
    const hasMail = typeof LLMAIL !== "undefined";
    const mailBody = hasMail ? LLMAIL.fillTemplate(mailTemplate, load, activeDriver, { counterOffer: offer.script }) : "";
    const mailSubject = hasMail ? LLMAIL.subjectFor(load) : "";

    if (load.contactEmail && hasMail) {
      const m = document.createElement("button");
      m.className = "btn" + (phonePreferred ? "" : " primary");
      m.textContent = "✉️ Email broker";
      m.onclick = () => window.open(LLMAIL.gmailComposeUrl(load.contactEmail, mailSubject, mailBody), "_blank", "noopener");
      act.appendChild(m);
    }
    if (load.contactPhone) {
      const c = document.createElement("a");
      c.className = "btn" + (phonePreferred || !load.contactEmail ? " primary" : "");
      c.href = "tel:" + load.contactPhone; c.textContent = "📞 Call";
      act.appendChild(c);
    }
    if (load.contactEmail && hasMail) {
      const ce = document.createElement("button"); ce.className = "btn"; ce.textContent = "📋 Copy email";
      ce.onclick = () => {
        try {
          navigator.clipboard.writeText(mailSubject + "\n\n" + mailBody);
          ce.textContent = "Copied ✓"; setTimeout(() => (ce.textContent = "📋 Copy email"), 1200);
        } catch { /* нет доступа */ }
      };
      act.appendChild(ce);
    }

    const copyBtn = document.createElement("button"); copyBtn.className = "btn"; copyBtn.textContent = "Copy";
    copyBtn.onclick = () => {
      const txt = `${load.originMarket} → ${load.destMarket} ${load.equipment}\n` +
        `Rate: $${load.rate ?? "?"} ${load.rateBasis || ""} | ${load.loadedMiles ?? "?"}mi +${load.deadheadMiles ?? 0}DH\n` +
        (trueRpm != null ? `RPM: true $${trueRpm.toFixed(2)}${laneMedian != null ? ` | market $${laneMedian.toFixed(2)}` : ""}\n` : "") +
        (offer.script ? `Ask: ${offer.script}\n` : "") +
        `Broker: ${load.brokerName || "?"} MC ${load.brokerMc || "?"} | ${load.creditScore ?? "?"} CS ${load.daysToPay ?? "?"} DTP\n` +
        (load.contactPhone ? `Tel: ${load.contactPhone}\n` : "") + (load.comments ? `Notes: ${load.comments}` : "");
      try { navigator.clipboard.writeText(txt); copyBtn.textContent = "Copied ✓"; setTimeout(() => (copyBtn.textContent = "Copy"), 1200); } catch { /* нет доступа */ }
    };
    act.appendChild(copyBtn);
    if (load.brokerMc) {
      const r = document.createElement("button"); r.className = "btn"; r.textContent = "Broker review";
      r.onclick = (e) => openReportMenu(String(load.brokerMc), e.clientX, e.clientY);
      act.appendChild(r);
    }
    bd.appendChild(act);

    d.append(hd, bd);
    document.body.appendChild(d);
  }
  function chip(text, cls) { const s = document.createElement("span"); s.className = "ll-chip " + cls; s.textContent = text; return s; }
  function profitText(p) {
    if (p.level === "unknown") return "— no rate";
    const rpm = p.netRpm != null ? "$" + p.netRpm.toFixed(2) + "/mi" : "—";
    const tag = p.level === "green" ? "▲ profitable" : p.level === "amber" ? "≈ marginal" : "▼ loss";
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

  // ---------- панель ----------
  function showFab() {
    let f = document.getElementById("ll-fab");
    if (!f) {
      f = document.createElement("button");
      f.id = "ll-fab"; f.textContent = "🚚 LoadLens";
      document.body.appendChild(f);
      f.onclick = () => {
        panelCollapsed = false;
        hintsOff = false;
        if (typeof LLTAB !== "undefined") LLTAB.setHintsOff(sessionStorage, false);
        f.remove();
        render();
      };
    }
  }
  function buildPanel() {
    let p = document.getElementById("ll-panel");
    if (!p) {
      p = document.createElement("div");
      p.id = "ll-panel";
      p.innerHTML = '<div class="hd"><span class="logo">Load<b>Lens</b></span>' +
        '<span class="hd-actions">' +
        '<button data-act="hints" title="Hide LoadLens hints on this tab">🙈</button>' +
        '<button data-act="collapse" title="Collapse">–</button></span></div><div class="bd"></div>';
      document.body.appendChild(p);
      p.querySelector('[data-act="collapse"]').onclick = () => { panelCollapsed = true; render(); };
      p.querySelector('[data-act="hints"]').onclick = () => {
        hintsOff = true;
        if (typeof LLTAB !== "undefined") LLTAB.setHintsOff(sessionStorage, true);
        render();
      };
    }
    return p;
  }

  // Бейдж выгодности с текущими настройками (cost/mile, дизель, медиана lane, целевой $/mi по бакету).
  function badgeFor(l) {
    return LLSCORE.profitBadge(l, { costPerMile, dieselPrice, laneMedian: laneCache.get(laneKeyOf(l)), targetRpm: targetFor(l) });
  }

  // Отбор грузов для Telegram-алертов. Есть включённые правила (ll_alert_rules) → LLRULES.select (OR между
  // правилами, AND внутри); нет → прежнее поведение: green + passEquip (те же грузы, что «Выгодные сейчас»).
  // Используется и в render (вся выдача), и для одиночных live-событий SSE (dat-match-event).
  function selectAlertHits(loads) {
    const activeRules = (typeof LLRULES !== "undefined") ? LLRULES.active(alertRules) : [];
    if (activeRules.length) return LLRULES.select(activeRules, loads, { equipFilter, badgeFor });
    return loads.filter(passEquip).filter((l) => badgeFor(l).level === "green").map((load) => ({ load, rule: null }));
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
    // и как фолбэк для Telegram-алертов). Считаем до early-return, чтобы работало и со свёрнутой панелью.
    const greens = loads.filter(passEquip)
      .map((l) => ({ l, b: badgeFor(l) }))
      .filter((d) => d.b.level === "green");
    // Telegram-алерты: отбор в selectAlertHits (правила или green+equip). Гейт/дедуп/cap внутри LLALERT и на сервере.
    if (typeof LLALERT !== "undefined") LLALERT.push(selectAlertHits(loads)).catch(() => {});

    clearBadges();
    const vis = { hintsOff, hideBadges, hidePanel, panelCollapsed };
    // построчные бейджи: матчим видимые DOM-строки с грузами (DAT — по resultId, TS — parseRow).
    if (LLVIS.badgesVisible(vis)) {
      (adapter.anchor ? adapter.anchor(loads) : []).forEach((p) => badgeRow(p.anchor || p.row, p.load));
    }

    if (!LLVIS.panelVisible(vis)) {
      const p = document.getElementById("ll-panel"); if (p) p.remove();
      if (LLVIS.fabVisible(vis)) showFab();
      else { const fab = document.getElementById("ll-fab"); if (fab) fab.remove(); }
      return;
    }
    const fab = document.getElementById("ll-fab"); if (fab) fab.remove();

    const pool = chainPool(loads);
    const chains = buildChains(pool, start).filter((c) => c.legs.length >= 1);
    const chainsCtx = chainCtx(loads, pool);
    const deals = greens.slice(0, 5);

    const p = buildPanel();
    const bd = p.querySelector(".bd");
    bd.innerHTML =
      (drivers.length ? `<div class="ll-driver"><span class="k">Driver</span>` +
        `<select id="ll-driver">` + drivers.map((d) =>
          `<option value="${esc(d.id)}"${activeDriver && d.id === activeDriver.id ? " selected" : ""}>` +
          `${esc(d.name)}${d.currentMarket ? " · " + esc(d.currentMarket) : ""}${d.equipment ? " · " + esc(d.equipment) : ""}</option>`).join("") +
        `</select></div>` : "") +
      row("Loads in results", String(loads.length)) +
      (equipFilter ? row("Equipment filter", esc(equipFilter.join(", "))) : "") +
      row("Start market", start ? esc(start) : "—") +
      row("Diesel", "$" + dieselPrice.toFixed(2) + "/gal") +
      `<div class="ll-cfg">Cost/mi: <input id="ll-cpm" type="number" step="0.05" value="${costPerMile}" style="width:60px"> ` +
      `Start: <input id="ll-start" type="text" value="${start ? esc(start) : ""}" style="width:110px" placeholder="CHICAGO_IL"></div>` +
      `<div class="ll-cfg" title="Auto-pilot: the background tab clicks DAT's Search itself and holds the sort order. This checkbox overrides the global switch (extension popup) for this tab only">` +
        `<label${cloudCfg ? ' title="Cloud mode: auto-pilot is always on in the cloud browser"' : ""}><input type="checkbox" id="ll-ar"${autoRefresh.on ? " checked" : ""}${cloudCfg ? " disabled" : ""}> Auto-refresh${cloudCfg ? " (Cloud)" : ""}</label> ` +
        (sseAlerts && Date.now() - liveTs < LIVE_FRESH_MS ? `<span class="ll-live" title="Listening to DAT's live match stream for this search — new loads arrive without a refresh">● live</span> ` : "") +
        `Sort: <select id="ll-sort-f"><option value="">—</option>` +
        SORT_FIELDS.map((s) => `<option value="${s.field}"${sortPref && sortPref.field === s.field ? " selected" : ""}>${esc(s.label)}</option>`).join("") +
        `</select> <button id="ll-sort-dir" title="Sort direction">${sortPref && sortPref.dir === "asc" ? "▲ Low" : "▼ High"}</button></div>` +
      (chains.length ? "<h4>Get-out chains</h4>" + chains.map((c) => chainCard(c, chainsCtx)).join("") : "<div class='note'>Chains appear once enough loads from the start market are visible.</div>") +
      (deals.length ? "<h4>Hot loads</h4>" + deals.map((d) =>
        `<div class="deal"><span class="m">${esc(d.l.originMarket)} → ${esc(d.l.destMarket)} ${esc(d.l.equipment)}</span>` +
        `<span class="p">$${d.b.netRpm.toFixed(2)}/mi</span></div>`).join("") : "") +
      '<div class="ll-ft"><button data-act="csv" title="Export visible loads to CSV">⬇ CSV</button>' +
      '<span class="pro-tag">Pro</span></div>' +
      '<div class="note">Scoring accounts for deadhead, fuel and the lane market median. The board rate is the broker\'s asking price. The HOS badge shows whether the driver can legally run it.</div>';

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
    const ar = bd.querySelector("#ll-ar");
    if (ar) ar.onchange = () => {
      if (cloudCfg) { ar.checked = true; return; }
      autoRefresh.on = ar.checked;
      if (typeof LLTAB !== "undefined") LLTAB.setAutorefresh(sessionStorage, ar.checked);
      scheduleAuto();
      if (ar.checked && autoRefresh.scroll) scrollToLoadAll(); // доскроллить уже открытую выдачу сразу
    };
    const sf = bd.querySelector("#ll-sort-f");
    if (sf) sf.onchange = () => persistSort({ field: sf.value || null });
    const sd = bd.querySelector("#ll-sort-dir");
    if (sd) sd.onclick = () => persistSort({ dir: (sortPref && sortPref.dir === "asc") ? "desc" : "asc" });
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
        const ok = rid != null && adapter && typeof adapter.scrollToRow === "function" && adapter.scrollToRow(rid);
        // строки нет в DOM (груз из similarResults / прокручен за пределы) — подсказываем, а не молчим
        if (!ok) {
          const tag = el.querySelector(".leg-tag");
          if (tag) {
            const prev = tag.textContent;
            tag.textContent = "load not in visible results";
            setTimeout(() => { tag.textContent = prev; }, 1800);
          }
        }
      });
    });
  }

  // Pro-экспорт CSV видимых грузов (гейт через LLAPI.getMe().plan, как в PriceLens).
  async function exportCsv(loads) {
    const me = typeof LLAPI !== "undefined" ? await LLAPI.getMe() : null;
    if (!me || me.plan !== "pro") {
      alert("CSV export is a Pro feature. Sign in from the LoadLens popup (the extension icon).");
      return;
    }
    if (!loads.length) { alert("No loads to export."); return; }
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
    const meta = `$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ~${h.days}d · $${h.perDay}/day · HOS ${HOS_ICON[c.hosBadge] || "?"}`;
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
      const idx = `leg ${i + 1} · ${esc(leg.equipment || "")}`;
      const rid = full.resultId != null ? ` data-result="${esc(String(full.resultId))}"` : "";
      const eco = `$${money(leg.rate)} · ${leg.loadedMiles}mi${leg.deadhead ? " +" + leg.deadhead + "dh" : ""} · $${rpm.toFixed(2)}/mi · HOS ${HOS_ICON[leg.hosBadge] || "?"}`;
      return `<div class="leg leg-live"${rid}>` +
        `<div class="leg-top"><span class="leg-tag live">● LIVE IN RESULTS ↗</span><span class="leg-idx">${idx}</span></div>` +
        `<div class="leg-route">${route}${neighborTag(full)}</div>` +
        `<div class="leg-eco">${esc(eco)}</div>` +
        `<div class="leg-chips">${liveChips(full)}</div></div>`;
    }
    // forecast (крауд) плечо. laneKeyOf ждёт originMarket/destMarket — у leg поля origin/dest, маппим.
    const laneKey = laneKeyOf({ originMarket: leg.origin, destMarket: leg.dest, equipment: leg.equipment });
    const median = laneCache.has(laneKey) ? laneCache.get(laneKey) : null;
    const rpmTxt = median != null ? `$${median.toFixed(2)}/mi lane median` : `$${rpm.toFixed(2)}/mi`;
    // серверная свежесть, если груз аннотирован /loads/near; иначе fallback на относительное время
    let fresh;
    if (full.liveness != null) {
      const ll = livenessLabel(full.liveness);
      fresh = `${ll.dot} ${ll.word} · ${freshnessText(full.lastSeen)}`;
    } else {
      fresh = freshnessText(full.lastSeen);
    }
    const density = (crowdCache.get(leg.origin) || []).length;
    const densTxt = density ? ` · ~${density} loads from market` : "";
    const isLast = i === c.legs.length - 1;
    const strengthTxt = isLast ? ` · dest. market ${strengthBar(strengthOf(leg.dest))}` : "";
    return `<div class="leg leg-fc">` +
      `<div class="leg-top"><span class="leg-tag fc">◔ MARKET FORECAST</span><span class="leg-idx">${esc(fresh)}</span></div>` +
      `<div class="leg-route">${route}${neighborTag(full)}</div>` +
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
        const tag = b.level === "good" ? "🛡 trusted" : b.level === "ok" ? "ok" : "⚠ risk";
        out.push(`<span class="lchip ${cls}">${esc((load.brokerName ? load.brokerName + " · " : "") + tag + (b.creditScore != null ? " " + b.creditScore + "CS" : ""))}</span>`);
      }
    }
    const pick = fmtPickup(load.availability);
    if (pick) out.push(`<span class="lchip">pickup ${esc(pick)}</span>`);
    if (load.weight || load.lengthFt) {
      const wl = [load.weight ? Math.round(load.weight / 1000) + "klb" : null, load.lengthFt ? load.lengthFt + "ft" : null].filter(Boolean).join(" · ");
      out.push(`<span class="lchip">${esc(wl)}</span>`);
    }
    if (load.isNegotiable) out.push(`<span class="lchip">negotiable</span>`);
    if (load.isFactorable) out.push(`<span class="lchip">factoring</span>`);
    if (load.bookNow) out.push(`<span class="lchip book">Book Now</span>`);
    return out.join("");
  }

  // короткий crowd-вердикт для чипа плеча
  function crowdShort(rep) {
    if (rep.level === "good") return "🛡 trusted";
    if (rep.level === "bad") return "⚠ risk";
    if (rep.level === "thin") return rep.n + (rep.n === 1 ? " review" : " reviews");
    return "mixed";
  }

  function fmtPickup(av) {
    if (!av || !av.earliest) return null;
    const d = new Date(av.earliest);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "today";
    return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  }

  function freshnessText(lastSeen) {
    if (!lastSeen) return "forecast";
    const d = new Date(lastSeen);
    if (isNaN(d.getTime())) return "forecast";
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "seen today";
    if (days === 1) return "seen yesterday";
    return `seen ${days}d ago`;
  }

  // Серверная свежесть (0..1) → цветная точка + слово. Бакеты как в спеке.
  function livenessLabel(liveness) {
    if (liveness > 0.66) return { dot: "🟢", word: "fresh" };
    if (liveness >= 0.33) return { dot: "🟡", word: "cooling" };
    return { dot: "🔴", word: "may be gone" };
  }

  // Плечо взято из соседнего рынка (радиус) — тег с крюком. Пусто при точном рынке (0/нет поля).
  function neighborTag(full) {
    const dh = full && full.originDeadheadMi;
    return dh > 0 ? `<span class="leg-nb">↪ +${Math.round(dh)}mi nearby</span>` : "";
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
  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  function scheduleAuto() {
    clearAuto();
    if (/^login\./i.test(location.hostname)) return; // страница логина: reload убил бы форму входа
    if (!autoRefresh.on) return;
    const base = Math.max(60000, autoRefresh.intervalMs || 60000); // не чаще 60с (ToS: имитация человека)
    const delay = nextDelay(base, base);                            // [base, 2·base) → дефолт 60–120с
    autoTimer = setTimeout(() => {
      let clicked = false;
      try { clicked = !!(adapter.clickRefresh && adapter.clickRefresh()); }
      catch (e) { log("auto-refresh error", e); }
      if (clicked) {
        // DAT включила SEARCH (критерии менялись) → клик перезапускает поиск без перезагрузки
        pendingSortReapply = true; log("auto-refresh: clicked Search");
        scheduleAuto();
      } else {
        // SEARCH задизейблена/не найдена (тот же поиск нечего повторять) → перезагружаем страницу.
        // Маркер в sessionStorage: после reload переприменим удерживаемую сортировку к новой выдаче.
        log("auto-refresh: Search disabled → page reload");
        try { sessionStorage.setItem("ll_autopilot_reload", "1"); } catch (_) {}
        try { location.reload(); } catch (_) { scheduleAuto(); } // boot после reload сам перезапустит таймер
      }
    }, delay);
  }
  // ---- авто-скролл: доскроллить выдачу до конца, чтобы DAT lazy-load'нул все страницы ----
  // Данные копятся событийно (inject → message → LLACC.accumulate); скролл лишь провоцирует fetchMore
  // приложения DAT. Стоп: нет роста K=2 шага подряд или достигнут maxSteps. Гард scrolling — без гонок.
  const SCROLL_STEP_BASE = 700, SCROLL_STEP_JITTER = 500, SCROLL_DRY = 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function scrollToLoadAll() {
    if (scrolling || !autoRefresh.on || !autoRefresh.scroll) return;
    const container = adapter && adapter.findScrollContainer && adapter.findScrollContainer();
    if (!container) { log("auto-scroll: container not found"); return; }
    scrolling = true;
    const startTop = container.scrollTop || 0; // куда вернуть пользователя после доскролла
    try {
      let dry = 0, prevSize = accState.byId.size, prevH = 0;
      const maxSteps = autoRefresh.maxSteps || 40;
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
      const { ll_targets, ll_equip_filter, ll_autorefresh, ll_sort, ll_hide_panel, ll_hide_badges, ll_mail_template, ll_alert_rules, ll_sse_alerts } = await chrome.storage.local.get(["ll_targets", "ll_equip_filter", "ll_autorefresh", "ll_sort", "ll_hide_panel", "ll_hide_badges", "ll_mail_template", "ll_alert_rules", "ll_sse_alerts"]);
      sseAlerts = !!ll_sse_alerts;
      if (Array.isArray(ll_targets) && ll_targets.length) targets = ll_targets;
      equipFilter = LLEQUIP.normalize(ll_equip_filter);
      if (typeof LLRULES !== "undefined") alertRules = LLRULES.normalize(ll_alert_rules);
      if (typeof ll_mail_template === "string" && ll_mail_template.trim()) mailTemplate = ll_mail_template;
      hidePanel = !!ll_hide_panel;
      hideBadges = !!ll_hide_badges;
      // on = глобальный тумблер попапа (ll_autorefresh.on) с per-tab override из панели (sessionStorage).
      const globalOn = !!(ll_autorefresh && ll_autorefresh.on);
      autoRefresh = {
        on: (typeof LLTAB !== "undefined") ? LLTAB.resolveAutorefresh(sessionStorage, globalOn) : globalOn,
        intervalMs: (ll_autorefresh && ll_autorefresh.intervalMs) || 60000,
        scroll: !ll_autorefresh || ll_autorefresh.autoscroll !== false, // дефолт ВКЛ
        maxSteps: (ll_autorefresh && ll_autorefresh.maxSteps) || 40,
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
        if (ch.ll_hide_panel) hidePanel = !!ch.ll_hide_panel.newValue;
        if (ch.ll_hide_badges) hideBadges = !!ch.ll_hide_badges.newValue;
        if (ch.ll_autorefresh) {
          const v = ch.ll_autorefresh.newValue, prev = ch.ll_autorefresh.oldValue;
          autoRefresh.intervalMs = (v && v.intervalMs) || 60000;
          autoRefresh.scroll = !v || v.autoscroll !== false;
          autoRefresh.maxSteps = (v && v.maxSteps) || 40;
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
      if (d.type !== "dat-findloads") return;
      if (typeof DAT_GQL !== "undefined") {
        const res = DAT_GQL.parseFindLoadsResult(d.payload);
        log("received dat-findloads → parse:", res.loads.length, "loads, searchId", res.searchId || "—", res.loads.length ? "" : "(empty — the DAT schema may have changed)");
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

    render();
    scheduleAuto(); // запустить авто-рефреш, если включён в настройках
    const obs = new MutationObserver(() => schedule());
    obs.observe(document.body, { childList: true, subtree: true });
    let lastPath = location.pathname + location.search;
    setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== lastPath) { lastPath = cur; schedule(); }
    }, 600);
    // живой монитор: пока панель открыта и вкладка видима — delta-poll neighborhood'ов цепочки
    setInterval(() => {
      if (panelCollapsed || document.visibilityState !== "visible") return;
      const onward = [...new Set(currentLoads().map((l) => l.destMarket))];
      if (onward.length) fetchCrowdLoads(onward, { poll: true });
    }, POLL_MS);
  }
  boot();
})();
