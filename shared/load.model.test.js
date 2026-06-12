const test = require("node:test");
const assert = require("node:assert");
const LLMODEL = require("./load.model.js");

test("parseRate: $-формат, запятые, Call→null", () => {
  assert.strictEqual(LLMODEL.parseRate("$2,150"), 2150);
  assert.strictEqual(LLMODEL.parseRate("2150.00"), 2150);
  assert.strictEqual(LLMODEL.parseRate("Call for rate"), null);
  assert.strictEqual(LLMODEL.parseRate(""), null);
});

test("parseAge: m/h/d → минуты", () => {
  assert.strictEqual(LLMODEL.parseAge("15m"), 15);
  assert.strictEqual(LLMODEL.parseAge("2h"), 120);
  assert.strictEqual(LLMODEL.parseAge("1d"), 1440);
  assert.strictEqual(LLMODEL.parseAge("Now"), 0);
});

test("normEquipment: длинные имена → коды", () => {
  assert.strictEqual(LLMODEL.normEquipment("Van"), "V");
  assert.strictEqual(LLMODEL.normEquipment("reefer"), "R");
  assert.strictEqual(LLMODEL.normEquipment("Flatbed"), "F");
});

test("marketKey: город+штат → нормализованный ключ", () => {
  assert.strictEqual(LLMODEL.marketKey("Chicago", "IL"), "CHICAGO_IL");
  assert.strictEqual(LLMODEL.marketKey("Fort Worth", "TX"), "FORT_WORTH_TX");
  assert.strictEqual(LLMODEL.marketKey("Saint-Louis", "mo"), "SAINT_LOUIS_MO");
});

test("buildLoad: собирает unified Load с lane groupKey", () => {
  const load = LLMODEL.buildLoad({
    loadId: "ABC", originCity: "Chicago", originState: "IL",
    destCity: "Atlanta", destState: "GA", equipment: "Van",
    rate: "$2,000", loadedMiles: "717", deadheadMiles: "25",
    contact: "555-123-4567",
  }, "dat");
  assert.strictEqual(load.originMarket, "CHICAGO_IL");
  assert.strictEqual(load.destMarket, "ATLANTA_GA");
  assert.strictEqual(load.equipment, "V");
  assert.strictEqual(load.rate, 2000);
  assert.strictEqual(load.groupKey, "dat|CHICAGO_IL>ATLANTA_GA|V");
  assert.strictEqual(load.contact, "555-123-4567"); // PII хранится в объекте, но не уйдёт на сервер
});

test("buildLoad: null при отсутствии гео", () => {
  assert.strictEqual(LLMODEL.buildLoad({ rate: "100" }, "dat"), null);
});
