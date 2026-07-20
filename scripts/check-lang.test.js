const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stripComments, findCyrillic, expand, scan } = require("./check-lang.js");

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

test("defect 5: regex-литерал с кавычкой внутри не сбивает чётность кавычек для остатка файла", () => {
  // popup.js:2 — реальный живой случай: /[&<>"]/ содержит " внутри regex-класса.
  const src = [
    'const escA = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;" }[c]));',
    "// ---- настройки ----",
  ].join("\n");
  const stripped = stripComments(src);
  assert.ok(!/настройки/.test(stripped));
});

test("defect 5: деление не принимается за regex-литерал", () => {
  const hits = findCyrillic(stripComments('const r = (a) / b; const s = "текст";'));
  assert.strictEqual(hits.length, 1);
});

test("defect 5: unescaped / внутри regex-класса [...] не закрывает литерал раньше времени", () => {
  const hits = findCyrillic(stripComments('const re = /[a/b]/; const s = "текст";'));
  assert.strictEqual(hits.length, 1);
});

test("defect 4 (регресс): \\/\\/ на конце regex-литерала по-прежнему не режется как построчный комментарий", () => {
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

test('findCyrillic: JSON-конвенция "_comment" — dev-комментарий (не user-facing), не считается находкой', () => {
  const src = '{\n  "_comment": "Русский dev-комментарий про сид-данные",\n  "strength": 0.5\n}';
  assert.deepStrictEqual(findCyrillic(src), []);
});

test('findCyrillic: "_comment" не глотает кириллицу в соседних реальных строках', () => {
  const src = '{\n  "_comment": "Комментарий",\n  "label": "Русский label"\n}';
  const hits = findCyrillic(src);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 3);
});

// --- expand(): что именно попадает под обход SCOPE — здесь и был пропущенный дефект
// (allowlist из 6 файлов вместо директории), findCyrillic/stripComments его не ловили.

test("expand: рекурсивно обходит директорию, фильтрует по расширению и исключает .test.js/.spec.ts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-lang-expand-"));
  try {
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "a.js"), "const a = 1;");
    fs.writeFileSync(path.join(dir, "a.test.js"), "const a = 1;");
    fs.writeFileSync(path.join(dir, "a.spec.ts"), "const a = 1;");
    fs.writeFileSync(path.join(dir, "a.css"), "body { content: 'x'; }");
    fs.writeFileSync(path.join(dir, "a.png"), "binary");
    fs.writeFileSync(path.join(dir, "sub", "b.html"), "<div></div>");
    const files = expand(dir).map((f) => path.basename(f)).sort();
    assert.deepStrictEqual(files, ["a.css", "a.js", "b.html"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expand: пропускает служебные директории (node_modules/.git/.superpowers/.claude)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-lang-expand-excl-"));
  try {
    for (const d of ["node_modules", ".git", ".superpowers", ".claude"]) {
      fs.mkdirSync(path.join(dir, d));
      fs.writeFileSync(path.join(dir, d, "cyr.js"), 'const s = "привет";');
    }
    fs.writeFileSync(path.join(dir, "keep.js"), "const a = 1;");
    const files = expand(dir).map((f) => path.basename(f));
    assert.deepStrictEqual(files, ["keep.js"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expand: EXCLUDE_PATHS (extension/vendor, backend/shared — автокопии) не обходятся", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-lang-expand-vendor-"));
  const cwd = process.cwd();
  try {
    fs.mkdirSync(path.join(dir, "extension", "vendor"), { recursive: true });
    fs.writeFileSync(path.join(dir, "extension", "vendor", "cyr.js"), 'const s = "привет";');
    fs.mkdirSync(path.join(dir, "extension", "content"), { recursive: true });
    fs.writeFileSync(path.join(dir, "extension", "content", "keep.js"), "const a = 1;");
    fs.mkdirSync(path.join(dir, "backend", "shared"), { recursive: true });
    fs.writeFileSync(path.join(dir, "backend", "shared", "cyr.js"), 'const s = "привет";');
    process.chdir(dir);
    const files = ["extension", "backend/shared"].flatMap(expand).sort();
    assert.deepStrictEqual(files, [path.join("extension", "content", "keep.js")]);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expand: путь к одиночному файлу возвращается как есть", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-lang-expand-file-"));
  try {
    const f = path.join(dir, "single.js");
    fs.writeFileSync(f, "const a = 1;");
    assert.deepStrictEqual(expand(f), [f]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expand: несуществующий путь даёт пустой список (не бросает)", () => {
  assert.deepStrictEqual(expand(path.join(os.tmpdir(), "check-lang-does-not-exist-xyz")), []);
});

// --- scan(): сквозной happy-path expand+findCyrillic — именно это гоняет `npm run check:lang`.

test("scan: находит непереведённые строки в реальных файлах и пропускает test-файлы/комментарии", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-lang-scan-"));
  try {
    fs.writeFileSync(path.join(dir, "bad.js"), 'const s = "привет"; // и комментарий тоже кириллицей');
    fs.writeFileSync(path.join(dir, "bad.test.js"), 'const s = "привет";');
    fs.writeFileSync(path.join(dir, "ok.js"), 'const s = "hello"; // русский коммент ок');
    const hits = scan([dir]);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(path.basename(hits[0].file), "bad.js");
    assert.strictEqual(hits[0].line, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scan: чистая директория без кириллицы в user-facing коде даёт пустой результат", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-lang-scan-clean-"));
  try {
    fs.writeFileSync(path.join(dir, "ok.js"), 'const s = "hello"; // русский коммент');
    assert.deepStrictEqual(scan([dir]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
