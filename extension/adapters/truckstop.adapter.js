/* LoadLens — адаптер Truckstop. Грузится после adapters.js и load.model.js.

   ВНИМАНИЕ: селекторы — ЗАГЛУШКА (Truckstop за логином). Снять с живой сессии, обновить
   TRUCKSTOP_SELECTORS, сохранить фикстуру в __fixtures__/truckstop-row.html.
   Truckstop Marketplace partner program — легальный путь (там уже LoadHunter). */
(() => {
  "use strict";
  if (typeof LLADAPT === "undefined" || typeof LLMODEL === "undefined") return;

  const TRUCKSTOP_SELECTORS = {
    row: '.results-row',                         // TODO: подтвердить на живой сессии
    origin: '.col-origin',
    dest: '.col-destination',
    equipment: '.col-equipment',
    rate: '.col-rate',
    tripMiles: '.col-miles',
    dhMiles: '.col-deadhead',
    weight: '.col-weight',
    age: '.col-age',
    company: '.col-company',
    contact: '.col-phone',
    loadId: '.results-row-id',
  };

  const TRUCKSTOP_ADAPTER = {
    board: "truckstop",
    hostMatch: "truckstop.com",
    rowSelector: TRUCKSTOP_SELECTORS.row,
    isBoardPage() { return /\/loads\b|\/search\b/.test(location.pathname) || true; },

    parseRow(rowEl) {
      const t = (sel) => LLADAPT.text(rowEl, sel);
      const o = LLADAPT.splitCityState(t(TRUCKSTOP_SELECTORS.origin));
      const d = LLADAPT.splitCityState(t(TRUCKSTOP_SELECTORS.dest));
      const loadId = t(TRUCKSTOP_SELECTORS.loadId) || rowEl.getAttribute("data-id") || "";
      return LLMODEL.buildLoad({
        loadId,
        originCity: o.city, originState: o.state,
        destCity: d.city, destState: d.state,
        equipment: t(TRUCKSTOP_SELECTORS.equipment),
        rate: t(TRUCKSTOP_SELECTORS.rate),
        loadedMiles: t(TRUCKSTOP_SELECTORS.tripMiles),
        deadheadMiles: t(TRUCKSTOP_SELECTORS.dhMiles),
        weight: t(TRUCKSTOP_SELECTORS.weight),
        postedAge: t(TRUCKSTOP_SELECTORS.age),
        brokerName: t(TRUCKSTOP_SELECTORS.company),
        contact: t(TRUCKSTOP_SELECTORS.contact),
      }, "truckstop");
    },

    // У Truckstop нет GraphQL-перехвата → данные и якорь бейджа берём из DOM (parseRow на каждую строку).
    collect() {
      const out = [];
      document.querySelectorAll(TRUCKSTOP_SELECTORS.row).forEach((row) => {
        const load = this.parseRow(row);
        if (load) out.push(load);
      });
      return out;
    },
    anchor() {
      const pairs = [];
      document.querySelectorAll(TRUCKSTOP_SELECTORS.row).forEach((row) => {
        const load = this.parseRow(row);
        if (load) pairs.push({ row, load, anchor: row });
      });
      return pairs;
    },
  };

  LLADAPT.register(TRUCKSTOP_ADAPTER);
  if (typeof module !== "undefined" && module.exports) module.exports = { TRUCKSTOP_ADAPTER, TRUCKSTOP_SELECTORS };
})();
