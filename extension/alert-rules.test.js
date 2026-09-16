const test = require("node:test");
const assert = require("node:assert");

globalThis.LLEQUIP = require("./equip-filter.js");
const LLRULES = require("./alert-rules.js");

test("normKeyword: lower-case, без дефисов/пробелов/точек", () => {
  assert.strictEqual(LLRULES.normKeyword("In-Bond"), "inbond");
  assert.strictEqual(LLRULES.normKeyword(" IN BOND "), "inbond");
  assert.strictEqual(LLRULES.normKeyword("T.S.A."), "tsa");
  assert.strictEqual(LLRULES.normKeyword(null), "");
});

test("normalize: мусорный storage → пустой список", () => {
  for (const raw of [undefined, null, "x", 5, [], {}, { rules: "no" }, { rules: [null, 1, {}] }]) {
    assert.deepStrictEqual(LLRULES.normalize(raw), { version: 1, rules: [] });
  }
});

test("normalize: правило приводится к канону, дефолты подставляются", () => {
  const cfg = LLRULES.normalize({ rules: [{ id: "r_1", name: "  Bonded ", keywordsAny: ["bonded", "", "TWIC", "bonded"] }] });
  assert.deepStrictEqual(cfg.rules[0], {
    id: "r_1", name: "Bonded", enabled: true,
    keywordsAny: ["bonded", "TWIC"], keywordsNone: [],
    minRate: null, minRpm: null, maxDeadhead: null, minMiles: null, maxMiles: null, maxAgeMinutes: null,
    equipment: null, destStates: [], brokersAllow: [], brokersBlock: [], minCredit: null, score: "any",
  });
});

test("normalize: числа, штаты, MC, equipment, score", () => {
  const r = LLRULES.normalize({ rules: [{
    id: "r_2", name: "", enabled: false, minRate: "2500", minRpm: -1, maxDeadhead: "abc",
    destStates: ["tx", "Ok", "xyz", ""], brokersAllow: ["MC-123456", "12 34"], brokersBlock: [],
    equipment: ["V", ""], minCredit: 90, score: "weird",
  }] }).rules[0];
  assert.strictEqual(r.name, "Rule");
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(r.minRate, 2500);
  assert.strictEqual(r.minRpm, null);
  assert.strictEqual(r.maxDeadhead, null);
  assert.deepStrictEqual(r.destStates, ["TX", "OK"]);
  assert.deepStrictEqual(r.brokersAllow, ["123456", "1234"]);
  assert.deepStrictEqual(r.equipment, ["V"]);
  assert.strictEqual(r.minCredit, 90);
  assert.strictEqual(r.score, "any");
});

test("normalize: лимиты — 20 правил, 30 слов, слово 40 символов, MC 24 цифры, имя 60", () => {
  const rules = Array.from({ length: 25 }, (_, i) => ({
    id: `r_${i}`, name: "n".repeat(100),
    keywordsAny: Array.from({ length: 40 }, (_, j) => `w${j}` + "x".repeat(50)),
    brokersBlock: ["9".repeat(30)],
  }));
  const cfg = LLRULES.normalize({ rules });
  assert.strictEqual(cfg.rules.length, 20);
  assert.strictEqual(cfg.rules[0].name.length, 60);
  assert.strictEqual(cfg.rules[0].keywordsAny.length, 30);
  assert.strictEqual(cfg.rules[0].keywordsAny[0].length, 40);
  assert.strictEqual(cfg.rules[0].brokersBlock[0].length, 24);
});

test("active: только enabled; принимает сырой storage", () => {
  const rules = [{ id: "a", enabled: true }, { id: "b", enabled: false }, { id: "c" }];
  assert.deepStrictEqual(LLRULES.active({ rules }).map((r) => r.id), ["a", "c"]);
  assert.deepStrictEqual(LLRULES.active(null), []);
});

const LOAD = {
  board: "dat", originMarket: "LOS ANGELES_CA", destMarket: "DALLAS_TX", equipment: "V",
  rate: 4000, loadedMiles: 1400, deadheadMiles: 100, brokerMc: "MC-123456", creditScore: 92,
  comments: "In-Bond shipment, TWIC required. No hazmat.",
};
const rule = (over) => LLRULES.normalize({ rules: [{ id: "r", ...over }] }).rules[0];
const ctx = { equipFilter: null };

test("matches: правило без условий матчит всё, что прошло equipment", () => {
  assert.ok(LLRULES.matches(rule({}), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({}), LOAD, { equipFilter: ["R"] }));       // глобальный фильтр
  assert.ok(LLRULES.matches(rule({ equipment: ["V"] }), LOAD, { equipFilter: ["R"] })); // своё equipment важнее
});

