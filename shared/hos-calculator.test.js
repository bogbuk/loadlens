const test = require("node:test");
const assert = require("node:assert");
const { HOSCalculator } = require("./hos-calculator.js");

// Логбук из последовательности [код статуса, минуты]: 1=OFF, 2=SB, 3=D, 4=ON. Сейчас — конец последнего события.
const T0 = Date.UTC(2026, 8, 1);
function book(seq) {
  let t = T0;
  const logs = seq.map(([eventCode, min]) => { const l = { eventType: 1, eventCode, timestamp: t }; t += min * 60000; return l; });
  return { logs, now: t };
}
const shift = (seq) => { const { logs, now } = book(seq); return new HOSCalculator().calculate(logs, now).shift; };

test("split 8/2: короткий период off duty засчитывается, окно 14h без второго периода, счёт от конца первого", () => {
  const s = shift([[1, 600], [4, 30], [3, 300], [2, 480], [3, 120], [1, 120], [3, 60]]);
  assert.strictEqual(s.sleeperBerthUsed, true);
  assert.strictEqual(s.drivingTime, 180);
  assert.strictEqual(s.elapsedTime, 180);
  assert.strictEqual(s.remainingDriveTime, 480);
  assert.strictEqual(s.remainingOnDutyTime, 660);
});

test("split 3/7: сначала короткий off duty, потом 7h sleeper", () => {
  const s = shift([[1, 600], [3, 300], [1, 180], [3, 240], [2, 420], [3, 60]]);
  assert.strictEqual(s.sleeperBerthUsed, true);
  assert.strictEqual(s.drivingTime, 300);
  assert.strictEqual(s.elapsedTime, 300);
});

test("split: короткий период может складываться из off duty и sleeper подряд", () => {
  const s = shift([[1, 600], [3, 300], [2, 480], [3, 120], [1, 60], [2, 60], [3, 30]]);
  assert.strictEqual(s.sleeperBerthUsed, true);
  assert.strictEqual(s.drivingTime, 150);
  assert.strictEqual(s.elapsedTime, 150);
});

test("split 7/3 оба в sleeper — как раньше", () => {
  const s = shift([[1, 600], [3, 300], [2, 420], [3, 120], [2, 180], [3, 60]]);
  assert.strictEqual(s.sleeperBerthUsed, true);
  assert.strictEqual(s.drivingTime, 180);
  assert.strictEqual(s.elapsedTime, 180);
});

test("не split: 7h off duty без sleeper; сумма меньше 10h", () => {
  const off = shift([[1, 600], [3, 300], [1, 420], [3, 120], [1, 180], [3, 60]]);
  assert.strictEqual(off.sleeperBerthUsed, false);
  assert.strictEqual(off.drivingTime, 480);
  const short = shift([[1, 600], [3, 300], [2, 420], [3, 120], [1, 120], [3, 60]]);
  assert.strictEqual(short.sleeperBerthUsed, false);
  assert.strictEqual(short.drivingTime, 480);
});

test("без split: окно считается от конца 10h reset, как раньше", () => {
  const s = shift([[1, 600], [4, 60], [3, 300], [1, 30], [3, 60]]);
  assert.strictEqual(s.sleeperBerthUsed, false);
  assert.strictEqual(s.drivingTime, 360);
  assert.strictEqual(s.elapsedTime, 450);
});
