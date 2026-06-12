#!/usr/bin/env node
/* Копирует общие shared-модули в extension/vendor/ для упаковки расширения
   (content scripts грузят только файлы внутри каталога расширения) и генерирует
   markets.seed.js (глобал LLSEED) из markets.seed.json для офлайн-фолбэка geo.
   Канонический источник — /shared. Запускать после правок shared/*.js. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SHARED = path.join(ROOT, "shared");
const VENDOR = path.join(ROOT, "extension", "vendor");

fs.mkdirSync(VENDOR, { recursive: true });

const FILES = ["load.model.js", "scoring.js", "planner.js"];
const BANNER = "/* AUTO-GENERATED копия из /shared — НЕ РЕДАКТИРОВАТЬ. Источник правды: shared/. Пересобрать: npm run sync:shared */\n";
for (const f of FILES) {
  const src = fs.readFileSync(path.join(SHARED, f), "utf8");
  fs.writeFileSync(path.join(VENDOR, f), BANNER + src);
}

// seed JSON -> JS-глобал LLSEED (чтобы грузить как content script без async fetch)
const seed = fs.readFileSync(path.join(SHARED, "markets.seed.json"), "utf8");
const seedJs = BANNER +
  "const LLSEED = " + seed.trim() + ";\n" +
  "if (typeof globalThis !== 'undefined') globalThis.LLSEED = LLSEED;\n" +
  "if (typeof module !== 'undefined' && module.exports) module.exports = LLSEED;\n";
fs.writeFileSync(path.join(VENDOR, "markets.seed.js"), seedJs);

console.log(`synced ${FILES.length + 1} files -> extension/vendor/`);