test("matches: keywordsAny — нормализованная подстрока; нет comments → false", () => {
  assert.ok(LLRULES.matches(rule({ keywordsAny: ["inbond"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ keywordsAny: ["bonded", "twic"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ keywordsAny: ["airport"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ keywordsAny: ["twic"] }), { ...LOAD, comments: null }, ctx));
});

test("matches: keywordsNone — исключает; пустые comments проходят", () => {
  assert.ok(!LLRULES.matches(rule({ keywordsNone: ["hazmat"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ keywordsNone: ["team"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ keywordsNone: ["hazmat"] }), { ...LOAD, comments: "" }, ctx));
});

test("matches: AND внутри правила", () => {
  assert.ok(LLRULES.matches(rule({ keywordsAny: ["twic"], maxDeadhead: 150 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ keywordsAny: ["twic"], maxDeadhead: 50 }), LOAD, ctx));
});

test("matches: minRate / minRpm (с deadhead) / miles", () => {
  assert.ok(LLRULES.matches(rule({ minRate: 4000 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minRate: 4001 }), LOAD, ctx));
  // 4000 / (1400 + 100) = 2.67
  assert.ok(LLRULES.matches(rule({ minRpm: 2.6 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minRpm: 2.7 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minRpm: 1 }), { ...LOAD, loadedMiles: 0, deadheadMiles: 0 }, ctx));
  assert.ok(LLRULES.matches(rule({ minMiles: 1400, maxMiles: 1400 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minMiles: 1401 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ maxMiles: 1399 }), LOAD, ctx));
});

test("matches: deadheadMiles null → считаем 0, груз проходит maxDeadhead", () => {
  assert.ok(LLRULES.matches(rule({ maxDeadhead: 10 }), { ...LOAD, deadheadMiles: null }, ctx));
  assert.ok(!LLRULES.matches(rule({ maxDeadhead: 10 }), LOAD, ctx));
});

test("matches: destStates по хвосту destMarket", () => {
  assert.ok(LLRULES.matches(rule({ destStates: ["tx", "ok"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ destStates: ["CA"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ destStates: ["TX"] }), { ...LOAD, destMarket: "" }, ctx));
});

test("matches: брокер — block побеждает allow; minCredit", () => {
  assert.ok(LLRULES.matches(rule({ brokersAllow: ["123456"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ brokersAllow: ["999"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ brokersAllow: ["123456"], brokersBlock: ["123456"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ brokersBlock: ["999"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ brokersBlock: ["999"] }), { ...LOAD, brokerMc: null }, ctx));
  assert.ok(!LLRULES.matches(rule({ brokersAllow: ["999"] }), { ...LOAD, brokerMc: null }, ctx));
  assert.ok(LLRULES.matches(rule({ minCredit: 90 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minCredit: 95 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minCredit: 1 }), { ...LOAD, creditScore: null }, ctx));
});

test("matches: score через badgeFor; при 'any' badgeFor не вызывается", () => {
  let calls = 0;
  const bf = (lvl) => ({ equipFilter: null, badgeFor: () => { calls++; return { level: lvl }; } });
  assert.ok(LLRULES.matches(rule({ score: "any" }), LOAD, bf("red")));
  assert.strictEqual(calls, 0);
  assert.ok(LLRULES.matches(rule({ score: "green" }), LOAD, bf("green")));
  assert.ok(!LLRULES.matches(rule({ score: "green" }), LOAD, bf("amber")));
  assert.ok(LLRULES.matches(rule({ score: "green_amber" }), LOAD, bf("amber")));
  assert.ok(!LLRULES.matches(rule({ score: "green_amber" }), LOAD, bf("red")));
  assert.ok(!LLRULES.matches(rule({ score: "green" }), LOAD, { equipFilter: null })); // нет badgeFor → не матчит
});

test("select: OR между правилами, первое совпавшее; несовпавшие грузы выпадают", () => {
  const rules = LLRULES.normalize({ rules: [
    { id: "kw", name: "Bonded", keywordsAny: ["bonded"], keywordsNone: ["hazmat"] },
    { id: "rpm", name: "$8+", minRpm: 8 },
  ] }).rules;
  const rich = { ...LOAD, comments: "", rate: 15000 };                         // 15000/1500 = 10
  const dull = { ...LOAD, comments: "" };
  const hits = LLRULES.select(rules, [LOAD, rich, dull], ctx);
  assert.deepStrictEqual(hits.map((h) => [h.load, h.rule.id]), [[rich, "rpm"]]); // LOAD: "bonded" не подстрока "inbond", hazmat исключает; rpm 2.67 < 8
  assert.deepStrictEqual(LLRULES.select([], [LOAD], ctx), []);
  assert.deepStrictEqual(LLRULES.select(rules, null, ctx), []);
});

// ---- свежесть постинга: maxAgeMinutes (возраст даёт ctx.ageOf — LLRULES остаётся без зависимостей) ----

test("normalize: maxAgeMinutes из строки, мусор и отрицательное → null", () => {
  assert.strictEqual(rule({ maxAgeMinutes: "45" }).maxAgeMinutes, 45);
  assert.strictEqual(rule({ maxAgeMinutes: 0 }).maxAgeMinutes, 0);
  assert.strictEqual(rule({ maxAgeMinutes: "abc" }).maxAgeMinutes, null);
  assert.strictEqual(rule({ maxAgeMinutes: -5 }).maxAgeMinutes, null);
});

test("matches: maxAgeMinutes отсекает протухшие постинги", () => {
  const age = (min) => ({ ...ctx, ageOf: () => min });
  assert.ok(LLRULES.matches(rule({ maxAgeMinutes: 30 }), LOAD, age(12)));
  assert.ok(LLRULES.matches(rule({ maxAgeMinutes: 30 }), LOAD, age(30)));   // граница включительно
  assert.ok(!LLRULES.matches(rule({ maxAgeMinutes: 30 }), LOAD, age(31)));
});

test("matches: возраст неизвестен → правило со сроком НЕ пропускает груз", () => {
  // Иначе «только свежие» молча пропускало бы всё, у чего DAT не отдал время постинга.
  assert.ok(!LLRULES.matches(rule({ maxAgeMinutes: 30 }), LOAD, { ...ctx, ageOf: () => null }));
  assert.ok(!LLRULES.matches(rule({ maxAgeMinutes: 30 }), LOAD, ctx));       // ageOf вообще не передан
  assert.ok(LLRULES.matches(rule({}), LOAD, ctx));                            // без условия — как раньше
});
