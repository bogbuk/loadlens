/* Лендинг backend/public/index.html: EN живёт в разметке (data-i18n), RU/RO — в landing/i18n.json,
   страницы /ru/ /ro/ собирает scripts/build-landing.js. Тест держит их в синхроне: каждый ключ
   разметки переведён, в словаре нет мусорных ключей, сгенерированные файлы не устарели. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "backend", "public", "index.html"), "utf8");
const PUB = path.join(__dirname, "..", "backend", "public");
const siteJs = fs.readFileSync(path.join(PUB, "js", "site.js"), "utf8");
const I18N = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "landing", "i18n.json"), "utf8"));
const { build, BASE, LANGS } = require("./build-landing");
const built = build();
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
  assert.match(siteJs, /function loadMetrika\(\)/);
  assert.match(html, /<script src="\/js\/site\.js"><\/script>\s*<\/body>/);
  assert.match(html, /id="consent"[^>]*hidden/);
  assert.match(html, /id="ck-yes"/);
  assert.match(html, /id="ck-no"/);
  assert.match(html, /id="ck-open"/);
});

test("цель install_click: у каждой кнопки установки своё место, reachGoal только при загруженной Метрике", () => {
  const places = [...html.matchAll(/<a [^>]*data-cws="([^"]*)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(places.sort(), ["final", "hero", "pricing"]);
  assert.match(siteJs, /reachGoal', 'install_click'/);
  assert.match(siteJs, /typeof window\.ym === "function"/);
});

test("сгенерированные страницы и sitemap не устарели (иначе: npm run build:landing)", () => {
  for (const [rel, content] of Object.entries(built)) {
    const disk = fs.readFileSync(path.join(__dirname, "..", "backend", "public", rel), "utf8");
    assert.ok(disk === content, `${rel} устарел`);
  }
});

for (const [lang, { path: p }] of Object.entries(LANGS)) {
  const page = built[path.join(p.slice(1), "index.html")];
  test(`${lang}: lang, canonical на себя, hreflang на все версии, активный язык в шапке`, () => {
    assert.match(page, new RegExp(`<html lang="${lang}">`));
    assert.ok(page.includes(`<link rel="canonical" href="${BASE + p}" />`));
    for (const [l, v] of Object.entries(LANGS)) assert.ok(page.includes(`hreflang="${l}" href="${BASE + v.path}"`));
    assert.ok(page.includes(`hreflang="x-default" href="${BASE}/"`));
    assert.match(page, new RegExp(`data-lang="${lang}" aria-current="page"`));
    assert.strictEqual((page.match(/ aria-current="page">/g) || []).length, 1);
  });
  if (lang !== "en") test(`${lang}: текст переведён в разметке, а не скриптом`, () => {
    assert.ok(page.includes(`>${I18N[lang]["hero.title"]}</h1>`));
    assert.ok(!page.includes(">Know what a load really pays"));
    assert.ok(page.includes(`<title>${I18N[lang]["meta.title"]}</title>`));
  });
}

test("robots.txt указывает на sitemap и закрывает admin/api; admin.html — noindex", () => {
  const pub = path.join(__dirname, "..", "backend", "public");
  const robots = fs.readFileSync(path.join(pub, "robots.txt"), "utf8");
  assert.ok(robots.includes(`Sitemap: ${BASE}/sitemap.xml`));
  assert.match(robots, /Disallow: \/admin\.html/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(fs.readFileSync(path.join(pub, "admin.html"), "utf8"), /<meta name="robots" content="noindex/);
});

test("общие стили и редирект по языку: site.css в <head>, редирект сохраняет путь страницы", () => {
  const head = html.split("</head>")[0];
  assert.match(head, /<link rel="stylesheet" href="\/css\/site\.css" \/>/);
  assert.ok(head.includes('location.replace("/" + lang + location.pathname + location.hash)'));
  assert.ok(!/\.consent \{/.test(head), "стили баннера должны жить в site.css");
});
