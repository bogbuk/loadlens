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
  let costPerMile = 1.80;
  let hosState = (typeof LLHOS !== "undefined") ? LLHOS.fresh() : { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 4200 };
  let currentMarket = null; // рынок водителя для планировщика (по умолчанию — самый частый origin в выдаче)

  let gqlLoads = [];              // грузы из перехваченного ответа DAT FindLoads (inject.js)
  const laneCache = new Map();    // "O>D|E" -> {medianRpm|null}  (из backend)
  const marketCache = new Map();  // market -> strength 0..1
  const laneRequested = new Set();
  const marketRequested = new Set();

  // ---------- сбор строк ----------
  function collectLoads() {
    const seen = new Map();
    document.querySelectorAll(adapter.rowSelector).forEach((row) => {
      const load = safeParse(row);
      if (!load) return;
      load._row = row;
      seen.set(load.loadId + "@" + rowIndex(row), load);
    });
    return [...seen.values()];
  }
  function safeParse(row) { try { return adapter.parseRow(row); } catch { return null; } }
  let _ri = 0;
  function rowIndex(row) { if (!row.__lli) row.__lli = ++_ri; return row.__lli; }

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
  function strengthOf(market) {
    if (marketCache.has(market)) return marketCache.get(market);
    const seed = globalThis.LLSEED && LLSEED.markets[market];
    return seed ? seed.strength : 0.5;
  }

  // ---------- бейджи ----------
  function clearBadges() { document.querySelectorAll(".ll-badge").forEach((b) => b.remove()); }

  function badgeFor(load) {
    const row = load._row;
    if (!row) return;
    const laneMedian = laneCache.has(laneKeyOf(load)) ? laneCache.get(laneKeyOf(load)) : null;
    const profit = LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian });
    const hos = hosBadge(load);

    const host = document.createElement("span");
    host.className = "ll-badge ll-" + profit.level;
    host.appendChild(chip(profitText(profit), "ll-profit"));
    host.appendChild(chip("HOS " + hosIcon(hos), "ll-hos ll-" + hos));
    // вешаем в конец строки (или в первую ячейку)
    (row.querySelector("td, .col-rate, span") || row).appendChild(host);
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
  function buildChains(loads) {
    if (typeof LLPLAN === "undefined") return [];
    const start = currentMarket || topOriginMarket(loads);
    if (!start) return [];
    return LLPLAN.plan({
      start: { market: start },
      hosState,
      loads,
      distance: (a, b) => LLGEO.sync(a, b),
      marketStrength: strengthOf,
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
    const domAll = collectLoads();                 // DOM-строки (для построчных бейджей; нужны реальные селекторы)
    const domLoads = uniqueLoads(domAll);
    // Источник для панели/скоринга/крауд-базы: GraphQL-перехват (точные данные DAT) приоритетнее DOM.
    const loads = gqlLoads.length ? gqlLoads : domLoads;
    queueSync(loads);
    fetchLanes(loads);
    fetchMarkets(uniqueMarkets(loads));

    clearBadges();
    domAll.forEach(badgeFor);                       // бейджи вешаем только на реальные DOM-строки (есть _row)

    if (panelCollapsed) {
      const p = document.getElementById("ll-panel"); if (p) p.remove();
      showFab();
      return;
    }
    const fab = document.getElementById("ll-fab"); if (fab) fab.remove();

    const start = currentMarket || topOriginMarket(loads);
    const chains = buildChains(loads).filter((c) => c.legs.length >= 1);
    const deals = loads.map((l) => ({ l, b: LLSCORE.profitBadge(l, { costPerMile, dieselPrice, laneMedian: laneCache.get(laneKeyOf(l)) }) }))
      .filter((d) => d.b.level === "green").slice(0, 5);

    const p = buildPanel();
    const bd = p.querySelector(".bd");
    bd.innerHTML =
      row("Грузов в выдаче", String(loads.length)) +
      row("Рынок старта", start ? esc(start) : "—") +
      row("Дизель", "$" + dieselPrice.toFixed(2) + "/гал") +
      `<div class="ll-cfg">Cost/mi: <input id="ll-cpm" type="number" step="0.05" value="${costPerMile}" style="width:60px"> ` +
      `Старт: <input id="ll-start" type="text" value="${start ? esc(start) : ""}" style="width:110px" placeholder="CHICAGO_IL"></div>` +
      (chains.length ? "<h4>Get-out цепочки</h4>" + chains.map(chainRow).join("") : "<div class='note'>Цепочки появятся, когда видно достаточно грузов из рынка старта.</div>") +
      (deals.length ? "<h4>Выгодные сейчас</h4>" + deals.map((d) =>
        `<div class="deal"><span class="m">${esc(d.l.originMarket)} → ${esc(d.l.destMarket)} ${esc(d.l.equipment)}</span>` +
        `<span class="p">$${d.b.netRpm.toFixed(2)}/mi</span></div>`).join("") : "") +
      '<div class="note">Скоринг учитывает deadhead, топливо и медиану рынка по lane. Ставка с борда — запрос брокера. HOS-бейдж — выполнимость по часам водителя.</div>';

    const cpm = bd.querySelector("#ll-cpm");
    if (cpm) cpm.onchange = () => { const v = parseFloat(cpm.value); if (v > 0) { costPerMile = v; render(); } };
    const st = bd.querySelector("#ll-start");
    if (st) st.onchange = () => { currentMarket = st.value.trim().toUpperCase() || null; render(); };
  }

  function chainRow(c) {
    const path = c.legs.map((l) => l.origin).concat(c.finalMarket);
    const badge = c.hosBadge === "green" ? "✓" : c.hosBadge === "amber" ? "!" : "✕";
    return `<div class="chain ll-${c.hosBadge}">` +
      `<div class="route">${esc(path.join(" → "))}</div>` +
      `<div class="meta">$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ${c.totalMiles}mi · HOS ${badge}</div></div>`;
  }

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
    try { const { ll_cpm } = await chrome.storage.local.get("ll_cpm"); if (ll_cpm > 0) costPerMile = ll_cpm; } catch { /* дефолт */ }
    // живое применение настроек из попапа без перезагрузки страницы
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (ch.ll_cpm && ch.ll_cpm.newValue > 0) costPerMile = ch.ll_cpm.newValue;
        if (ch.ll_hos && ch.ll_hos.newValue) hosState = ch.ll_hos.newValue;
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
