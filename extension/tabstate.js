/* LoadLens per-tab состояние. Хранит флаги в sessionStorage (привязан к вкладке+origin,
   переживает location.reload()). Чистый модуль: storage инъектится — тестируется без браузера.
   Авто-пилот: глобальный тумблер живёт в chrome.storage.local (ll_autorefresh.on, попап), здесь —
   только per-tab override; побеждает последнее действие (см. content.js). */
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
  // tri-state: "1" → true, "0" → false, отсутствует/ошибка → null (override не задан)
  function readOverride(ss, key) {
    try {
      const v = ss ? ss.getItem(key) : null;
      return v === "1" ? true : v === "0" ? false : null;
    } catch (_) { return null; }
  }
  function clearFlag(ss, key) {
    try { if (ss && ss.removeItem) ss.removeItem(key); } catch (_) { /* приватный режим */ }
  }

  return {
    getAutorefresh: (ss) => readFlag(ss, K_AR),
    setAutorefresh: (ss, on) => writeFlag(ss, K_AR, on),
    // Итоговое «вкл/выкл» для вкладки: per-tab override (галка в панели) > глобальный тумблер попапа.
    resolveAutorefresh: (ss, globalOn) => { const o = readOverride(ss, K_AR); return o === null ? !!globalOn : o; },
    clearAutorefresh: (ss) => clearFlag(ss, K_AR),
    getHintsOff: (ss) => readFlag(ss, K_HINTS),
    setHintsOff: (ss, off) => writeFlag(ss, K_HINTS, off),
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLTAB; }
if (typeof globalThis !== "undefined") globalThis.LLTAB = LLTAB;
