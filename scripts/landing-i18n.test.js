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
  assert.ok(head.includes('location.replace("/" + lang + (P.indexOf(p) >= 0 ? p : "/") + location.search + location.hash)'));
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
  assert.match(html, /<h3>Pro<\/h3>\s*<p class="price"><b>\$29<\/b>/);
  assert.match(html, /data-i18n="pr.pro.year">or \$290 per year/);
  const hos = fs.readFileSync(path.join(PUB, "hos-calculator", "index.html"), "utf8");
  const sitemap = fs.readFileSync(path.join(PUB, "sitemap.xml"), "utf8");
  for (const pg of ["terms", "refund"]) {
    const page = fs.readFileSync(path.join(PUB, `${pg}.html`), "utf8");
    assert.match(page, /Paddle\.com/, `${pg}: Paddle как Merchant of Record`);
    assert.match(html, new RegExp(`href="/${pg}\\.html"`));
    assert.match(hos, new RegExp(`href="/${pg}\\.html"`));
    assert.match(sitemap, new RegExp(`${BASE}/${pg}\\.html`));
  }
  assert.match(fs.readFileSync(path.join(PUB, "terms.html"), "utf8"), /US\$29 per month<\/strong> or <strong>US\$290 per year/);
  assert.match(fs.readFileSync(path.join(PUB, "refund.html"), "utf8"), /within 14 days of your first payment/);
});

