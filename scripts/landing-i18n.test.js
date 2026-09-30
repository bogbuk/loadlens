/* Лендинг backend/public/index.html: EN живёт в разметке (data-i18n), RU/RO — в словаре I18N.
   Тест держит их в синхроне: каждый ключ разметки переведён, в словаре нет мусорных ключей. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "backend", "public", "index.html"), "utf8");
const src = html.split("/*I18N-START*/")[1].split("/*I18N-END*/")[0];
const I18N = new Function("return " + src)();
// ключи, которые ставит скрипт, а не разметка: <title>/описание и темы писем
const SCRIPT_KEYS = ["meta.title", "meta.desc", "mail.pro", "mail.question"];
const markup = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
const expected = new Set([...markup, ...SCRIPT_KEYS]);

for (const lang of ["ru", "ro"]) {
  test(`${lang}: переведён каждый ключ разметки и скрипта`, () => {
    const missing = [...expected].filter((k) => !(I18N[lang][k] || "").trim());
    assert.deepStrictEqual(missing, []);
  });
  test(`${lang}: в словаре нет ключей, которых нет на странице`, () => {
    assert.deepStrictEqual(Object.keys(I18N[lang]).filter((k) => !expected.has(k)), []);
  });
}

test("кнопки установки ведут на листинг CWS с utm_source=landing", () => {
  const hrefs = [...html.matchAll(/<a [^>]*data-cws[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 3);
  for (const h of hrefs) assert.match(h, /^https:\/\/chromewebstore\.google\.com\/detail\/chemnjopdclcmcckgfbmabielhobmknk\?utm_source=landing$/);
});

test("триал упомянут на всех языках: hero.note и карточка Pro", () => {
  assert.match(html, /data-i18n="hero.note">[^<]*14 days of Pro/);
  assert.match(html, /data-i18n="pr.pro.sub">Try Pro free for 14 days/);
  for (const lang of ["ru", "ro"]) {
    assert.match(I18N[lang]["hero.note"], /14/);
    assert.match(I18N[lang]["pr.pro.sub"], /14/);
  }
});

test("Метрика грузится только после согласия: нет безусловного init и пикселя noscript", () => {
  assert.doesNotMatch(html, /mc\.yandex\.ru\/watch\//, "пиксель noscript шлёт хит без согласия");
  const head = html.split("</head>")[0];
  assert.doesNotMatch(head, /ym\(113205805, 'init'/, "init в <head> срабатывает до согласия");
  assert.match(html, /function loadMetrika\(\)/);
  assert.match(html, /id="consent"[^>]*hidden/);
  assert.match(html, /id="ck-yes"/);
  assert.match(html, /id="ck-no"/);
  assert.match(html, /id="ck-open"/);
});
