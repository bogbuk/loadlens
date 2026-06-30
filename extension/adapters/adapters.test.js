const test = require("node:test");
const assert = require("node:assert");

// Порядок require: сначала зависимости-глобалы, потом адаптеры (регистрируются по сайд-эффекту).
require("../../shared/load.model.js");
const LLADAPT = require("./adapters.js");
const { DAT_ADAPTER, resultIdOf, domRowKey, sortKey, readSortOptions, pickSortOption, findRefreshButton, isScrollable, findScrollContainer, scrollStep } = require("./dat.adapter.js");
const { TRUCKSTOP_ADAPTER, TRUCKSTOP_SELECTORS } = require("./truckstop.adapter.js");

// Лёгкий DOM-шим для Truckstop parseRow (карта {selector: text}).
function fakeRow(map) {
  return {
    querySelector(sel) { return sel in map ? { textContent: map[sel], trim() { return map[sel]; } } : null; },
    getAttribute(attr) { return map["@" + attr] || null; },
  };
}

test("adapterFor резолвит DAT и Truckstop по host", () => {
  assert.strictEqual(LLADAPT.adapterFor("one.dat.com"), DAT_ADAPTER);
  assert.strictEqual(LLADAPT.adapterFor("members.truckstop.com"), TRUCKSTOP_ADAPTER);
  assert.strictEqual(LLADAPT.adapterFor("example.org"), null);
});

test("splitCityState разбирает 'Chicago, IL'", () => {
  assert.deepStrictEqual(LLADAPT.splitCityState("Chicago, IL"), { city: "Chicago", state: "IL" });
  assert.deepStrictEqual(LLADAPT.splitCityState("Fort Worth, TX"), { city: "Fort Worth", state: "TX" });
});

test("DAT resultIdOf достаёт resultId из id строки", () => {
  assert.strictEqual(resultIdOf({ id: "table-row-ZS1WtGvw" }), "ZS1WtGvw");
  assert.strictEqual(resultIdOf({ id: "something-else" }), null);
  assert.strictEqual(resultIdOf({ id: "" }), null);
});

test("DAT anchor матчит DOM-строки с грузами по resultId", () => {
  // стаб document.querySelectorAll: две строки, одна совпадает с грузом
  const rowA = { id: "table-row-AAA", querySelector: () => null };
  const rowB = { id: "table-row-BBB", querySelector: () => null };
  const saved = global.document;
  global.document = { querySelectorAll: () => [rowA, rowB] };
  try {
    const loads = [{ resultId: "BBB", originMarket: "CHICAGO_IL", destMarket: "DALLAS_TX" }];
    const pairs = DAT_ADAPTER.anchor(loads);
    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].row, rowB);
    assert.strictEqual(pairs[0].load.resultId, "BBB");
  } finally {
    global.document = saved;
  }
});

test("DAT domRowKey берёт сегмент после последнего '+' (композитный resultId)", () => {
  // новый формат DAT: resultId = <длинное>+<короткий-row-id>
  assert.strictEqual(domRowKey("L.c296v.1a85.0.H5Dk-f7GE+ZS1WtkGc"), "ZS1WtkGc");
  // старый формат без '+' — возвращаем как есть (обратная совместимость)
  assert.strictEqual(domRowKey("ZS1WtGvw"), "ZS1WtGvw");
  assert.strictEqual(domRowKey(null), "");
});

test("DAT anchor матчит композитный resultId по короткому хвосту row-id", () => {
  // DOM-id строки короткий, а load.resultId — композитный: матч должен сработать по хвосту
  const rowB = { id: "table-row-ZS1WtkGc", querySelector: () => null };
  const saved = global.document;
  global.document = { querySelectorAll: () => [rowB] };
  try {
    const loads = [{ resultId: "L.c296v.1a85.0.H5Dk-f7GE+ZS1WtkGc", originMarket: "CHICAGO_IL", destMarket: "DALLAS_TX" }];
    const pairs = DAT_ADAPTER.anchor(loads);
    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].row, rowB);
  } finally {
    global.document = saved;
  }
});

