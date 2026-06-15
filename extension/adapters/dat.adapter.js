/* LoadLens — адаптер DAT One. Грузится после adapters.js и load.model.js.

   Источник ДАННЫХ для DAT — GraphQL-перехват (dat.graphql.js / inject.js), а DOM нужен только
   как ЯКОРЬ для построчных бейджей. Селекторы сняты с живой сессии (2026-06-13): каждая строка —
   `div.row-container` с `id="table-row-<resultId>"`, где <resultId> совпадает с resultId из ответа
   FindLoads. Поэтому матчим строку↔груз по resultId, а не парсим ячейки (надёжно к смене вёрстки). */
(() => {
  "use strict";
  if (typeof LLADAPT === "undefined" || typeof LLMODEL === "undefined") return;

  const DAT_SELECTORS = {
    row: 'div.row-container[id^="table-row-"]',  // контейнер строки результата
    cells: 'div.row-cells',                       // обёртка ячеек (для якоря бейджа)
    phone: 'a[href^="tel:"]',
  };
  const ROW_ID_PREFIX = "table-row-";

  function resultIdOf(row) {
    const id = (row && row.id) || "";
    return id.startsWith(ROW_ID_PREFIX) ? id.slice(ROW_ID_PREFIX.length) : null;
  }

  // DAT сменил формат: result.resultId стал композитным `<длинное>+<короткий-row-id>`,
  // а DOM-id строки = `table-row-<короткий-row-id>` (сегмент после последнего "+").
  // Берём хвост после "+"; для старого формата (без "+") возвращаем строку как есть.
  function domRowKey(resultId) {
    return resultId == null ? "" : String(resultId).split("+").pop();
  }

  const DAT_ADAPTER = {
    board: "dat",
    hostMatch: "dat.com",
    rowSelector: DAT_SELECTORS.row,
    isBoardPage() { return /\/search-loads\b|\/search\b/.test(location.pathname) || true; },
    resultIdOf,

    // Построчные бейджи: матчим видимые DOM-строки с грузами из GraphQL по resultId.
    // loads — массив unified Load (из gqlLoads). Возвращает пары {row, load} для бейджа.
    anchor(loads) {
      const byId = new Map();
      (loads || []).forEach((l) => { if (l && l.resultId != null) byId.set(domRowKey(l.resultId), l); });
      const pairs = [];
      document.querySelectorAll(DAT_SELECTORS.row).forEach((row) => {
        const rid = resultIdOf(row);
        const load = rid && byId.get(rid);
        // якорь = сам контейнер строки: бейдж вешаем абсолютным оверлеем, не в грид ячеек
        if (load) pairs.push({ row, load, anchor: row });
      });
      return pairs;
    },

    // Прокрутка выдачи DAT к строке груза по resultId + кратковременная подсветка.
    // resultId — композитный; DOM-id строки = ROW_ID_PREFIX + domRowKey(resultId).
    // Возвращает true, если строка найдена (false — груз вне видимой выдачи: similarResults/прокручено).
    scrollToRow(resultId) {
      if (resultId == null) return false;
      const row = document.getElementById(ROW_ID_PREFIX + domRowKey(resultId));
      if (!row) return false;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("ll-row-flash");
      setTimeout(() => row.classList.remove("ll-row-flash"), 2000);
      return true;
    },

    // Данные DAT берём из GraphQL-перехвата, не из DOM.
    collect() { return []; },
  };

  LLADAPT.register(DAT_ADAPTER);
  if (typeof module !== "undefined" && module.exports) module.exports = { DAT_ADAPTER, DAT_SELECTORS, resultIdOf, domRowKey };
})();
