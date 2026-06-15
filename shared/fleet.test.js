const test = require("node:test");
const assert = require("node:assert");
require("./scoring.js");   // LLSCORE
require("./planner.js");   // LLPLAN
const LLFLEET = require("./fleet.js");

const HOS = { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 4200 };
const load = { originMarket: "CHICAGO_IL", destMarket: "ATLANTA_GA", equipment: "F",
               rate: 2000, loadedMiles: 700, deadheadMiles: 30 };
const dist = () => 0; // водитель уже на рынке отправления

const drv = (o) => ({ id: o.id, name: o.name, currentMarket: o.market ?? "CHICAGO_IL",
  equipment: o.eq ?? "F", costPerMile: o.cpm ?? null, status: o.status ?? "available",
  hos: o.hos ?? HOS });

test("матч: прицеп совпал и HOS ок → feasible, лучший", () => {
  const r = LLFLEET.matchLoadToFleet(load, [drv({ id: "d1", name: "Ivan" })],
    { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.feasibleCount, 1);
  assert.strictEqual(r.best.driverId, "d1");
  assert.strictEqual(r.matches[0].feasible, true);
});

test("прицеп не совпал → не feasible", () => {
  const r = LLFLEET.matchLoadToFleet(load, [drv({ id: "d1", name: "Ivan", eq: "V" })],
    { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.feasibleCount, 0);
  assert.strictEqual(r.best, null);
  assert.strictEqual(r.matches[0].equipMatch, false);
});

test("equipment не задан у водителя → не исключаем (match-any)", () => {
  const r = LLFLEET.matchLoadToFleet(load, [drv({ id: "d1", name: "Ivan", eq: null })],
    { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.matches[0].equipMatch, true);
});

test("исчерпанный цикл → HOS не feasible (red)", () => {
  const r = LLFLEET.matchLoadToFleet(load, [drv({ id: "d1", name: "Ivan",
    hos: { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 60 } })],
    { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.feasibleCount, 0);
  assert.strictEqual(r.matches[0].hosBadge, "red");
});

test("status 'off' исключается из парка", () => {
  const r = LLFLEET.matchLoadToFleet(load, [drv({ id: "d1", name: "Off", status: "off" })],
    { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.best, null);
});

test("ранжирование: ближний водитель выше дальнего (меньше deadhead → выше netRpm)", () => {
  const drivers = [
    drv({ id: "far", name: "Far", market: "DALLAS_TX" }),
    drv({ id: "near", name: "Near", market: "CHICAGO_IL" }),
  ];
  const distByMarket = (a) => (a === "DALLAS_TX" ? 600 : 0);
  const r = LLFLEET.matchLoadToFleet(load, drivers, { distance: distByMarket, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.best.driverId, "near");
});

test("per-driver costPerMile переопределяет общий", () => {
  const r = LLFLEET.matchLoadToFleet(load, [drv({ id: "d1", name: "Ivan", cpm: 1.2 })],
    { distance: dist, dieselPrice: 4, costPerMile: 2.5 });
  // netRpm не зависит от costPerMile (это break-even), но cpm водителя должен попасть в match для UI
  assert.strictEqual(r.matches[0].costPerMile, 1.2);
});

test("пустой парк → best null, total 0", () => {
  const r = LLFLEET.matchLoadToFleet(load, [], { distance: dist });
  assert.deepStrictEqual(r, { matches: [], best: null, feasibleCount: 0, total: 0 });
});
