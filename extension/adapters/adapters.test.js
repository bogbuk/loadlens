const test = require("node:test");
const assert = require("node:assert");

// Порядок require: сначала зависимости-глобалы, потом адаптеры (регистрируются по сайд-эффекту).
require("../../shared/load.model.js");
const LLADAPT = require("./adapters.js");
const { DAT_ADAPTER, resultIdOf } = require("./dat.adapter.js");
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
