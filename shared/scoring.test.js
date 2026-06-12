const test = require("node:test");
const assert = require("node:assert");
const LLSCORE = require("./scoring.js");

test("trueRpm учитывает deadhead в знаменателе", () => {
  assert.strictEqual(LLSCORE.trueRpm(2500, 1000, 0), 2.5);
  assert.ok(Math.abs(LLSCORE.trueRpm(2500, 1000, 150) - 2.173) < 0.01);
  assert.strictEqual(LLSCORE.trueRpm(null, 1000, 0), null);
  assert.strictEqual(LLSCORE.trueRpm(2000, 0, 0), null);
});

test("netRpm вычитает топливо и tolls", () => {
  const load = { rate: 2000, loadedMiles: 1000, deadheadMiles: 0 };
  const nr = LLSCORE.netRpm(load, { dieselPrice: 4.0, mpg: 6.5, tollsPerMile: 0.04 });
  // fuel = 1000/6.5*4 = 615.4 ; tolls = 40 ; net = (2000-655.4)/1000 = 1.345
  assert.ok(nr < 2.0 && nr > 1.2);
});

test("profitBadge: red когда netRpm ниже break-even", () => {
  const load = { rate: 1400, loadedMiles: 1000, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "red");
});

test("profitBadge: green когда netRpm >= laneMedian и >= 1.25*breakeven", () => {
  const load = { rate: 3000, loadedMiles: 1000, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, laneMedian: 2.2, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "green");
});

test("profitBadge: amber когда в плюс, но ниже рынка", () => {
  // net = (2700 - 655) / 1000 = 2.045 → выше break-even 1.8, ниже рынка 2.5 и ниже 1.25*1.8=2.25
  const load = { rate: 2700, loadedMiles: 1000, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, laneMedian: 2.5, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "amber");
});

test("profitBadge: unknown когда нет ставки/миль", () => {
  const b = LLSCORE.profitBadge({ rate: null, loadedMiles: 0, deadheadMiles: 0 }, {});
  assert.strictEqual(b.level, "unknown");
});
