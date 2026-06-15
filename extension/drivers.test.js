const test = require("node:test");
const assert = require("node:assert");
const LLDRV = require("./drivers.js");

const DRIVER = {
  id: "d1", name: "Bob", currentMarket: "CHICAGO_IL", equipment: "R",
  costPerMile: 1.5, hos: { remainingDrive: 300, remainingOnDuty: 480, remainingCycle: 2400 },
};

test("resolveDriverContext: активный водитель питает все поля", () => {
  const ctx = LLDRV.resolveDriverContext(DRIVER, { market: "X", costPerMile: 1.8 });
  assert.strictEqual(ctx.market, "CHICAGO_IL");
  assert.strictEqual(ctx.equipment, "R");
  assert.strictEqual(ctx.costPerMile, 1.5);
  assert.deepStrictEqual(ctx.hos, DRIVER.hos);
});

test("resolveDriverContext: нет водителя → аноним-фолбэк", () => {
  const ctx = LLDRV.resolveDriverContext(null, { market: "PERU_IL", hos: { remainingDrive: 1, remainingOnDuty: 2, remainingCycle: 3 }, costPerMile: 2.1 });
  assert.strictEqual(ctx.market, "PERU_IL");
  assert.strictEqual(ctx.equipment, null);          // аноним без фильтра прицепа
  assert.strictEqual(ctx.costPerMile, 2.1);
  assert.deepStrictEqual(ctx.hos, { remainingDrive: 1, remainingOnDuty: 2, remainingCycle: 3 });
});

test("resolveDriverContext: пустой market/equipment у водителя → фолбэк market, equipment null", () => {
  const ctx = LLDRV.resolveDriverContext({ id: "d2", name: "Sue", hos: LLDRV.FRESH }, { market: "PERU_IL", costPerMile: 1.8 });
  assert.strictEqual(ctx.market, "PERU_IL");         // фолбэк на авто-рынок выдачи
  assert.strictEqual(ctx.equipment, null);
  assert.strictEqual(ctx.costPerMile, 1.8);  // costPerMile берётся из fallback, когда у водителя поля нет
});

test("pickActive: находит по id, иначе первый, иначе null", () => {
  const list = [{ id: "a" }, { id: "b" }];
  assert.strictEqual(LLDRV.pickActive(list, "b").id, "b");
  assert.strictEqual(LLDRV.pickActive(list, "ZZZ").id, "a"); // сохранённый id удалён → первый
  assert.strictEqual(LLDRV.pickActive([], "a"), null);
  assert.strictEqual(LLDRV.pickActive(null, "a"), null);
});
