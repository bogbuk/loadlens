const test = require("node:test");
const assert = require("node:assert");
const LLACC = require("./loads-accumulator.js");

const L = (id, rate) => ({ loadId: id, rate: rate == null ? 100 : rate });

test("первый ответ: грузы попадают в накопитель, searchId фиксируется", () => {
  const r = LLACC.accumulate(LLACC.emptyState(), [L("a"), L("b")], "S1");
  assert.strictEqual(r.state.searchId, "S1");
  assert.deepStrictEqual(r.loads.map((l) => l.loadId), ["a", "b"]);
});

test("тот же searchId → доливаем (merge по loadId, дедуп, last-write-wins)", () => {
  let r = LLACC.accumulate(LLACC.emptyState(), [L("a", 100), L("b", 100)], "S1");
  r = LLACC.accumulate(r.state, [L("b", 222), L("c", 100)], "S1"); // b обновился, c новый
  assert.deepStrictEqual(r.loads.map((l) => l.loadId).sort(), ["a", "b", "c"]);
  assert.strictEqual(r.loads.find((l) => l.loadId === "b").rate, 222); // свежее значение победило
});

test("новый searchId → накопитель сбрасывается", () => {
  let r = LLACC.accumulate(LLACC.emptyState(), [L("a"), L("b")], "S1");
  r = LLACC.accumulate(r.state, [L("x")], "S2");
  assert.strictEqual(r.state.searchId, "S2");
  assert.deepStrictEqual(r.loads.map((l) => l.loadId), ["x"]);
});

test("sid=null → режим перезаписи (прежнее поведение, без накопления)", () => {
  let r = LLACC.accumulate(LLACC.emptyState(), [L("a"), L("b")], null);
  assert.strictEqual(r.state.searchId, null);
  assert.deepStrictEqual(r.loads.map((l) => l.loadId), ["a", "b"]);
  r = LLACC.accumulate(r.state, [L("c")], null); // следующий null-ответ заменяет, не доливает
  assert.deepStrictEqual(r.loads.map((l) => l.loadId), ["c"]);
});

test("грузы без loadId игнорируются (не падаем)", () => {
  const r = LLACC.accumulate(LLACC.emptyState(), [{ rate: 1 }, L("a")], "S1");
  assert.deepStrictEqual(r.loads.map((l) => l.loadId), ["a"]);
});
