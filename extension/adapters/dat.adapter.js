/* LoadLens — адаптер DAT One. Грузится после adapters.js и load.model.js.

   ВНИМАНИЕ: селекторы — ЗАГЛУШКА. DAT One за платным логином, реальный DOM недоступен из песочницы.
   Задача №1: залогиниться в живую сессию, открыть search results, снять data-test/классы через
   DevTools, обновить DAT_SELECTORS и сохранить фикстуру строки в __fixtures__/dat-row.html.
   Логика parseRow от конкретных селекторов отвязана — менять нужно только карту ниже. */
(() => {
  "use strict";
  if (typeof LLADAPT === "undefined" || typeof LLMODEL === "undefined") return;

  // Единственное место правки при редизайне DAT. Селекторы ищутся ВНУТРИ строки груза.
  const DAT_SELECTORS = {
    row: '[data-test="search-result-row"]',     // TODO: подтвердить на живой сессии
    origin: '[data-test="cell-origin"]',
    dest: '[data-test="cell-destination"]',
    equipment: '[data-test="cell-equipment"]',
    rate: '[data-test="cell-rate"]',
    tripMiles: '[data-test="cell-trip-miles"]',
    dhMiles: '[data-test="cell-dh-origin"]',
    weight: '[data-test="cell-weight"]',
    age: '[data-test="cell-age"]',
    company: '[data-test="cell-company"]',
    contact: '[data-test="cell-contact"]',
    factoring: '[data-test="cell-factoring"]',
    loadId: '[data-test="row-id"]',
  };

  const DAT_ADAPTER = {
    board: "dat",
    hostMatch: "dat.com",
    rowSelector: DAT_SELECTORS.row,
    isBoardPage() { return /\/search\b|\/loads\b/.test(location.pathname) || true; },

    parseRow(rowEl) {
      const t = (sel) => LLADAPT.text(rowEl, sel);
      const o = LLADAPT.splitCityState(t(DAT_SELECTORS.origin));
      const d = LLADAPT.splitCityState(t(DAT_SELECTORS.dest));
      const loadId = t(DAT_SELECTORS.loadId) || rowEl.getAttribute("data-load-id") || "";
      return LLMODEL.buildLoad({
        loadId,
        originCity: o.city, originState: o.state,
        destCity: d.city, destState: d.state,
        equipment: t(DAT_SELECTORS.equipment),
        rate: t(DAT_SELECTORS.rate),
        loadedMiles: t(DAT_SELECTORS.tripMiles),
        deadheadMiles: t(DAT_SELECTORS.dhMiles),
        weight: t(DAT_SELECTORS.weight),
        postedAge: t(DAT_SELECTORS.age),
        brokerName: t(DAT_SELECTORS.company),
        contact: t(DAT_SELECTORS.contact),  // PII — режется в LLAPI.sanitizeLoad
      }, "dat");
    },
  };

  LLADAPT.register(DAT_ADAPTER);
  if (typeof module !== "undefined" && module.exports) module.exports = { DAT_ADAPTER, DAT_SELECTORS };
})();
