const test = require("node:test");
const assert = require("node:assert");
const { stripComments, findCyrillic } = require("./check-lang.js");

test("stripComments: убирает построчный комментарий", () => {
  assert.strictEqual(stripComments("const a = 1; // русский коммент").trim(), "const a = 1;");
});

test("stripComments: убирает блочный комментарий, в т.ч. многострочный (переводы строк сохраняются)", () => {
  // Посимвольный сканер сохраняет \n внутри блочного комментария, чтобы номера строк
  // в findCyrillic не смещались — поэтому один \n внутри комментария остаётся в выводе.
  assert.strictEqual(stripComments("/* русский\n   блок */const a = 1;"), "\nconst a = 1;");
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

test("defect 1: // внутри строкового литерала (не после :) не должен обрезать остаток строки", () => {
  const hits = findCyrillic(stripComments('const label = "info//подробнее";'));
  assert.strictEqual(hits.length, 1);
});

test("defect 2: одинокий /* внутри строкового литерала не должен глотать несвязанные строки дальше по файлу", () => {
  const s = 'const a = "вариант A/*B";\nconst b = "неправильный груз";\nfunction f(){ */ return 1; }';
  const hits = findCyrillic(stripComments(s));
  assert.ok(hits.some((h) => h.text.includes("неправильный груз")));
});

test("defect 3: HTML-комментарии <!-- --> распознаются и срезаются", () => {
  const hits = findCyrillic(stripComments("<!-- Русский комментарий -->\n<div>hello</div>"));
  assert.deepStrictEqual(hits, []);
});

test("stripComments: номера строк не смещаются после срезания многострочного блочного комментария", () => {
  const src = '/* line1\nline2\nline3 */\nconst a = "привет";';
  const hits = findCyrillic(stripComments(src));
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 4);
});

test("defect 4: \\// на конце regex-литерала не должен приниматься за построчный комментарий", () => {
  // const ok = /^https?:\/\//.test(url) ? "да" : "нет";
  const src = 'const ok = /^https?:\\/\\//.test(url) ? "да" : "нет";';
  const hits = findCyrillic(stripComments(src));
  assert.strictEqual(hits.length, 1);
});

test("known limitation (принято как есть): комментарий внутри ${...} шаблонной строки не срезается — ложноположительная находка, не пропуск", () => {
  // const x = `val ${/* русский коммент внутри интерполяции */ 1}`;
  const src = 'const x = `val ${/* русский коммент внутри интерполяции */ 1}`;';
  const hits = findCyrillic(stripComments(src));
  // Ожидаемо (не баг): интерполяция ${...} не разбирается рекурсивно, поэтому
  // комментарий внутри неё остаётся текстом шаблонной строки и даёт находку.
  assert.strictEqual(hits.length, 1);
});
