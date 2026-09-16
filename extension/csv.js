/* LoadLens — генератор CSV (Pro-экспорт грузов). Чистые функции, без DOM/chrome.* */
const LLCSV = (() => {
  "use strict";

  // Возраст постинга считает канон-модель (vendor/ — автокопия shared/load.model.js).
  const MODEL = (typeof LLMODEL !== "undefined") ? LLMODEL
    : (typeof require === "function" ? require("./vendor/load.model.js") : null);

  function cell(v) {
    let s = v == null ? "" : String(v);
    // Защита от CSV formula injection: данные брокера (companyName/comments) контролируются им;
    // ячейка, начинающаяся с =,+,-,@,таб,CR — в Excel/Numbers исполняется как формула → нейтрализуем.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const HEAD = [
    "board", "load_id", "origin", "dest", "equipment", "rate_usd", "rate_basis",
    "loaded_miles", "deadhead_miles", "true_rpm", "broker_name", "broker_mc",
    "credit_score", "days_to_pay", "factorable", "comments", "age_min",
  ];

  function trueRpm(r) {
    const denom = (r.loadedMiles || 0) + (r.deadheadMiles || 0);
    return r.rate && denom > 0 ? Math.round((r.rate / denom) * 100) / 100 : "";
  }

  // loads: unified Load[] (из перехвата/DOM). Возвращает CSV-строку (BOM, ; разделитель, RFC 4180).
  function buildLoadsCsv(loads) {
    const lines = [HEAD.join(";")];
    loads.forEach((l) => {
      lines.push([
        cell(l.board), cell(l.loadId), cell(l.originMarket), cell(l.destMarket), cell(l.equipment),
        cell(l.rate), cell(l.rateBasis), cell(l.loadedMiles), cell(l.deadheadMiles), cell(trueRpm(l)),
        cell(l.brokerName), cell(l.brokerMc), cell(l.creditScore), cell(l.daysToPay),
        cell(l.isFactorable ? "yes" : ""), cell(l.comments),
        cell(MODEL ? MODEL.ageMinutes(l, Date.now()) : null),
      ].join(";"));
    });
    return "﻿" + lines.join("\r\n");
  }

  return { buildLoadsCsv, cell, HEAD };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLCSV; }
if (typeof globalThis !== "undefined") globalThis.LLCSV = LLCSV;