test("checkout.html: noindex, вне sitemap, без Метрики, Paddle.js с CDN Paddle", () => {
  const page = fs.readFileSync(path.join(PUB, "checkout.html"), "utf8");
  assert.match(page, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(page, /<script src="https:\/\/cdn\.paddle\.com\/paddle\/v2\/paddle\.js"><\/script>/);
  assert.match(page, /\/api\/v1\/billing\/client-config/);
  assert.doesNotMatch(page, /site\.js|mc\.yandex|ym\(/);
  const sitemap = fs.readFileSync(path.join(PUB, "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /checkout/);
  assert.doesNotMatch(html, /checkout\.html/);
});

test("редирект по языку сохраняет query (?mc=, utm)", () => {
  for (const pg of PAGES) {
    const src = fs.readFileSync(path.join(PUB, pg.src), "utf8");
    const code = src.match(/<script>\s*(\(function \(\) \{\s*if \(document\.documentElement\.lang !== "en"\)[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
    let to = null;
    vm.runInNewContext(code, {
      document: { documentElement: { lang: "en", className: "" } },
      location: { pathname: "/broker-check/", search: "?mc=123456", hash: "", replace: (u) => { to = u; } },
      URLSearchParams, localStorage: { getItem: () => "ru" }, navigator: { language: "ru-RU" },
    });
    assert.strictEqual(to, "/ru/broker-check/?mc=123456", pg.src);
  }
});

// ---- Проверка брокера ----
const BROKER = PAGES.find((p) => p.path === "/broker-check/");
const brokerHtml = fs.readFileSync(path.join(PUB, "broker-check", "index.html"), "utf8");
const BROKER_I18N = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "landing", "broker-check.i18n.json"), "utf8"));
const brokerKeys = new Set([...brokerHtml.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
const brokerPageJs = fs.readFileSync(path.join(PUB, "js", "broker-page.js"), "utf8");
const brokerJsKeys = [...new Set([...brokerPageJs.matchAll(/S\["(js\.[^"]+)"\]/g)].map((m) => m[1]))];

test("проверка брокера в PAGES как инструмент", () => {
  assert.ok(BROKER);
  assert.strictEqual(BROKER.ld, "tool");
});

for (const lang of ["ru", "ro"]) {
  test(`брокер ${lang}: переведён каждый ключ разметки; своих лишних ключей нет; js.*/meta.* как в EN`, () => {
    const d = { ...I18N[lang], ...BROKER_I18N[lang] };
    assert.deepStrictEqual([...brokerKeys].filter((k) => !(d[k] || "").trim()), []);
    assert.deepStrictEqual(Object.keys(BROKER_I18N[lang]).filter((k) => !brokerKeys.has(k) && !/^(js|meta)\./.test(k)), []);
    const scriptKeys = (o) => Object.keys(o).filter((k) => /^(js|meta)\./.test(k)).sort();
    assert.deepStrictEqual(scriptKeys(BROKER_I18N[lang]), scriptKeys(BROKER_I18N.en));
  });
}

test("брокер: EN-словарь — только meta.*/js.*; есть каждая строка, которую читает broker-page.js", () => {
  assert.deepStrictEqual(Object.keys(BROKER_I18N.en).filter((k) => !/^(js|meta)\./.test(k)), []);
  // ключи, собираемые из кода: вердикт по уровню shieldBadge и статус лицензии
  const dynamic = ["good", "warn", "risk", "unknown"].map((l) => "js.verdict." + l)
    .concat(["active", "inactive", "carrier_only", "not_found"].map((s) => "js.status." + s));
  for (const k of [...brokerJsKeys, ...dynamic]) assert.ok((BROKER_I18N.en[k] || "").trim(), `нет ${k}`);
  assert.match(brokerPageJs, /S\["js\.verdict\." \+ badge\.level\]/);
  assert.match(brokerPageJs, /S\["js\.status\." \+ a\.status\]/);
});

test("брокер: вердикт и флаги — из LLSCORE (общий код с бейджем 🛡), каждому флагу лицензии есть текст", () => {
  const LLSCORE = require("../shared/scoring.js");
  const levels = new Set();
  const codes = new Set();
  const cases = [
    { status: "active", ageDays: 2000, incidents12m: 0, grantedAt: "2020-01-01" },
    { status: "active", ageDays: 200, incidents12m: 1, grantedAt: "2026-04-01" },
    { status: "active", ageDays: 30, incidents12m: 0, grantedAt: "2026-10-01" },
    { status: "inactive", ageDays: null, incidents12m: null, grantedAt: null },
    { status: "carrier_only", ageDays: null, incidents12m: null, grantedAt: null },
    { status: "not_found", ageDays: null, incidents12m: null, grantedAt: null },
    { status: "not_found", ageDays: 900, incidents12m: 0, grantedAt: "2024-01-01" },
    { status: null, ageDays: null, incidents12m: null, grantedAt: null },
  ];
  for (const a of cases) {
    const shield = { mc: "1", authority: a, repost: null };
    levels.add(LLSCORE.shieldBadge(shield).level);
    for (const f of LLSCORE.redFlags({ brokerMc: "1" }, { shield })) codes.add(f.code);
  }
  assert.deepStrictEqual([...levels].sort(), ["good", "risk", "unknown", "warn"]);
  for (const c of codes) assert.match(brokerPageJs, new RegExp(`\\b${c}:`), `нет текста для флага ${c}`);
  assert.match(brokerHtml, /<script src="\/js\/scoring\.js"><\/script>\s*<script src="\/js\/broker-page\.js"><\/script>\s*<script src="\/js\/site\.js"><\/script>\s*<\/body>/);
  assert.ok(fs.readFileSync(path.join(PUB, "js", "scoring.js"), "utf8").includes(fs.readFileSync(path.join(__dirname, "..", "shared", "scoring.js"), "utf8")),
    "public/js/scoring.js устарел: npm run sync:shared");
});

for (const lang of Object.keys(LANGS)) {
  test(`брокер ${lang}: canonical, FAQPage из 5 вопросов, строки для JS, переключатель на версии страницы`, () => {
    const page = built[path.join(urlOf(lang, BROKER).slice(1), "index.html")];
    assert.ok(page.includes(`<link rel="canonical" href="${BASE + urlOf(lang, BROKER)}" />`));
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
    assert.strictEqual(faq.mainEntity.length, 5);
    for (const q of faq.mainEntity) assert.ok(q.name && q.acceptedAnswer.text);
    const strings = JSON.parse(page.match(/<script type="application\/json" id="ll-strings">(.*?)<\/script>/)[1]);
    for (const k of Object.keys(BROKER_I18N.en).filter((k) => k.startsWith("js."))) assert.ok(strings[k], `${lang}: нет ${k}`);
    for (const l of Object.keys(LANGS)) assert.ok(page.includes(`href="${urlOf(l, BROKER)}" hreflang="${l}"`));
    if (lang !== "en") assert.ok(page.includes(`<title>${BROKER_I18N[lang]["meta.title"]}</title>`));
  });
}

test("брокер: кнопка установки с utm_source=broker_check, ввод скрыт от Webvisor, запрос — в открытый shield", () => {
  const hrefs = [...brokerHtml.matchAll(/<a [^>]*data-cws="broker_check"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(hrefs, ["https://chromewebstore.google.com/detail/chemnjopdclcmcckgfbmabielhobmknk?utm_source=broker_check"]);
  assert.match(brokerHtml, /<input class="ym-disable-keys" type="text" id="mc"/);
  assert.match(brokerHtml, /<div class="panel p-res ym-hide-content" aria-live="polite">/);
  assert.match(brokerPageJs, /fetch\("\/api\/v1\/brokers\/" \+ encodeURIComponent\(mc\) \+ "\/shield"/);
  assert.doesNotMatch(brokerPageJs, /Authorization|localStorage/, "страница открыта всем: без токена и хранения");
});

test("ссылки на проверку брокера: карточка брокера и футер главной, футер калькулятора; privacy описывает отправку MC", () => {
  assert.match(html, /<a data-local href="\/broker-check\/" data-i18n="f3\.link">/);
  for (const src of [html, calcHtml, brokerHtml]) assert.match(src, /<a data-local href="\/broker-check\/" data-i18n="ft\.broker">/);
  assert.match(built[path.join("ro", "hos-calculator", "index.html")], /data-local href="\/ro\/broker-check\/"/);
  const privacy = fs.readFileSync(path.join(PUB, "privacy.html"), "utf8");
  assert.match(privacy, /The broker check sends the MC number you enter to our server/);
});
