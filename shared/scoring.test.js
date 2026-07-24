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

test("targetForMiles: бакеты по trip-милям (границы включительно, overflow)", () => {
  const t = [{ maxMi: 500, rpm: 7 }, { maxMi: 1000, rpm: 6 }, { maxMi: null, rpm: 5 }];
  assert.strictEqual(LLSCORE.targetForMiles(300, t), 7);
  assert.strictEqual(LLSCORE.targetForMiles(500, t), 7);   // граница включительно
  assert.strictEqual(LLSCORE.targetForMiles(501, t), 6);
  assert.strictEqual(LLSCORE.targetForMiles(1000, t), 6);  // граница включительно
  assert.strictEqual(LLSCORE.targetForMiles(1500, t), 5);  // overflow
  assert.strictEqual(LLSCORE.targetForMiles(0, t), null);  // нет дистанции
  assert.strictEqual(LLSCORE.targetForMiles(null, t), null);
});

test("targetForMiles: дефолтная таблица DEFAULTS.targets когда table не передан", () => {
  assert.strictEqual(LLSCORE.targetForMiles(400), 7);
  assert.strictEqual(LLSCORE.targetForMiles(800), 6);
  assert.strictEqual(LLSCORE.targetForMiles(2000), 5);
});

test("profitBadge: green когда trueRpm >= targetRpm бакета", () => {
  // 3500/500 = 7.0 trueRpm == target 7 → green; net высоко, не red
  const load = { rate: 3500, loadedMiles: 500, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, targetRpm: 7, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "green");
});

test("profitBadge: amber когда в плюс, но trueRpm ниже целевой", () => {
  // 2500/500 = 5.0 trueRpm < target 7; net > break-even → amber
  const load = { rate: 2500, loadedMiles: 500, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, targetRpm: 7, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "amber");
});

test("profitBadge: red по costPerMile даже при заданной цели", () => {
  // 700/500 = 1.4 trueRpm; net < 1.8 → red несмотря на target
  const load = { rate: 700, loadedMiles: 500, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, targetRpm: 7, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "red");
});

test("profitBadge: target имеет приоритет над laneMedian для green", () => {
  // trueRpm 5.0 >= target 5, но < laneMedian 6 → раньше был бы amber, теперь green
  const load = { rate: 6000, loadedMiles: 1200, deadheadMiles: 0 };
  const b = LLSCORE.profitBadge(load, { costPerMile: 1.8, targetRpm: 5, laneMedian: 6, dieselPrice: 4.0 });
  assert.strictEqual(b.level, "green");
});

test("brokerBadge: good при высоком credit и быстрой оплате", () => {
  assert.strictEqual(LLSCORE.brokerBadge({ creditScore: 97, daysToPay: 19 }).level, "good");
});

test("brokerBadge: ok при среднем credit / умеренной оплате", () => {
  assert.strictEqual(LLSCORE.brokerBadge({ creditScore: 82, daysToPay: 28 }).level, "ok");
  assert.strictEqual(LLSCORE.brokerBadge({ creditScore: 95, daysToPay: 35 }).level, "ok");
});

test("brokerBadge: risk при низком credit или медленной оплате", () => {
  assert.strictEqual(LLSCORE.brokerBadge({ creditScore: 70, daysToPay: 25 }).level, "risk");
  assert.strictEqual(LLSCORE.brokerBadge({ creditScore: 92, daysToPay: 45 }).level, "risk");
});

test("brokerBadge: unknown когда нет данных брокера", () => {
  assert.strictEqual(LLSCORE.brokerBadge({}).level, "unknown");
});

test("redFlags: ставка сильно выше рынка → med", () => {
  const f = LLSCORE.redFlags({ brokerMc: "MC1", estimatedRatePerMile: 3.6, creditScore: 95 }, { laneMedian: 2.2 });
  assert.ok(f.some((x) => x.code === "rate_above_market" && x.sev === "med"));
});

test("redFlags: приманка (высокая ставка + низкий credit) → high", () => {
  const f = LLSCORE.redFlags({ brokerMc: "MC1", estimatedRatePerMile: 3.8, creditScore: 60 }, { laneMedian: 2.2 });
  assert.ok(f.some((x) => x.code === "bait_combo" && x.sev === "high"));
  assert.strictEqual(LLSCORE.redFlagLevel(f), "high");
});

