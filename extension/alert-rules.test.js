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
    minRate: null, minRpm: null, maxDeadhead: null, minMiles: null, maxMiles: null,
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
