/* Сборка ZIP расширения для Chrome Web Store.
   Список файлов НЕ хардкодится — выводится из manifest.json (content_scripts, action.default_popup,
   icons) и из <script src>/<link href> в popup.html. Поэтому в пакет физически не может попасть
   мусор (*.test.js, __fixtures__, scratch) и не может потеряться файл, который расширение грузит.
   Отсутствие любого объявленного файла — ошибка сборки, а не молчаливо битый пакет. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const DIST = path.join(ROOT, "dist");

// Файлы, которые грузит сама HTML-страница (манифест о них не знает).
function assetsFromHtml(htmlRel) {
  const src = fs.readFileSync(path.join(EXT, htmlRel), "utf8");
  const out = [];
  for (const re of [/<script[^>]+src="([^"]+)"/g, /<link[^>]+href="([^"]+)"/g]) {
    let m;
    while ((m = re.exec(src))) {
      if (!/^(https?:)?\/\//.test(m[1])) out.push(m[1]); // внешние URL пропускаем
    }
  }
  return out;
}

function collect() {
  const mf = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  const files = new Set(["manifest.json"]);

  for (const cs of mf.content_scripts || []) {
    for (const f of [...(cs.js || []), ...(cs.css || [])]) files.add(f);
  }
  for (const f of Object.values(mf.icons || {})) files.add(f);
  for (const f of Object.values(mf.web_accessible_resources || {}).flat?.() || []) files.add(f);

  const popup = mf.action && mf.action.default_popup;
  if (popup) {
    files.add(popup);
    for (const f of assetsFromHtml(popup)) files.add(f);
  }
  return { version: mf.version, files: [...files].sort() };
}

function main() {
  const { version, files } = collect();

  const missing = files.filter((f) => !fs.existsSync(path.join(EXT, f)));
  if (missing.length) {
    console.error("package:ext — объявленные файлы не найдены:\n  " + missing.join("\n  "));
    process.exit(1);
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  const stage = path.join(DIST, "extension");
  for (const f of files) {
    const dst = path.join(stage, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(EXT, f), dst);
  }

  const zip = path.join(DIST, `loadlens-${version}.zip`);
  execFileSync("zip", ["-r", "-q", "-X", zip, "."], { cwd: stage });

  const kb = (fs.statSync(zip).size / 1024).toFixed(1);
  console.log(`package:ext — ${path.relative(ROOT, zip)} (${files.length} файлов, ${kb} КБ)`);
  for (const f of files) console.log("  " + f);
}

if (require.main === module) main();

module.exports = { collect };
