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
const { build, BASE, LANGS, PAGES, urlOf } = require("./build-landing");
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

test("общие стили и редирект по языку: site.css в <head>, редирект сохраняет путь известной страницы", () => {
  const head = html.split("</head>")[0];
  assert.match(head, /<link rel="stylesheet" href="\/css\/site\.css" \/>/);
  assert.ok(head.includes('location.replace("/" + lang + (P.indexOf(p) >= 0 ? p : "/") + location.hash)'));
  assert.ok(!/\.consent \{/.test(head), "стили баннера должны жить в site.css");
});

test("urlOf: префикс языка + путь страницы", () => {
  const calc = { path: "/hos-calculator/" };
  assert.strictEqual(urlOf("en", calc), "/hos-calculator/");
  assert.strictEqual(urlOf("ru", calc), "/ru/hos-calculator/");
  assert.strictEqual(urlOf("ro", PAGES[0]), "/ro/");
});

test("sitemap: каждая страница на каждом языке, с hreflang своей группы", () => {
  const sm = built["sitemap.xml"];
  for (const pg of PAGES) for (const l of Object.keys(LANGS)) {
    assert.ok(sm.includes(`<loc>${BASE + urlOf(l, pg)}</loc>`), `нет ${urlOf(l, pg)}`);
    assert.ok(sm.includes(`hreflang="${l}" href="${BASE + urlOf(l, pg)}"`));
  }
});

for (const lang of ["ru", "ro"]) test(`${lang}: ссылки data-local ведут на свою языковую версию`, () => {
  const page = built[path.join(lang, "index.html")];
  assert.match(page, new RegExp(`<a class="logo" data-local href="/${lang}/"`));
  assert.ok(!/data-local href="\/(?!ru\/|ro\/)/.test(page));
});

// ---- HOS-калькулятор ----
const CALC = PAGES.find((p) => p.path === "/hos-calculator/");
const calcHtml = fs.readFileSync(path.join(PUB, "hos-calculator", "index.html"), "utf8");
const CALC_I18N = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "landing", "hos-calculator.i18n.json"), "utf8"));
const calcKeys = new Set([...calcHtml.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
const hosPageJs = fs.readFileSync(path.join(PUB, "js", "hos-page.js"), "utf8");
const JS_KEYS = ["js.hm", "js.left", "js.now", "js.total", "js.arrive",
  ...["break", "drive", "window", "cycle", "split", "recap"].map((k) => "js.next." + k),
  ...["need", "where.sb", "where.any", "after", "short", "full"].map((k) => "js.split." + k),
  ...["duty", "drive", "break", "reset", "restart", "recap"].map((k) => "js.seg." + k), "js.recap"];

test("калькулятор в PAGES как инструмент", () => {
  assert.ok(CALC);
  assert.strictEqual(CALC.ld, "tool");
});

for (const lang of ["ru", "ro"]) {
  test(`калькулятор ${lang}: переведён каждый ключ разметки (свой словарь или общий)`, () => {
    const d = { ...I18N[lang], ...CALC_I18N[lang] };
    assert.deepStrictEqual([...calcKeys].filter((k) => !(d[k] || "").trim()), []);
  });
  test(`калькулятор ${lang}: в своём словаре нет лишних ключей; js.* и meta.* совпадают с EN`, () => {
    const own = Object.keys(CALC_I18N[lang]);
    assert.deepStrictEqual(own.filter((k) => !calcKeys.has(k) && !/^(js|meta)\./.test(k)), []);
    const scriptKeys = (o) => Object.keys(o).filter((k) => /^(js|meta)\./.test(k)).sort();
    assert.deepStrictEqual(scriptKeys(CALC_I18N[lang]), scriptKeys(CALC_I18N.en));
  });
}

test("калькулятор: EN-словарь содержит только meta.* и все js.*, которые читает hos-page.js", () => {
  assert.deepStrictEqual(Object.keys(CALC_I18N.en).filter((k) => !/^(js|meta)\./.test(k)), []);
  for (const k of JS_KEYS) assert.ok((CALC_I18N.en[k] || "").trim(), `нет ${k}`);
  for (const m of hosPageJs.matchAll(/S\["(js\.[^"]+)"\]/g)) assert.ok(JS_KEYS.includes(m[1]), `ключ ${m[1]} не в JS_KEYS`);
});

for (const lang of Object.keys(LANGS)) {
  const rel = path.join(urlOf(lang, CALC).slice(1), "index.html");
  test(`калькулятор ${lang}: canonical, FAQPage, строки для JS, переключатель на версии калькулятора`, () => {
    const page = built[rel];
    assert.ok(page.includes(`<link rel="canonical" href="${BASE + urlOf(lang, CALC)}" />`));
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
    assert.strictEqual(faq.mainEntity.length, 4);
    for (const q of faq.mainEntity) assert.ok(q.name && q.acceptedAnswer.text);
    const strings = JSON.parse(page.match(/<script type="application\/json" id="ll-strings">(.*?)<\/script>/)[1]);
    for (const k of JS_KEYS) assert.ok(strings[k], `${lang}: нет ${k}`);
    for (const l of Object.keys(LANGS)) assert.ok(page.includes(`href="${urlOf(l, CALC)}" hreflang="${l}"`));
    assert.match(page, new RegExp(`data-lang="${lang}" aria-current="page"`));
    if (lang !== "en") assert.ok(page.includes(`<title>${CALC_I18N[lang]["meta.title"]}</title>`));
  });
}

test("калькулятор: кнопка установки с utm_source=hos_calc, поля скрыты от Webvisor, скрипты подключены", () => {
  const hrefs = [...calcHtml.matchAll(/<a [^>]*data-cws="hos_calc"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(hrefs, ["https://chromewebstore.google.com/detail/chemnjopdclcmcckgfbmabielhobmknk?utm_source=hos_calc"]);
  const inputs = [...calcHtml.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => /type="number"/.test(t));
  assert.ok(inputs.length >= 12);
  for (const t of inputs) assert.match(t, /class="[^"]*ym-disable-keys/);
  assert.match(calcHtml, /<script src="\/js\/hos-trip\.js"><\/script>\s*<script src="\/js\/hos-page\.js"><\/script>\s*<script src="\/js\/site\.js"><\/script>\s*<\/body>/);
  assert.match(calcHtml, /<link rel="stylesheet" href="\/css\/site\.css" \/>/);
  assert.match(calcHtml, /not a replacement for your ELD/);
});

test("главная ссылается на калькулятор (карточка HOS и футер), privacy упоминает калькулятор", () => {
  assert.match(html, /<a data-local href="\/hos-calculator\/" data-i18n="f2\.link">/);
  assert.match(html, /<a data-local href="\/hos-calculator\/" data-i18n="ft\.hos">/);
  assert.match(built[path.join("ru", "index.html")], /data-local href="\/ru\/hos-calculator\/"/);
  const privacy = fs.readFileSync(path.join(PUB, "privacy.html"), "utf8");
  assert.match(privacy, /HOS calculator/);
  assert.ok(!privacy.includes("The page has no forms"), "на калькуляторе есть поля — формулировка устарела");
});

// Редирект по языку из <head> EN-страниц: ServeStatic отдаёт EN-главную на любой неизвестный путь,
// поэтому неизвестный путь (в т.ч. /ru/…) должен уводить на главную языка, а не на /ru/<путь> (петля).
const vm = require("node:vm");
function redirectOf(src, pathname) {
  const code = src.match(/<script>\s*(\(function \(\) \{\s*if \(document\.documentElement\.lang !== "en"\)[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
  let to = null;
  vm.runInNewContext(code, {
    document: { documentElement: { lang: "en", className: "" } },
    location: { pathname, search: "", hash: "", replace: (u) => { to = u; } },
    URLSearchParams, localStorage: { getItem: () => "ru" }, navigator: { language: "ru-RU" },
  });
  return to;
}
for (const pg of PAGES) test(`редирект по языку (${pg.src}): известные страницы — на свою версию, неизвестный путь — на главную языка`, () => {
  const src = fs.readFileSync(path.join(PUB, pg.src), "utf8");
  for (const p of PAGES) assert.strictEqual(redirectOf(src, p.path), "/ru" + p.path);
  assert.strictEqual(redirectOf(src, "/pricing"), "/ru/");
  assert.strictEqual(redirectOf(src, "/ru/pricing"), "/ru/");
});

test("калькулятор: поля «после перерыва» пустые по умолчанию, результаты скрыты от Webvisor, privacy точна", () => {
  for (const id of ["since-h", "since-m"]) assert.doesNotMatch(calcHtml.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0], /value=/);
  assert.match(calcHtml, /<p class="now ym-hide-content" id="now"/);
  assert.match(calcHtml, /<div class="panel ym-hide-content"[^>]*>\s*<h2 data-i18n="r\.title">/);
  assert.match(calcHtml, /<div id="plan-box" class="ym-hide-content" hidden>/);
  const privacy = fs.readFileSync(path.join(PUB, "privacy.html"), "utf8");
  assert.match(privacy, /the numbers you enter in the HOS calculator and its results are hidden from session replay/);
});

test("модерация Paddle: цена Pro, страницы Terms и Refund в подвале и sitemap", () => {
  assert.match(html, /<h3>Pro<\/h3>\s*<p class="price"><b>\$24<\/b>/);
  const hos = fs.readFileSync(path.join(PUB, "hos-calculator", "index.html"), "utf8");
  const sitemap = fs.readFileSync(path.join(PUB, "sitemap.xml"), "utf8");
  for (const pg of ["terms", "refund"]) {
    const page = fs.readFileSync(path.join(PUB, `${pg}.html`), "utf8");
    assert.match(page, /Paddle\.com/, `${pg}: Paddle как Merchant of Record`);
    assert.match(html, new RegExp(`href="/${pg}\\.html"`));
    assert.match(hos, new RegExp(`href="/${pg}\\.html"`));
    assert.match(sitemap, new RegExp(`${BASE}/${pg}\\.html`));
  }
  assert.match(fs.readFileSync(path.join(PUB, "terms.html"), "utf8"), /US\$24 per month/);
  assert.match(fs.readFileSync(path.join(PUB, "refund.html"), "utf8"), /within 14 days of your first payment/);
});
