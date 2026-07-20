/* Детектор непереведённых строк: падает, если в user-facing коде осталась кириллица.
   Комментарии срезаются — их перевод вне объёма (см. spec 2026-07-20-english-localization-design). */
const fs = require("node:fs");
const path = require("node:path");

// Файлы в объёме локализации. backend/src берётся рекурсивно, .spec.ts исключены.
const SCOPE = [
  "extension/manifest.json",
  "extension/popup.html",
  "extension/popup.js",
  "extension/content.js",
  "extension/api.js",
  "extension/inject.js",
  "backend/src",
];

function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findCyrillic(src) {
  const out = [];
  String(src).split("\n").forEach((text, i) => {
    if (/[А-Яа-яЁё]/.test(text)) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}

function expand(target) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [target];
  return fs.readdirSync(abs)
    .flatMap((e) => expand(path.join(target, e)))
    .filter((f) => /\.(ts|js|html|json)$/.test(f) && !/\.spec\.ts$/.test(f) && !/\.test\.js$/.test(f));
}

function scan(files) {
  return files
    .flatMap(expand)
    .flatMap((file) =>
      findCyrillic(stripComments(fs.readFileSync(file, "utf8"))).map((h) => ({ file, ...h })),
    );
}

if (require.main === module) {
  const targets = process.argv.slice(2);
  const hits = scan(targets.length ? targets : SCOPE);
  if (hits.length) {
    console.error(`check:lang — найдено непереведённых строк: ${hits.length}\n`);
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.text.slice(0, 120)}`);
    process.exit(1);
  }
  console.log("check:lang — чисто, кириллицы в user-facing коде нет");
}

module.exports = { SCOPE, stripComments, findCyrillic, scan };
