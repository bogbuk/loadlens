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
    log("FindLoads intercepted → posting to content.js:", n, "results");
    window.postMessage({ source: "loadlens", type: "dat-findloads", payload }, window.location.origin);
  };

  function maybeCapture(url, getJson) {
    if (!url || url.indexOf("one-web-bff/graphql") === -1) return;
    getJson().then((j) => {
      if (j && j.data && j.data.freightSearchV4 && j.data.freightSearchV4.findLoads) post(j);
      else log("graphql response without freightSearchV4.findLoads (different operation):", url);
    }).catch(() => {});
  }

  // Нативные Load Match Alerts DAT: приложение само открывает SSE-поток
  // `notification/v3/liveQueryMatches/{searchId}` (text/event-stream) на каждую вкладку поиска
  // через fetch-based EventSourcePolyfill. Полифил захватывает ссылку на fetch при загрузке
  // модуля — т.е. ИМЕННО эту обёртку (мы на document_start). Читаем КЛОН тела как поток, парсим
  // кадры (LLSSE) и шлём content.js. Своих запросов не шлём, поток не инициируем
  // (см. docs/research/2026-09-15-dat-load-match-alerts-spike.md).
  function maybeTeeSse(url, res) {
    if (!url || url.indexOf("/liveQueryMatches/") === -1 || !res || !res.body) return;
    if (typeof LLSSE === "undefined") { log("liveQueryMatches stream seen, but LLSSE is not loaded"); return; }
    const ct = (res.headers && res.headers.get("content-type")) || "";
    if (ct.indexOf("text/event-stream") === -1) return;
    const searchId = url.split("/liveQueryMatches/")[1].split(/[?#]/)[0] || null;
    const parser = LLSSE.createParser();
    const dec = new TextDecoder();
    let reader;
    try { reader = res.clone().body.getReader(); } catch (_) { return; }
    log("liveQueryMatches SSE tee started, searchId", searchId);
    (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const f of parser.push(dec.decode(value, { stream: true }))) {
          let data;
          try { data = JSON.parse(f.data); } catch (_) { continue; }
          log("SSE event", f.event, "→ posting to content.js");
          window.postMessage({ source: "loadlens", type: "dat-match-event", payload: { event: f.event, id: f.id, searchId, data } }, window.location.origin);
        }
      }
      log("liveQueryMatches SSE tee ended, searchId", searchId);
    })().catch(() => {});
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
          maybeTeeSse(url, res);
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

  log("fetch/XHR interceptor installed (MAIN world). LL_DEBUG is on.");
})();
