const test = require("node:test");
const assert = require("node:assert");
const { stripComments, findCyrillic } = require("./check-lang.js");

test("stripComments: убирает построчный комментарий", () => {
  assert.strictEqual(stripComments("const a = 1; // русский коммент").trim(), "const a = 1;");
});

test("stripComments: убирает блочный комментарий, в т.ч. многострочный", () => {
  assert.strictEqual(stripComments("/* русский\n   блок */const a = 1;"), "const a = 1;");
});

test("stripComments: не режет :// внутри URL", () => {
  const src = 'const u = "https://example.com/путь";';
  assert.ok(stripComments(src).includes("путь"));
});

test("findCyrillic: находит строку и отдаёт 1-индексированный номер", () => {
  const hits = findCyrillic('const a = 1;\nconst b = "привет";\n');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 2);
});

test("findCyrillic: чистый английский даёт пустой результат", () => {
  assert.deepStrictEqual(findCyrillic('const a = "hello";'), []);
});

test("findCyrillic: кириллица только в комментарии не считается находкой", () => {
  assert.deepStrictEqual(findCyrillic(stripComments('const a = 1; // коммент')), []);
});
