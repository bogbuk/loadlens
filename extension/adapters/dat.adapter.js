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

  // Кнопка SEARCH — РЕАЛЬНЫЙ селектор с живой сессии (2026-06-24): `button[data-test="search-button"]`.
  // DAT держит её disabled, пока критерии поиска не менялись → findRefreshButton пропускает disabled,
  // clickRefresh вернёт false, и content.js падает на fallback location.reload() (решение пользователя).
  const REFRESH_SELECTORS = {
    button: [
      'button[data-test="search-button"]',                // ← подтверждён живой сессией
      'button.search-button',
      'button[aria-label*="Search" i]',
      'button[aria-label*="Refresh" i]',
    ],
  };
  // ★ SORT_SELECTORS — всё ещё ЗАГЛУШКИ: снять HTML сорт-дропдауна с живой сессии DAT.
  const SORT_SELECTORS = {
    trigger: 'mat-select[data-test="sort-select"], mat-select.sort-select', // открывашка дропдауна
    panel: '.mat-select-panel, .cdk-overlay-pane mat-option',               // куда рендерятся опции
    option: 'mat-option',                                                   // одна опция сортировки
    optionLabel: '.mat-option-text',                                        // её видимый текст
  };

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

  // ---- авто-пилот: родной Search-клик + удержание сортировки DAT (чистые DOM-хелперы) ----

  // метка сортировки -> ключ: "Rate - Highest" -> "rate-highest" (стабильно к пунктуации/регистру)
  function sortKey(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // отрендеренные опции сорт-дропдауна -> [{key,label}] (если дропдаун в DOM/открыт)
  function readSortOptions(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    const out = [];
    if (!root) return out;
    root.querySelectorAll(SORT_SELECTORS.option).forEach((o) => {
      const labelEl = o.querySelector(SORT_SELECTORS.optionLabel) || o;
      const label = (labelEl.textContent || "").trim();
      if (label) out.push({ key: sortKey(label), label });
    });
    return out;
  }

  // найти mat-option по ключу среди отрендеренных опций; null если нет
  function pickSortOption(root, key) {
    const want = sortKey(key);
    if (!want || !root) return null;
    const list = [...root.querySelectorAll(SORT_SELECTORS.option)];
    return list.find((o) => {
      const labelEl = o.querySelector(SORT_SELECTORS.optionLabel) || o;
      return sortKey(labelEl.textContent) === want;
    }) || null;
  }

  // элемент кликабелен (не disabled): DAT держит SEARCH выключенной, пока критерии не менялись —
  // клик по ней no-op, поэтому такие пропускаем, чтобы не рапортовать ложный успех.
  function usable(el) {
    if (!el) return false;
    if (el.disabled === true) return false;
    const ad = el.getAttribute && el.getAttribute("aria-disabled");
    return ad !== "true" && ad !== true;
  }

  // Имя кнопки — ТОЧНО «Search»/«Refresh» (текст или aria-label). Регрессия 2026-09-13: фолбэк по
  // /\bsearch\b/ цеплял тулбар-кнопку «SEARCH BACK - 24 HRS», когда настоящая SEARCH была disabled →
  // clickRefresh «успешно» тогглил дропдаун, reload-фолбэк не наступал и выдача не обновлялась вовсе.
  const REFRESH_NAME = /^(search|refresh)$/i;
  function isRefreshLabel(el) {
    const text = (el.textContent || "").trim();
    const aria = (el.getAttribute && el.getAttribute("aria-label")) || "";
    return REFRESH_NAME.test(text) || REFRESH_NAME.test(String(aria).trim());
  }
  // кнопка Search/Refresh: кандидаты по порядку (первые два селектора — точечные, им верим; aria-label-
  // селекторы — только при точном имени), затем фолбэк по точному тексту; только АКТИВНЫЕ
  function findRefreshButton(root) {
    if (!root) return null;
    for (let i = 0; i < REFRESH_SELECTORS.button.length; i++) {
      const el = root.querySelector(REFRESH_SELECTORS.button[i]);
      if (usable(el) && (i < 2 || isRefreshLabel(el))) return el;
    }
    return [...root.querySelectorAll("button")].find((b) => usable(b) && isRefreshLabel(b)) || null;
  }

  // ---- авто-скролл: догрузить все страницы выдачи (DAT lazy-load при прокрутке вниз) ----
  // Контейнер не захардкожен (CDK-viewport DAT не зафиксирован) — авто-детект ближайшего
  // скроллируемого предка строк устойчивее к смене вёрстки. ToS: имитируем скролл юзера в его сессии.
  function isScrollable(el) {
    if (!el) return false;
    const sh = el.scrollHeight || 0, ch = el.clientHeight || 0;
    if (sh <= ch) return false;
    let oy = "";
    try { if (typeof getComputedStyle === "function") oy = getComputedStyle(el).overflowY || ""; } catch (_) { /* нет */ }
    if (!oy && el.style) oy = el.style.overflowY || "";
    return /(auto|scroll|overlay)/.test(oy);
  }
  // от первой строки результата вверх по предкам → первый скроллируемый; фолбэк — scrollingElement
  function findScrollContainer(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root) return null;
    const first = root.querySelector(DAT_SELECTORS.row);
    let el = first ? first.parentElement : null;
    while (el) { if (isScrollable(el)) return el; el = el.parentElement; }
    return (typeof document !== "undefined" && document.scrollingElement) || null;
  }
  // один шаг прокрутки вниз; возвращает метрики для детекта роста (новые страницы → растёт scrollHeight)
  function scrollStep(container) {
    if (!container) return { scrollTop: 0, scrollHeight: 0 };
    try { container.scrollTop = container.scrollHeight; } catch (_) { /* нет */ }
    return { scrollTop: container.scrollTop || 0, scrollHeight: container.scrollHeight || 0 };
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

    // ---- авто-скролл (для накопления всех страниц текущей выдачи) ----
    findScrollContainer() { return findScrollContainer(typeof document !== "undefined" ? document : null); },
    scrollStep(container) { return scrollStep(container); },

    // ---- авто-пилот ----
    // Кликнуть родную кнопку Search/Refresh DAT. true — кнопка нашлась и кликнута.
    clickRefresh() {
      const btn = findRefreshButton(typeof document !== "undefined" ? document : null);
      if (!btn) return false;
      btn.click();
      return true;
    },
    // Доступные опции сортировки DAT (если дропдаун отрендерен) -> [{key,label}].
    readSortOptions() { return readSortOptions(typeof document !== "undefined" ? document : null); },
    // Применить сортировку DAT по ключу через её родной mat-select. Promise<boolean>.
    applySort(key) {
      return new Promise((resolve) => {
        const root = typeof document !== "undefined" ? document : null;
        if (!key || !root) return resolve(false);
        const clickIfPresent = () => {
          const o = pickSortOption(root, key);
          if (o) { o.click(); return true; }
          return false;
        };
        if (clickIfPresent()) return resolve(true);       // дропдаун уже открыт/опции в DOM
        const trigger = root.querySelector(SORT_SELECTORS.trigger);
        if (!trigger) return resolve(false);
        trigger.click();                                  // открыть; Angular рендерит overlay на след. тике
        setTimeout(() => resolve(clickIfPresent()), 0);
      });
    },
  };

  LLADAPT.register(DAT_ADAPTER);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DAT_ADAPTER, DAT_SELECTORS, REFRESH_SELECTORS, SORT_SELECTORS,
      resultIdOf, domRowKey, sortKey, readSortOptions, pickSortOption, findRefreshButton,
      isScrollable, findScrollContainer, scrollStep,
    };
  }
})();
