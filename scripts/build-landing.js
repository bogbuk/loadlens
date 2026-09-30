/* Лендинг: каждый язык — свой URL, чтобы поисковики индексировали RU/RO (раньше перевод
   подставлялся скриптом и Google видел только EN).
   Источник — EN-разметка backend/public/index.html (правится руками) + словарь landing/i18n.json.
   Генерирует: SEO-блок <head> во всех трёх страницах (между <!--SEO-START/END-->),
   backend/public/{ru,ro}/index.html и backend/public/sitemap.xml.
   Страницы — список PAGES; словарь страницы накладывается на общий landing/i18n.json.
   Запуск: npm run build:landing (входит в npm test; устаревшие файлы ловит landing-i18n.test.js). */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "backend", "public");
// Домен в одном месте: при переезде на свой домен меняется только здесь (+ robots.txt).
const BASE = "https://loadlens.krait.studio";
const CWS = "https://chromewebstore.google.com/detail/chemnjopdclcmcckgfbmabielhobmknk";
// Префиксы языков; URL страницы = префикс + её путь (EN без префикса).
const LANGS = {
  en: { path: "/", locale: "en_US" },
  ru: { path: "/ru/", locale: "ru_RU" },
  ro: { path: "/ro/", locale: "ro_RO" },
};
// src — EN-исходник в backend/public (правится руками), dict — словарь поверх landing/i18n.json.
// ld: "app" — карточка расширения (SoftwareApplication), "tool" — бесплатный инструмент (WebApplication + FAQPage).
const COMMON_DICT = "landing/i18n.json";
const PAGES = [
  { src: "index.html", dict: COMMON_DICT, path: "/", ld: "app" },
];
// Прочие публичные страницы для sitemap (admin.html — noindex, в карту не идёт).
const EXTRA_PAGES = ["/stats.html", "/privacy.html"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const urlOf = (lang, pg) => LANGS[lang].path + pg.path.slice(1);
const jsonScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

function jsonLd(lang, pg, d, faq) {
  const url = BASE + urlOf(lang, pg);
  if (pg.ld === "tool") return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebApplication", name: d["meta.title"], url, description: d["meta.desc"],
        applicationCategory: "BusinessApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript",
        inLanguage: lang, isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
      { "@type": "FAQPage", inLanguage: lang, mainEntity: faq.map(([q, a]) =>
        ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ],
  };
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "LoadLens",
    url,
    description: d["meta.desc"],
    applicationCategory: "BusinessApplication",
    operatingSystem: "Chrome",
    inLanguage: lang,
    image: BASE + "/og.png",
    installUrl: CWS,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

function seoBlock(lang, pg, d, faq) {
  const url = BASE + urlOf(lang, pg);
  const title = esc(d["meta.title"]), desc = esc(d["meta.desc"]);
  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...Object.keys(LANGS).map((l) => `<link rel="alternate" hreflang="${l}" href="${BASE + urlOf(l, pg)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${BASE + pg.path}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="LoadLens" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${BASE}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="${LANGS[lang].locale}" />`,
    ...Object.keys(LANGS).filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${LANGS[l].locale}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${jsonScript(jsonLd(lang, pg, d, faq))}</script>`,
  ];
  return "<!--SEO-START-->\n" + lines.map((l) => "  " + l).join("\n") + "\n  <!--SEO-END-->";
}

// Заменяет содержимое каждого [data-i18n]-элемента значением словаря. Закрывающий тег ищем
// с учётом вложенных одноимённых тегов (например, <span> внутри <span>).
function translateBody(html, d) {
  const open = /<([a-z][a-z0-9]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>/gi;
  let out = "", pos = 0, m;
  while ((m = open.exec(html))) {
    const [tag, name, key] = [m[0], m[1].toLowerCase(), m[2]];
    const inner = m.index + tag.length;
    const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
    re.lastIndex = inner;
    let depth = 1, t;
    while (depth && (t = re.exec(html))) depth += t[1] ? -1 : 1;
    if (!t) throw new Error(`build-landing: нет закрывающего </${name}> для data-i18n="${key}"`);
    if (!(key in d)) throw new Error(`build-landing: нет перевода "${key}"`);
    out += html.slice(pos, inner) + d[key];
    pos = t.index;
    open.lastIndex = t.index;
  }
  return out + html.slice(pos);
}

function mailHrefs(html, d) {
  return html.replace(/(<a\b[^>]*data-mail="(\w+)"[^>]*href=")[^"]*(")/g, (_, a, kind, b) =>
    a + "mailto:hello@krait.studio?subject=" + encodeURIComponent(d["mail." + kind]) + b)
    .replace(/(<a\b[^>]*href=")[^"]*("[^>]*data-mail="(\w+)")/g, (_, a, b, kind) =>
      a + "mailto:hello@krait.studio?subject=" + encodeURIComponent(d["mail." + kind]) + b);
}

// Строки, которые рисует JS страницы (ключи js.*), — JSON-блок между маркерами.
function stringsBlock(d) {
  const js = Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith("js.")));
  return `<!--STRINGS-START--><script type="application/json" id="ll-strings">${jsonScript(js)}</script><!--STRINGS-END-->`;
}

// Вопросы/ответы FAQ из уже переведённой разметки: data-i18n="faq.qN" / "faq.aN", текст без тегов.
function faqFrom(html) {
  const get = (k) => (html.match(new RegExp(`data-i18n="faq\\.${k}"[^>]*>([^<]*)<`)) || [])[1];
  const out = [];
  for (let i = 1; get("q" + i); i++) out.push([get("q" + i), get("a" + i)]);
  return out;
}

function page(src, lang, pg, dict) {
  const d = { ...dict.en, ...(dict[lang] || {}) };
  let html = mailHrefs(src, d);
  if (lang !== "en") {
    html = html.replace(/<html lang="en">/, `<html lang="${lang}">`);
    const bodyAt = html.indexOf("<body>");
    html = html.slice(0, bodyAt) + translateBody(html.slice(bodyAt), dict[lang]);
    html = html.replace(/ aria-current="page"/g, "")
      .replace(new RegExp(`(data-lang="${lang}")`), '$1 aria-current="page"')
      .replace(/(<a\b[^>]*\bdata-local href=")\//g, (_, a) => `${a}/${lang}/`);
  }
  html = html.replace(/<!--STRINGS-START-->[\s\S]*?<!--STRINGS-END-->/, () => stringsBlock(d));
  return html.replace(/<!--SEO-START-->[\s\S]*?<!--SEO-END-->/, () => seoBlock(lang, pg, d, faqFrom(html)));
}

function sitemap() {
  const urls = PAGES.flatMap((pg) => {
    const alts = Object.keys(LANGS).map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${BASE + urlOf(l, pg)}"/>`)
      .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE + pg.path}"/>`).join("\n");
    return Object.keys(LANGS).map((l) => `  <url>\n    <loc>${BASE + urlOf(l, pg)}</loc>\n${alts}\n  </url>`);
  }).concat(EXTRA_PAGES.map((p) => `  <url>\n    <loc>${BASE + p}</loc>\n  </url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

const readDict = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
// Словарь страницы поверх общего: общие ключи (шапка, футер, согласие, cta.install) — из landing/i18n.json.
function layer(base, own) {
  return Object.fromEntries(Object.keys(LANGS).map((l) => [l, { ...(base[l] || {}), ...(own[l] || {}) }]));
}

// Возвращает { относительный путь в backend/public: содержимое } — тест сверяет его с диском.
function build() {
  const common = readDict(COMMON_DICT);
  const files = { "sitemap.xml": sitemap() };
  for (const pg of PAGES) {
    const src = fs.readFileSync(path.join(PUBLIC, pg.src), "utf8");
    const dict = pg.dict === COMMON_DICT ? common : layer(common, readDict(pg.dict));
    for (const lang of Object.keys(LANGS)) files[path.join(urlOf(lang, pg).slice(1), "index.html")] = page(src, lang, pg, dict);
  }
  return files;
}

module.exports = { build, BASE, LANGS, PAGES, urlOf };

if (require.main === module) {
  for (const [rel, content] of Object.entries(build())) {
    const file = path.join(PUBLIC, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log("build-landing:", path.relative(ROOT, file));
  }
}
