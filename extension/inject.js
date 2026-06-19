/* LoadLens — перехватчик сети в MAIN-world DAT One.
   Патчит window.fetch, чтобы прочитать ответы, которые приложение DAT само загружает
   (operation FindLoads на one-web-bff/graphql), и переслать их content-скрипту через postMessage.
   Мы НЕ инициируем своих запросов к DAT — только наблюдаем уже выполненные приложением (ToS: читаем
   то, что пользователь и так видит). Грузится с run_at=document_start, чтобы патч встал до app. */
(() => {
  "use strict";
  if (window.__loadlensHooked) return;
  window.__loadlensHooked = true;

  // debug-логи под флагом: localStorage.LL_DEBUG = "1" (без перезагрузки расширения, читаем каждый раз)
  const llDebug = () => { try { return localStorage.getItem("LL_DEBUG") != null; } catch (_) { return false; } };
  const log = (...a) => { if (llDebug()) { try { console.log("[LoadLens/inject]", ...a); } catch (_) {} } };

  const post = (payload) => {
    const fl = payload && payload.data && payload.data.freightSearchV4 && payload.data.freightSearchV4.findLoads;
    const n = (fl && fl.results && fl.results.length) || 0;
    log("FindLoads перехвачен → постим content.js:", n, "results");
    window.postMessage({ source: "loadlens", type: "dat-findloads", payload }, window.location.origin);
  };

  function maybeCapture(url, getJson) {
    if (!url || url.indexOf("one-web-bff/graphql") === -1) return;
    getJson().then((j) => {
      if (j && j.data && j.data.freightSearchV4 && j.data.freightSearchV4.findLoads) post(j);
      else log("graphql-ответ без freightSearchV4.findLoads (другая operation):", url);
    }).catch(() => {});
  }

  // fetch (GraphQL-клиент DAT использует именно его)
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      p.then((res) => {
        try {
          const url = (args[0] && args[0].url) || String(args[0] || "");
          maybeCapture(url, () => res.clone().json());
        } catch (_) { /* не мешаем приложению */ }
      }).catch(() => {});
      return p;
    };
  }

  // XHR-фолбэк на случай, если часть запросов идёт через XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__llUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener("load", () => {
      try {
        if (this.__llUrl && this.__llUrl.indexOf("one-web-bff/graphql") !== -1) {
          const j = JSON.parse(this.responseText);
          if (j && j.data && j.data.freightSearchV4 && j.data.freightSearchV4.findLoads) post(j);
        }
      } catch (_) { /* игнор */ }
    });
    return origSend.apply(this, a);
  };

  log("перехватчик fetch/XHR установлен (MAIN-world). Включён LL_DEBUG.");
})();
