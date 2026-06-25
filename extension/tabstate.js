/* LoadLens per-tab состояние. Хранит флаги в sessionStorage (привязан к вкладке+origin,
   переживает location.reload()). Чистый модуль: storage инъектится — тестируется без браузера. */
const LLTAB = (() => {
  "use strict";
  const K_AR = "ll_tab_autorefresh";
  const K_HINTS = "ll_tab_hints_off";

  function readFlag(ss, key) {
    try { return !!ss && ss.getItem(key) === "1"; } catch (_) { return false; }
  }
  function writeFlag(ss, key, val) {
    try { if (ss) ss.setItem(key, val ? "1" : "0"); } catch (_) { /* приватный режим/квота */ }
  }

  return {
    getAutorefresh: (ss) => readFlag(ss, K_AR),
    setAutorefresh: (ss, on) => writeFlag(ss, K_AR, on),
    getHintsOff: (ss) => readFlag(ss, K_HINTS),
    setHintsOff: (ss, off) => writeFlag(ss, K_HINTS, off),
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLTAB; }
if (typeof globalThis !== "undefined") globalThis.LLTAB = LLTAB;
