const test = require("node:test");
const assert = require("node:assert");

// Порядок require важен: сначала зависимости-глобалы, потом адаптеры (они регистрируются по сайд-эффекту).
require("../../shared/load.model.js");
const LLADAPT = require("./adapters.js");
const { DAT_ADAPTER, DAT_SELECTORS } = require("./dat.adapter.js");
const { TRUCKSTOP_ADAPTER, TRUCKSTOP_SELECTORS } = require("./truckstop.adapter.js");

// Лёгкий DOM-шим: querySelector(sel) ищет по карте {selector: text}, getAttribute(attr) по {'@attr': val}.
// Проверяет маппинг полей parseRow без зависимости от реального CSS-движка (селекторы — заглушки).
function fakeRow(map) {
  return {
    querySelector(sel) {
      return sel in map ? { textContent: map[sel], trim() { return map[sel]; } } : null;
    },
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

test("DAT parseRow → unified Load с lane groupKey и RPM-полями", () => {
  const S = DAT_SELECTORS;
  const row = fakeRow({
    [S.loadId]: "DAT-100542",
    [S.origin]: "Chicago, IL", [S.dest]: "Atlanta, GA",
    [S.equipment]: "Van", [S.rate]: "$2,150",
    [S.tripMiles]: "717", [S.dhMiles]: "25",
    [S.weight]: "42,000", [S.age]: "15m",
    [S.company]: "Acme Logistics", [S.contact]: "(555) 123-4567",
  });
  const load = DAT_ADAPTER.parseRow(row);
  assert.strictEqual(load.board, "dat");
  assert.strictEqual(load.originMarket, "CHICAGO_IL");
  assert.strictEqual(load.destMarket, "ATLANTA_GA");
  assert.strictEqual(load.equipment, "V");
  assert.strictEqual(load.rate, 2150);
  assert.strictEqual(load.loadedMiles, 717);
  assert.strictEqual(load.deadheadMiles, 25);
  assert.strictEqual(load.groupKey, "dat|CHICAGO_IL>ATLANTA_GA|V");
  assert.strictEqual(load.contact, "(555) 123-4567"); // в объекте есть, но sanitizeLoad его не пошлёт
});

test("Truckstop parseRow → unified Load (reefer)", () => {
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

test("sanitizeLoad режет PII (contact) и оставляет whitelist", () => {
  // повторно используем api.js sanitize: contact не входит в SAFE_FIELDS
  const LLAPI = require("../api.js");
  const load = DAT_ADAPTER.parseRow(fakeRow({
    [DAT_SELECTORS.origin]: "Chicago, IL", [DAT_SELECTORS.dest]: "Atlanta, GA",
    [DAT_SELECTORS.equipment]: "Van", [DAT_SELECTORS.rate]: "$2,000",
    [DAT_SELECTORS.tripMiles]: "700", [DAT_SELECTORS.contact]: "(555) 123-4567",
    [DAT_SELECTORS.company]: "Acme Logistics",
  }));
  const clean = LLAPI.sanitizeLoad(load);
  assert.strictEqual(clean.contact, undefined);
  assert.strictEqual(clean.brokerName, "Acme Logistics");
  assert.strictEqual(clean.originMarket, "CHICAGO_IL");
});

test("sanitizeLoad обнуляет brokerName, если он похож на телефон/контакт", () => {
  const LLAPI = require("../api.js");
  const load = DAT_ADAPTER.parseRow(fakeRow({
    [DAT_SELECTORS.origin]: "Chicago, IL", [DAT_SELECTORS.dest]: "Atlanta, GA",
    [DAT_SELECTORS.equipment]: "Van", [DAT_SELECTORS.rate]: "$2,000",
    [DAT_SELECTORS.tripMiles]: "700", [DAT_SELECTORS.company]: "call 555-123-4567",
  }));
  const clean = LLAPI.sanitizeLoad(load);
  assert.strictEqual(clean.brokerName, undefined);
});
