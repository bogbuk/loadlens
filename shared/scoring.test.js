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

// ---------- Fraud Shield (FMCSA + перепосты) ----------
const SH = (authority, repost = null) => ({ mc: "1", authority, repost });
const A = (over = {}) => ({ status: "active", allowedToOperate: true, grantedAt: "2015-01-01", ageDays: 4000, incidents12m: 0, ...over });
const codes = (shield) => LLSCORE.redFlags({ brokerMc: "1", estimatedRatePerMile: 2.3, creditScore: 95 }, { laneMedian: 2.2, shield });
const pick = (b) => ({ level: b.level, text: b.text });

test("redFlags shield: активный старый брокер без перепостов → нет флагов", () => {
  assert.deepStrictEqual(codes(SH(A(), { count: 2, days: 2, windowDays: 14 })), []);
});

test("redFlags shield: статусы FMCSA → high", () => {
  const f1 = codes(SH(A({ status: "inactive" })));
  assert.ok(f1.some((x) => x.code === "authority_inactive" && x.sev === "high"));
  const f2 = codes(SH(A({ status: "carrier_only" })));
  assert.ok(f2.some((x) => x.code === "carrier_brokering" && x.sev === "high"));
  const f3 = codes(SH(A({ status: "not_found", ageDays: null })));
  assert.ok(f3.some((x) => x.code === "authority_not_found" && x.sev === "high"));
});

test("redFlags shield: status=null (нет ключа) — статусных флагов нет", () => {
  assert.deepStrictEqual(codes(SH(A({ status: null }))), []);
});

test("redFlags shield: молодая лицензия — med <180д, high <90д, null — без флага", () => {
  assert.ok(codes(SH(A({ ageDays: 120 }))).some((x) => x.code === "new_authority" && x.sev === "med" && /120 days/.test(x.label)));
  assert.ok(codes(SH(A({ ageDays: 45 }))).some((x) => x.code === "new_authority" && x.sev === "high"));
  assert.deepStrictEqual(codes(SH(A({ ageDays: null, grantedAt: null }))), []);
});

test("redFlags shield: инциденты за 12 мес → med", () => {
  const f = codes(SH(A({ incidents12m: 2 })));
  assert.ok(f.some((x) => x.code === "authority_incidents" && x.sev === "med" && /2 /.test(x.label)));
});

test("redFlags shield: перепосты — порог count>=4 и days>=3", () => {
  assert.ok(codes(SH(A(), { count: 6, days: 4, windowDays: 14 })).some((x) => x.code === "reposted" && x.label === "reposted 6× over 4 days"));
  assert.deepStrictEqual(codes(SH(A(), { count: 6, days: 2, windowDays: 14 })), []);
  assert.deepStrictEqual(codes(SH(A(), { count: 3, days: 3, windowDays: 14 })), []);
});

test("redFlags shield: authority=null (DOT лёг) и shield отсутствует — как раньше", () => {
  assert.deepStrictEqual(codes(SH(null)), []);
  assert.deepStrictEqual(codes(undefined), []);
});

test("shieldBadge: уровни и текст", () => {
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: 800 })))), { level: "good", text: "🛡 2y ✓" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: 45 })))), { level: "risk", text: "🛡 45d" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: 200 })))), { level: "warn", text: "🛡 6mo" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ status: "inactive" })))), { level: "risk", text: "🛡 ✗" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ status: null, ageDays: 4000 })))), { level: "good", text: "🛡 10y" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ incidents12m: 1 })))), { level: "warn", text: "🛡 10y" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: null, grantedAt: null })))), { level: "good", text: "🛡 ✓" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(null))), { level: "unknown", text: "🛡 ?" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(undefined)), { level: "unknown", text: "🛡 ?" });
  assert.ok(/FMCSA/.test(LLSCORE.shieldBadge(SH(A())).title));
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

// Короткие рейсы: $/mi на 30 милях бессмыслен (подача/погрузка/время не бесплатны), а при поиске
// по зонам DAT не отдаёт deadhead → знаменатель = одни trip-мили. Скорим не меньше чем по 100 милям.
test("trueRpm: короткий рейс скорится по полу 100 миль", () => {
  assert.strictEqual(LLSCORE.trueRpm(800, 30, null), 8);        // было 26.67
  assert.strictEqual(LLSCORE.trueRpm(800, 60, 20), 8);          // 80 < 100 → 100
  assert.strictEqual(LLSCORE.trueRpm(2500, 1000, 0), 2.5);      // длинные не трогаем
  assert.strictEqual(LLSCORE.trueRpm(800, 30, null, 0), 800 / 30); // пол отключаем явно
});
test("netRpm: топливо по реальным милям, делим на пол 100 миль", () => {
  const nr = LLSCORE.netRpm({ rate: 800, loadedMiles: 30, deadheadMiles: null }, { dieselPrice: 4.0, mpg: 6.5, tollsPerMile: 0.04 });
  // fuel = 30/6.5*4 = 18.46 ; tolls = 1.2 ; (800-19.66)/100 = 7.80
  assert.ok(Math.abs(nr - 7.8034) < 0.001, String(nr));
});
test("profitBadge: $500 за 30 миль без DH — amber ($5/mi), а не green ($16.7/mi)", () => {
  const b = LLSCORE.profitBadge({ rate: 500, loadedMiles: 30, deadheadMiles: null }, { dieselPrice: 3.95, costPerMile: 1.8, targetRpm: 7 });
  assert.strictEqual(b.level, "amber");
  assert.strictEqual(b.trueRpm, 5);
});
