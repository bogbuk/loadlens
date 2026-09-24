/* LoadLens side panel: вкладки Loads/Settings. Вкладка Settings — бывший попап (popup.js).
   Loads: порт ll-panel к content.js АКТИВНОЙ вкладки борда в этом окне; content шлёт снапшоты
   (LLVIEW), мы рисуем их LLPANEL и отправляем команды обратно. Фоновые вкладки не подключены —
   их авто-пилот не тратит CPU на снапшоты. */
(() => {
  "use strict";
  const $loads = document.getElementById("loads");
  let winId = null;
  let port = null, portTabId = null;
  let snap = null, lastJson = "", lastDetailId = null;
  let expandedSig = null;        // раскрытая цепочка — чисто панельное состояние
  let notice = "", noticeTimer = null;
  let lastHtml = "";             // уже нарисованная разметка — одинаковую не трогаем (открытые <details>, выделение)
  let deferred = false;          // снапшот пришёл, пока пользователь в поле ввода — рисуем на blur
  // Повторы подключения: content-скрипт стартует на document_idle, т.е. после onUpdated(complete).
  // Счётчик — на вкладку; сбрасывается успехом, сменой вкладки и новой загрузкой страницы.
  const RETRY_MS = [700, 1500, 3000, 5000];
  let retry = { tabId: null, n: 0 };

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.getElementById("tab-loads").hidden = name !== "loads";
    document.getElementById("tab-settings").hidden = name !== "settings";
  }
  document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

  // Перерисовка innerHTML сбросила бы ввод — пока фокус в поле/селекте панели, откладываем.
  // document.hasFocus(): ушёл в DAT — activeElement остаётся тем же полем, но пользователь уже не печатает.
  function editing() {
    const a = document.activeElement;
    return document.hasFocus() && !!a && $loads.contains(a) && (a.tagName === "SELECT" || (a.tagName === "INPUT" && (a.type === "text" || a.type === "number")));
  }
  function paint() {
    if (!snap) return;
    if (editing()) { deferred = true; return; }
    deferred = false;
    // В режиме карточки рисуется только деталь: смена шапки/цепочек/возраста не должна пересоздавать DOM.
    const html = LLPANEL.loadsView(snap, { expandedSig, notice });
    if (html === lastHtml) return;
    lastHtml = html;
    $loads.innerHTML = html;
  }
  $loads.addEventListener("focusout", () => { if (deferred) setTimeout(paint, 0); });
  window.addEventListener("blur", () => { if (deferred) setTimeout(paint, 0); }); // панель потеряла фокус целиком

  function flash(text) {
    notice = text; paint();
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ""; paint(); }, 2500);
  }
  function download(filename, csv) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function showEmpty(kind) { snap = null; lastJson = ""; lastHtml = ""; $loads.innerHTML = LLPANEL.empty(kind); }

  function onMsg(m) {
    if (!m) return;
    if (m.type === "snapshot") {
      const json = JSON.stringify(m.data);
      if (json === lastJson) return;
      lastJson = json; snap = m.data;
      const did = snap.detail ? snap.detail.loadId : null;
      if (did != null && did !== lastDetailId) showTab("loads"); // клик ⓘ на странице — показать карточку
      lastDetailId = did;
      paint();
    } else if (m.type === "scrollResult") {
      if (!m.ok) flash("Load is not in the visible results");
    } else if (m.type === "csv") {
      download(m.filename, m.csv);
    } else if (m.type === "notice") {
      flash(m.text);
    }
  }
  function send(cmd, args) {
    if (!port) return;
    try { port.postMessage({ type: "cmd", cmd, ...(args || {}) }); } catch (_) { port = null; portTabId = null; }
  }

  function disconnect() {
    if (port) { try { port.disconnect(); } catch (_) { /* уже закрыт */ } }
    port = null; portTabId = null;
  }
  async function connectActive() {
    let tab = null;
    try { [tab] = await chrome.tabs.query({ active: true, windowId: winId }); } catch (_) { tab = null; }
    // URL есть только у вкладок из host_permissions — у остальных он undefined → «не борд»
    if (!tab || !LLPANEL.isBoardUrl(tab.url)) { disconnect(); showEmpty("not-board"); return; }
    if (port && portTabId === tab.id) return;
    disconnect();
    showEmpty("connecting");
    const p = chrome.tabs.connect(tab.id, { name: "ll-panel" });
    port = p; portTabId = tab.id;
    let gotAny = false;
    p.onMessage.addListener((m) => { if (!gotAny) { gotAny = true; retry = { tabId: null, n: 0 }; } onMsg(m); });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // «Could not establish connection» — ожидаемо, не шумим в консоль
      if (port !== p) return;       // уже переподключились к другой вкладке
      port = null; portTabId = null;
      if (gotAny) return;           // вкладка перезагружается — переподключимся на onUpdated(complete)
      if (retry.tabId !== tab.id) retry = { tabId: tab.id, n: 0 };
      if (retry.n < RETRY_MS.length) { setTimeout(connectActive, RETRY_MS[retry.n++]); return; }
      showEmpty("no-script");
    });
  }

  chrome.tabs.onActivated.addListener((info) => { if (info.windowId === winId) { retry = { tabId: null, n: 0 }; connectActive(); } });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.active || tab.windowId !== winId) return;
    if (info.status === "complete") retry = { tabId: null, n: 0 }; // новая загрузка — новые попытки
    if (info.status === "complete" || info.url) connectActive();
  });

  $loads.addEventListener("click", (e) => {
    const el = e.target.closest("[data-cmd]");
    if (!el) return;
    const c = el.dataset.cmd;
    if (c === "toggleChain") { expandedSig = expandedSig === el.dataset.sig ? null : el.dataset.sig; paint(); return; }
    if (c === "copy") {
      const a = snap && snap.detail && snap.detail.actions;
      const text = a && (el.dataset.what === "email" ? a.copyEmail : a.copy);
      if (text) navigator.clipboard.writeText(text).then(() => flash("Copied ✓"), () => flash("Clipboard is not available"));
      return;
    }
    if (c === "scrollToRow") { if (!el.dataset.result) flash("Load is not in the visible results"); else send("scrollToRow", { resultId: el.dataset.result }); return; }
    if (c === "setSortDir") return send("setSort", { dir: el.dataset.dir });
    if (c === "setHintsOff") return send("setHintsOff", { on: el.dataset.on === "1" });
    if (c === "openDetail") return send("openDetail", { loadId: el.dataset.load });
    if (c === "reportBroker") return send("reportBroker", { mc: el.dataset.mc, outcome: el.dataset.outcome });
    if (c === "closeDetail" || c === "exportCsv") return send(c);
  });
  $loads.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "ll-driver") send("setDriver", { id: t.value });
    else if (t.id === "ll-cpm") send("setCpm", { value: t.value });
    else if (t.id === "ll-start") send("setStart", { market: t.value });
    else if (t.id === "ll-ar") send("setAutorefresh", { on: t.checked });
    else if (t.id === "ll-sort-f") send("setSort", { field: t.value || null });
    else return;
    // значение ушло во вкладку — отпускаем фокус, иначе отложенная перерисовка ждала бы клика мимо
    if (t.tagName === "SELECT" || t.type === "text" || t.type === "number") t.blur();
  });

  chrome.windows.getCurrent().then((w) => { winId = w.id; connectActive(); });
})();
