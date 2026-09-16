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

// ---- свежесть постинга (ageMinutes / formatAge) ----

test("ageMinutes: servicedWhen (ISO) → минуты с момента обновления поста", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  assert.strictEqual(LLMODEL.ageMinutes({ servicedWhen: "2026-09-16T11:45:00Z" }, now), 15);
  assert.strictEqual(LLMODEL.ageMinutes({ servicedWhen: "2026-09-16T12:00:00Z" }, now), 0);
});

test("ageMinutes: часы сервера впереди локальных — не отрицательный возраст", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  assert.strictEqual(LLMODEL.ageMinutes({ servicedWhen: "2026-09-16T12:03:00Z" }, now), 0);
});

test("ageMinutes: фолбэк на postedAge из DOM-адаптера (уже минуты)", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  assert.strictEqual(LLMODEL.ageMinutes({ postedAge: 42 }, now), 42);
  // servicedWhen точнее — он и выигрывает
  assert.strictEqual(LLMODEL.ageMinutes({ servicedWhen: "2026-09-16T11:00:00Z", postedAge: 42 }, now), 60);
});

test("ageMinutes: возраст неизвестен → null (мусор, пусто, нет полей)", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  assert.strictEqual(LLMODEL.ageMinutes({}, now), null);
  assert.strictEqual(LLMODEL.ageMinutes({ servicedWhen: "not-a-date" }, now), null);
  assert.strictEqual(LLMODEL.ageMinutes(null, now), null);
});

test("formatAge: компактная подпись для чипа", () => {
  assert.strictEqual(LLMODEL.formatAge(0), "now");
  assert.strictEqual(LLMODEL.formatAge(7), "7m");
  assert.strictEqual(LLMODEL.formatAge(59), "59m");
  assert.strictEqual(LLMODEL.formatAge(60), "1h");
  assert.strictEqual(LLMODEL.formatAge(150), "2h");    // округление вниз: «не моложе, чем сказано»
  assert.strictEqual(LLMODEL.formatAge(1440), "1d");
  assert.strictEqual(LLMODEL.formatAge(null), "");
});

test("byFreshness: свежие вперёд, грузы без возраста — в хвост, порядок стабилен", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");
  const loads = [
    { loadId: "old", postedAge: 300 },
    { loadId: "unknown-a" },
    { loadId: "fresh", postedAge: 5 },
    { loadId: "unknown-b" },
    { loadId: "mid", servicedWhen: "2026-09-16T11:00:00Z" },
  ];
  const ids = LLMODEL.byFreshness(loads, now).map((l) => l.loadId);
  assert.deepStrictEqual(ids, ["fresh", "mid", "old", "unknown-a", "unknown-b"]);
  assert.strictEqual(loads[0].loadId, "old", "исходный массив не мутируется");
});
