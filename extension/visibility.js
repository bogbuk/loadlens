/* LoadLens — видимость наших наложений на странице DAT/Truckstop.
   Сводит 4 флага в решения «рисовать / не рисовать»:
   - hintsOff       — per-tab «скрыть всё на этой вкладке» (кнопка 🙈 в шапке панели)
   - hideBadges     — глобальная настройка попапа (ll_hide_badges)
   - hidePanel      — глобальная настройка попапа (ll_hide_panel)
   - panelCollapsed — per-tab сворачивание панели (кнопка «–») */
const LLVIS = (() => {
  function badgesVisible(s) { return !s.hintsOff && !s.hideBadges; }
  function panelVisible(s) { return !s.hintsOff && !s.hidePanel && !s.panelCollapsed; }
  // FAB-возврат показываем, только когда панель скрыта per-tab (сворачивание/hintsOff),
  // но НЕ когда её прячет глобальная настройка — ей управляют из попапа.
  function fabVisible(s) { return !panelVisible(s) && !s.hidePanel; }
  return { badgesVisible, panelVisible, fabVisible };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLVIS; }
if (typeof globalThis !== "undefined") globalThis.LLVIS = LLVIS;