test("DAT collect() пуст — данные берутся из GraphQL-перехвата", () => {
  assert.deepStrictEqual(DAT_ADAPTER.collect(), []);
});

test("Truckstop parseRow → unified Load (reefer) с lane groupKey", () => {
  const S = TRUCKSTOP_SELECTORS;
  const row = fakeRow({
    [S.loadId]: "TS-88231",
    [S.origin]: "Dallas, TX", [S.dest]: "Memphis, TN",
    [S.equipment]: "Reefer", [S.rate]: "$1,900",
    [S.tripMiles]: "540", [S.dhMiles]: "40",
    [S.company]: "Lone Star Brokers", [S.contact]: "555-987-6543",
  });
  const load = TRUCKSTOP_ADAPTER.parseRow(row);
  assert.strictEqual(load.board, "truckstop");
  assert.strictEqual(load.originMarket, "DALLAS_TX");
  assert.strictEqual(load.destMarket, "MEMPHIS_TN");
  assert.strictEqual(load.equipment, "R");
  assert.strictEqual(load.groupKey, "truckstop|DALLAS_TX>MEMPHIS_TN|R");
});

test("sanitizeLoad режет PII (contact), оставляет brokerName/markets", () => {
  const LLAPI = require("../api.js");
  const load = TRUCKSTOP_ADAPTER.parseRow(fakeRow({
    [TRUCKSTOP_SELECTORS.origin]: "Dallas, TX", [TRUCKSTOP_SELECTORS.dest]: "Memphis, TN",
    [TRUCKSTOP_SELECTORS.equipment]: "Van", [TRUCKSTOP_SELECTORS.rate]: "$2,000",
    [TRUCKSTOP_SELECTORS.tripMiles]: "500", [TRUCKSTOP_SELECTORS.contact]: "555-111-2222",
    [TRUCKSTOP_SELECTORS.company]: "Lone Star Brokers",
  }));
  const clean = LLAPI.sanitizeLoad(load);
  assert.strictEqual(clean.contact, undefined);
  assert.strictEqual(clean.brokerName, "Lone Star Brokers");
  assert.strictEqual(clean.originMarket, "DALLAS_TX");
});

// ---- авто-пилот: DOM-хелперы сортировки/рефреша DAT (фейк-DOM, без jsdom) ----
function fakeOption(label) {
  const node = { textContent: label, _clicks: 0, click() { this._clicks++; } };
  node.querySelector = (sel) => (sel === ".mat-option-text" ? { textContent: label } : null);
  return node;
}
function fakeRoot({ options = [], buttons = [], match = {} } = {}) {
  return {
    querySelectorAll(sel) {
      if (sel === "mat-option") return options;
      if (sel === "button") return buttons;
      return [];
    },
    querySelector(sel) { return match[sel] || null; },
  };
}

test("sortKey нормализует метку DAT к ключу", () => {
  assert.strictEqual(sortKey("Rate - Highest"), "rate-highest");
  assert.strictEqual(sortKey("  Age — Newest!! "), "age-newest");
  assert.strictEqual(sortKey(null), "");
});

test("readSortOptions парсит mat-option-метки в {key,label}", () => {
  const root = fakeRoot({ options: [fakeOption("Rate - Highest"), fakeOption("Age - Newest")] });
  assert.deepStrictEqual(readSortOptions(root), [
    { key: "rate-highest", label: "Rate - Highest" },
    { key: "age-newest", label: "Age - Newest" },
  ]);
});

test("pickSortOption находит опцию по ключу (нечувств. к пунктуации/регистру)", () => {
  const hi = fakeOption("Rate - Highest"); const lo = fakeOption("Rate - Lowest");
  const root = fakeRoot({ options: [hi, lo] });
  assert.strictEqual(pickSortOption(root, "rate-highest"), hi);
  assert.strictEqual(pickSortOption(root, "Rate  Lowest"), lo);
  assert.strictEqual(pickSortOption(root, "trip-highest"), null);
  assert.strictEqual(pickSortOption(root, ""), null);
});

