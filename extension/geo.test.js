const test = require("node:test");
const assert = require("node:assert");
globalThis.LLSEED = require("./vendor/markets.seed.js");
const LLGEO = require("./geo.js");

test("nearby: сам рынок первым + близкий сосед, дальний отсечён", () => {
  const n = LLGEO.nearby("DALLAS_TX", 75);
  assert.strictEqual(n[0].market, "DALLAS_TX");
  assert.strictEqual(n[0].miles, 0);
  assert.ok(n.some((x) => x.market === "FORT_WORTH_TX"));
  assert.ok(!n.some((x) => x.market === "HOUSTON_TX"));
});

test("nearby: неизвестный рынок → только он сам", () => {
  assert.deepStrictEqual(LLGEO.nearby("NOWHERE_XX", 75), [{ market: "NOWHERE_XX", miles: 0 }]);
});
