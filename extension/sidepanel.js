/* LoadLens side panel: вкладки Loads/Settings. Вкладка Settings — бывший попап (popup.js).
   Порт к content.js активной вкладки борда и рендер Loads — ниже (Task 5). */
(() => {
  "use strict";
  const $loads = document.getElementById("loads");

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.getElementById("tab-loads").hidden = name !== "loads";
    document.getElementById("tab-settings").hidden = name !== "settings";
  }
  document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

  $loads.innerHTML = '<div class="empty-state">Open a DAT One or Truckstop search tab — LoadLens shows its loads here.</div>';
})();
