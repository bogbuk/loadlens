/* Детектор непереведённых строк: падает, если в user-facing коде осталась кириллица.
   Комментарии срезаются — их перевод вне объёма (см. spec 2026-07-20-english-localization-design). */
const fs = require("node:fs");
const path = require("node:path");

// Директории в объёме локализации — обходятся рекурсивно, .spec.ts/.test.js исключены.
const SCOPE = [
  "extension",
  "shared",
  "backend/src",
];

// Каталоги, которые не обходим вообще: extension/vendor и backend/shared — автокопии
// из shared/ (npm run sync:shared), проверка дала бы дубли находок из канона; node_modules/
// .git/.superpowers/.claude — не наш код.
const EXCLUDE_PATHS = new Set(["extension/vendor", "backend/shared"]);
const EXCLUDE_DIR_NAMES = new Set(["node_modules", ".git", ".superpowers", ".claude"]);

// Посимвольный сканер вместо двух регэкспов: регэкспы не понимают границ строковых
// литералов, поэтому "//" или "/*" внутри строки ошибочно считались началом комментария
// (резали остаток строки/файла). Состояния: код / "..." / '...' / `...` / regex-литерал
// / построчный комментарий / блочный комментарий / HTML-комментарий <!-- -->.
// Экранирование \ внутри строк и regex учитывается. Символы комментария выбрасываются
// посимвольно (не заменяются пробелом), переводы строк внутри комментариев сохраняются
// как есть — номера строк в findCyrillic не должны смещаться.
// Упрощение: содержимое шаблонной строки `...` целиком считается строкой — интерполяция
// ${...} внутри неё рекурсивно не разбирается (в рамках этой задачи это не требуется).
// Следствие: комментарий внутри ${...} не срезается, поэтому кириллица в таком
// комментарии даёт ложноположительную находку (шум, не пропуск) — принято как есть.
// Regex vs деление: "/" открывает regex-литерал, если последний значимый символ перед
// ним отсутствует (начало файла) либо входит в REGEX_PRECEDING_CHARS, либо последнее
// слово перед ним — один из REGEX_PRECEDING_KEYWORDS; иначе это деление. Внутри
// regex-литерала учитывается экранирование \ и класс символов [...] (внутри класса "/"
// литерал не закрывает). Известное ограничение: это эвристика по предыдущему значимому
// токену, а не полноценный парсер JS — в экзотических случаях (например, ASI после
// строки/регэкспа без ";") она может ошибиться и принять регэксп за деление или наоборот.
const REGEX_PRECEDING_CHARS = "(,=:[!&|?{};+-*%<>~^";
const REGEX_PRECEDING_KEYWORDS = [
  "return", "typeof", "case", "in", "of", "new", "delete", "void",
  "throw", "do", "else", "instanceof", "yield", "await",
];

// Смотрит на уже накопленный код (без комментариев) и решает, ждёт ли предыдущий
// значимый токен regex-литерал (true) или "/" — это деление (false).
function regexAllowedBefore(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true; // начало файла
  const ch = out[j];
  if (REGEX_PRECEDING_CHARS.includes(ch)) return true;
  if (!/[A-Za-z0-9_$]/.test(ch)) return false;
  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--;
  const word = out.slice(k + 1, j + 1);
  return REGEX_PRECEDING_KEYWORDS.includes(word);
}

function stripComments(src) {
  const s = String(src);
  let out = "";
  let i = 0;
  const n = s.length;
  let state = "code"; // code | dq | sq | tpl | regex | line | block | html
  let inRegexClass = false; // true внутри [...] regex-литерала
  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];
    if (state === "code") {
      if (c === '"') {
        state = "dq";
        out += c;
        i++;
      } else if (c === "'") {
        state = "sq";
        out += c;
        i++;
      } else if (c === "`") {
        state = "tpl";
        out += c;
        i++;
      } else if (c === "/" && c2 === "/") {
        state = "line";
        i += 2;
      } else if (c === "/" && c2 === "*") {
        state = "block";
        i += 2;
      } else if (c === "/" && regexAllowedBefore(out)) {
        state = "regex";
        out += c;
        i++;
      } else if (c === "<" && s.slice(i, i + 4) === "<!--") {
        state = "html";
        i += 4;
      } else {
        out += c;
        i++;
      }
    } else if (state === "dq" || state === "sq" || state === "tpl") {
      const quote = state === "dq" ? '"' : state === "sq" ? "'" : "`";
      if (c === "\\") {
        out += c + (c2 !== undefined ? c2 : "");
        i += 2;
      } else if (c === quote) {
        out += c;
        state = "code";
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === "regex") {
      if (c === "\\") {
        out += c + (c2 !== undefined ? c2 : "");
        i += 2;
      } else if (c === "\n") {
        // Незакрытый regex-литерал (строка обрывается раньше) — защитный сброс,
        // чтобы не съесть остаток файла в состоянии regex.
        state = "code";
        inRegexClass = false;
        out += c;
        i++;
      } else if (inRegexClass) {
        if (c === "]") inRegexClass = false;
        out += c;
        i++;
      } else if (c === "[") {
        inRegexClass = true;
        out += c;
        i++;
      } else if (c === "/") {
        state = "code";
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === "line") {
      if (c === "\n") {
        out += c;
        state = "code";
        i++;
      } else {
        i++;
      }
    } else if (state === "block") {
      if (c === "*" && c2 === "/") {
        state = "code";
        i += 2;
      } else {
        if (c === "\n") out += c;
        i++;
      }
    } else if (state === "html") {
      if (c === "-" && s.slice(i, i + 3) === "-->") {
        state = "code";
        i += 3;
      } else {
        if (c === "\n") out += c;
        i++;
      }
    }
  }
  return out;
}

// JSON не поддерживает нативные комментарии. Проектная конвенция — dev-facing описание
// в поле "_comment" (seed/фикстуры), это НЕ user-facing текст. stripComments не умеет
// резать это (не JS/HTML-комментарий), поэтому findCyrillic пропускает такие строки
// отдельно — тот же смысл, что и у обычного комментария, просто в JSON-синтаксисе.
const JSON_COMMENT_KEY = /^"_comment"\s*:/;

function findCyrillic(src) {
  const out = [];
  String(src).split("\n").forEach((text, i) => {
    const trimmed = text.trim();
    if (JSON_COMMENT_KEY.test(trimmed)) return;
    if (/[А-Яа-яЁё]/.test(text)) out.push({ line: i + 1, text: trimmed });
  });
  return out;
}

function expand(target) {
  const normalized = String(target).split(path.sep).join("/");
  if (EXCLUDE_PATHS.has(normalized)) return [];
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [target];
  return fs.readdirSync(abs)
    .filter((e) => !EXCLUDE_DIR_NAMES.has(e))
    .flatMap((e) => expand(path.join(target, e)))
    .filter((f) => /\.(ts|js|html|json|css)$/.test(f) && !/\.spec\.ts$/.test(f) && !/\.test\.js$/.test(f));
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

module.exports = { SCOPE, EXCLUDE_PATHS, EXCLUDE_DIR_NAMES, stripComments, findCyrillic, expand, scan };