test("findRefreshButton: приоритет селектора, затем фолбэк по тексту", () => {
  const bySel = { textContent: "" };
  assert.strictEqual(findRefreshButton(fakeRoot({ match: { 'button.search-button': bySel } })), bySel);
  // фолбэк: нет по селектору, ищем кнопку с текстом Search/Refresh
  const search = { textContent: "Search" }; const other = { textContent: "Cancel" };
  assert.strictEqual(findRefreshButton(fakeRoot({ buttons: [other, search] })), search);
  assert.strictEqual(findRefreshButton(fakeRoot({ buttons: [other] })), null);
});

test("findRefreshButton пропускает disabled SEARCH (DAT гасит её без смены критериев)", () => {
  const sel = 'button[data-test="search-button"]';
  const disabled = { getAttribute: () => null, disabled: true, textContent: "Search" };
  // найдена по селектору, но disabled → пропуск; фолбэк тоже пропускает → null (триггерит reload в content.js)
  assert.strictEqual(findRefreshButton(fakeRoot({ match: { [sel]: disabled }, buttons: [disabled] })), null);
  // активная такая же кнопка — возвращается
  const enabled = { getAttribute: () => null, disabled: false, textContent: "Search" };
  assert.strictEqual(findRefreshButton(fakeRoot({ match: { [sel]: enabled } })), enabled);
});

test("DAT_ADAPTER.applySort кликает уже отрендеренную опцию (document-шим)", async () => {
  const hi = fakeOption("Rate - Highest");
  global.document = fakeRoot({ options: [hi] });
  const ok = await DAT_ADAPTER.applySort("rate-highest");
  delete global.document;
  assert.strictEqual(ok, true);
  assert.strictEqual(hi._clicks, 1);
});

test("DAT_ADAPTER.clickRefresh кликает кнопку Search (document-шим)", () => {
  const btn = { textContent: "Search", _clicks: 0, click() { this._clicks++; } };
  global.document = fakeRoot({ buttons: [btn] });
  const ok = DAT_ADAPTER.clickRefresh();
  delete global.document;
  assert.strictEqual(ok, true);
  assert.strictEqual(btn._clicks, 1);
});

test("isScrollable: предок со скроллом (overflow + scrollHeight>clientHeight)", () => {
  assert.strictEqual(isScrollable({ scrollHeight: 2000, clientHeight: 600, style: { overflowY: "auto" } }), true);
  assert.strictEqual(isScrollable({ scrollHeight: 2000, clientHeight: 600, style: { overflowY: "visible" } }), false); // не скроллится
  assert.strictEqual(isScrollable({ scrollHeight: 500, clientHeight: 600, style: { overflowY: "scroll" } }), false);  // нет переполнения
  assert.strictEqual(isScrollable(null), false);
});

test("findScrollContainer: ближайший скроллируемый предок строки результата", () => {
  const scroller = { scrollHeight: 3000, clientHeight: 600, style: { overflowY: "auto" }, parentElement: null };
  const mid = { scrollHeight: 600, clientHeight: 600, style: {}, parentElement: scroller };       // не скроллится → пропуск
  const row = { parentElement: mid };
  const root = { querySelector: (sel) => (sel.includes("row-container") ? row : null) };
  assert.strictEqual(findScrollContainer(root), scroller);
  // нет строк → фолбэк null (в браузере был бы document.scrollingElement)
  assert.strictEqual(findScrollContainer({ querySelector: () => null }), null);
});

test("scrollStep ставит scrollTop в конец и возвращает метрики", () => {
  const c = { scrollTop: 0, scrollHeight: 4200, clientHeight: 600 };
  const m = scrollStep(c);
  assert.strictEqual(c.scrollTop, 4200);
  assert.deepStrictEqual(m, { scrollTop: 4200, scrollHeight: 4200 });
  assert.deepStrictEqual(scrollStep(null), { scrollTop: 0, scrollHeight: 0 });
});
