const test = require("node:test");
const assert = require("node:assert");
const LLEQUIP = require("./equip-filter.js");

test("normalize: пусто/null/[] → null (фильтра нет)", () => {
  assert.strictEqual(LLEQUIP.normalize(null), null);
  assert.strictEqual(LLEQUIP.normalize(undefined), null);
  assert.strictEqual(LLEQUIP.normalize(""), null);
  assert.strictEqual(LLEQUIP.normalize([]), null);
});

test("normalize: строка (старый формат) → массив из одного кода", () => {
  assert.deepStrictEqual(LLEQUIP.normalize("V"), ["V"]);
});

test("normalize: массив кодов остаётся массивом", () => {
  assert.deepStrictEqual(LLEQUIP.normalize(["V", "R"]), ["V", "R"]);
});

test("normalize: отсекает пустые элементы; всё пустое → null", () => {
  assert.deepStrictEqual(LLEQUIP.normalize([null, "V", "", "R"]), ["V", "R"]);
  assert.strictEqual(LLEQUIP.normalize([null, "", undefined]), null);
});

test("matches: без фильтра пропускает любой прицеп", () => {
  assert.strictEqual(LLEQUIP.matches(null, "V"), true);
  assert.strictEqual(LLEQUIP.matches([], "F"), true);
});

test("matches: один код пропускает только его (старый формат-строка тоже)", () => {
  assert.strictEqual(LLEQUIP.matches(["V"], "V"), true);
  assert.strictEqual(LLEQUIP.matches(["V"], "R"), false);
  assert.strictEqual(LLEQUIP.matches("V", "V"), true);
  assert.strictEqual(LLEQUIP.matches("V", "R"), false);
});

test("matches: несколько кодов пропускают любой из набора", () => {
  assert.strictEqual(LLEQUIP.matches(["V", "R"], "R"), true);
  assert.strictEqual(LLEQUIP.matches(["V", "R"], "F"), false);
});
