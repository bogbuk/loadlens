/* PriceLens — генератор CSV (Pro-экспорт). Чистые функции, без DOM/chrome.* */
const PLCSV = (() => {
  "use strict";

  function cell(v) {
    let s = v == null ? "" : String(v);
    // Защита от CSV formula injection: заголовки приходят с 999.md (контролируются продавцом),
    // ячейка, начинающаяся с =,+,-,@,таб,CR, в Excel/Numbers исполняется как формула — нейтрализуем.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // rows: [{listingId,title,groupKey,metric,unit,attrs}], attrKeys: плоские attrs категории
  function buildCsv(rows, attrKeys) {
    const head = ["listing_id", "title", "group_key", "metric_eur", "unit", ...attrKeys];
    const lines = [head.join(";")];
    rows.forEach((r) => {
      lines.push([
        cell(r.listingId), cell(r.title), cell(r.groupKey), cell(r.metric), cell(r.unit),
        ...attrKeys.map((k) => cell(r.attrs ? r.attrs[k] : null)),
      ].join(";"));
    });
    return "﻿" + lines.join("\r\n");
  }

  return { buildCsv, cell };
})();

if (typeof module !== "undefined") { module.exports = PLCSV; global.PLCSV = PLCSV; }
