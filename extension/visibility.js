/* LoadLens — видимость наших наложений на странице DAT/Truckstop. Панель грузов живёт в боковой
   панели Chrome, на странице — только построчные бейджи и FAB (вход в боковую панель):
   - hintsOff  — per-tab «скрыть всё на этой вкладке» (кнопка в боковой панели)
   - hideBadges — глобальная настройка (ll_hide_badges, вкладка Settings)
   - panelOpen — боковая панель подключена к этой вкладке (порт ll-panel) */
const LLVIS = (() => {
  function badgesVisible(s) { return !s.hintsOff && !s.hideBadges; }
  function fabVisible(s) { return !s.hintsOff && !s.panelOpen; }
  return { badgesVisible, fabVisible };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLVIS; }
if (typeof globalThis !== "undefined") globalThis.LLVIS = LLVIS;
