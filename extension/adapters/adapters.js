/* LoadLens — реестр site-adapters. Аналог PriceLens PLCATS.configFor, но по host.
   Каждый адаптер изолирует CSS-селекторы своего борда (объект *_SELECTORS) и реализует
   единый интерфейс { board, rowSelector, isBoardPage(), parseRow(rowEl) -> Load|null }.
   Грузится после load.model.js (нужен LLMODEL) и перед dat/truckstop адаптерами. */
const LLADAPT = (() => {
  "use strict";
  const REGISTRY = {}; // host-substr -> adapter

  function register(adapter) { REGISTRY[adapter.hostMatch] = adapter; }

  function adapterFor(host) {
    for (const key in REGISTRY) if (host.includes(key)) return REGISTRY[key];
    return null;
  }

  // Утилита для адаптеров: текст по селектору внутри строки.
  function text(rowEl, sel) {
    if (!sel) return "";
    const el = rowEl.querySelector(sel);
    return el ? el.textContent.trim() : "";
  }

  // Утилита: "Chicago, IL" -> { city:"Chicago", state:"IL" }.
  function splitCityState(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^(.*?),\s*([A-Za-z]{2})\b/);
    if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
    return { city: s, state: "" };
  }

  return { register, adapterFor, text, splitCityState, _registry: REGISTRY };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLADAPT;
if (typeof globalThis !== "undefined") globalThis.LLADAPT = LLADAPT;