test("redFlags: нет MC → med", () => {
  const f = LLSCORE.redFlags({ brokerMc: null, creditScore: 95 }, {});
  assert.ok(f.some((x) => x.code === "no_mc"));
});

test("redFlags: crowd-репутация bad → high", () => {
  const f = LLSCORE.redFlags({ brokerMc: "MC1" }, { reputation: { level: "bad", doubleBrokered: 2 } });
  assert.ok(f.some((x) => x.code === "crowd_bad" && x.sev === "high"));
});

test("redFlags: чистый груз → нет флагов", () => {
  const f = LLSCORE.redFlags({ brokerMc: "MC1", estimatedRatePerMile: 2.3, creditScore: 95 }, { laneMedian: 2.2 });
  assert.strictEqual(f.length, 0);
  assert.strictEqual(LLSCORE.redFlagLevel(f), "none");
});

// ---------- counterOffer (контр-оффер: сумма запроса + строка-скрипт) ----------

test("counterOffer: без медианы просит минимум на 10% выше постинга, округляя до $25", () => {
  const load = { rate: 1850, loadedMiles: 700, deadheadMiles: 150 };
  const c = LLSCORE.counterOffer(load, { costPerMile: 1.8 });
  // total=850; minAsk=2035; breakeven*1.15=1759.5 → raw=2035 → ceil25=2050
  assert.strictEqual(c.ask, 2050);
  assert.ok(c.ask % 25 === 0);
  assert.match(c.script, /Offered \$1,850/);
  assert.match(c.script, /I can do \$2,050/);
  assert.match(c.script, /\+150mi deadhead/);
  assert.ok(!/market/.test(c.script), "без медианы в скрипте не должно быть рынка");
});

test("counterOffer: медиана рынка поднимает запрос и попадает в скрипт", () => {
  const load = { rate: 1850, loadedMiles: 700, deadheadMiles: 150 };
  const c = LLSCORE.counterOffer(load, { costPerMile: 1.8, laneMedian: 2.45 });
  // marketRate = 2.45*850 = 2082.5 > minAsk 2035 → raw=2082.5 → ceil25=2100
  assert.strictEqual(c.ask, 2100);
  assert.match(c.script, /market ≈ \$2\.45\/mi/);
});

test("counterOffer: потолок market*1.15 не даёт просить абсурд при высоком break-even", () => {
  const load = { rate: 1850, loadedMiles: 700, deadheadMiles: 150 };
  const c = LLSCORE.counterOffer(load, { costPerMile: 3.0, laneMedian: 2.45 });
  // breakeven*1.15 = 2932.5, но cap = market*1.15 = 2394.875 → ceil25 = 2400
  assert.strictEqual(c.ask, 2400);
});

test("counterOffer: запрос всегда выше постированной ставки, даже если она много выше рынка", () => {
  const load = { rate: 5000, loadedMiles: 700, deadheadMiles: 150 };
  const c = LLSCORE.counterOffer(load, { costPerMile: 1.8, laneMedian: 2.45 });
  assert.ok(c.ask > 5000, `ask=${c.ask} должен быть выше ставки 5000`);
  assert.strictEqual(c.ask, 5500);
});

test("counterOffer: без ставки или без миль — null, письмо уйдёт без цены", () => {
  assert.deepStrictEqual(LLSCORE.counterOffer({ rate: null, loadedMiles: 700 }, { costPerMile: 1.8 }),
    { ask: null, script: null });
  assert.deepStrictEqual(LLSCORE.counterOffer({ rate: 1850, loadedMiles: 0, deadheadMiles: 0 }, { costPerMile: 1.8 }),
    { ask: null, script: null });
});

test("counterOffer: без deadhead в скрипте нет хвоста про deadhead", () => {
  const c = LLSCORE.counterOffer({ rate: 1850, loadedMiles: 850, deadheadMiles: 0 }, { costPerMile: 1.8 });
  assert.ok(!/deadhead/.test(c.script));
});
