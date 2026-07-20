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

// Посимвольный сканер вместо двух регэкспов: регэкспы не понимают границ строковых
// литералов, поэтому "//" или "/*" внутри строки ошибочно считались началом комментария
// (резали остаток строки/файла). Состояния: код / "..." / '...' / `...` / построчный
// комментарий / блочный комментарий / HTML-комментарий <!-- -->. Экранирование \ внутри
// строк учитывается. Символы комментария выбрасываются посимвольно (не заменяются
// пробелом), переводы строк внутри комментариев сохраняются как есть — номера строк в
// findCyrillic не должны смещаться.
// Упрощение: содержимое шаблонной строки `...` целиком считается строкой — интерполяция
// ${...} внутри неё рекурсивно не разбирается (в рамках этой задачи это не требуется).
// Следствие: комментарий внутри ${...} не срезается, поэтому кириллица в таком
// комментарии даёт ложноположительную находку (шум, не пропуск) — принято как есть.
// Известное ограничение: сканер не отличает regex-литерал от деления (полное различение
// требует отслеживания предыдущего значимого токена, что для линтера такого масштаба
// неоправданно). Точечное смягчение ниже закрывает только случай \// на границе
// экранированного слэша и закрывающего разделителя regex; "//" внутри regex-литерала
// без предшествующего \ по-прежнему может ошибочно приняться за построчный комментарий.
function stripComments(src) {
  const s = String(src);
  let out = "";
  let i = 0;
  const n = s.length;
  let state = "code"; // code | dq | sq | tpl | line | block | html
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
      } else if (c === "/" && c2 === "/" && s[i - 1] !== "\\") {
        // Точечное смягчение для regex-литералов вида /.../: экранированный слэш \/
        // вплотную к закрывающему разделителю (сам тоже /) даёт "\//", что без этой
        // проверки ошибочно принималось бы за начало построчного комментария.
        state = "line";
        i += 2;
      } else if (c === "/" && c2 === "*") {
        state = "block";
        i += 2;
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
