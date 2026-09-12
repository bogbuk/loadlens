# Alert Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-алерты уходят по пользовательским правилам (ключевые слова в comments, ставка, deadhead, штаты назначения, прицеп, брокер, скоринг), а не только по «green + фильтр прицепа».

**Architecture:** Чистый модуль `extension/alert-rules.js` (`LLRULES`, образец — `LLEQUIP`) нормализует storage-конфиг и отбирает грузы (`select`). `content.render` подменяет им текущий отбор green-грузов перед `LLALERT.push`; `LLALERT` пробрасывает `ruleName` в payload; бэкенд-релей получает одно опциональное поле и печатает имя правила первой строкой сообщения. Правила редактируются в попапе, хранятся в `chrome.storage.local.ll_alert_rules`.

**Tech Stack:** MV3-расширение (vanilla JS, `node --test`), NestJS + class-validator + jest.

**Spec:** `docs/superpowers/specs/2026-09-12-alert-rules-engine-design.md`

## Global Constraints

- Внутри правила — AND по заданным условиям; `null`/пустой список = условие выключено. Между правилами — OR. Нет включённых правил → старое поведение (green + `ll_equip_filter`).
- Ключевые слова: обе стороны нормализуются `lower-case` + удаление `-`, пробелов и `.`; сравнение по подстроке.
- `deadheadMiles == null` → считаем 0. `minRpm` = `rate / (loadedMiles + deadhead)`.
- Лимиты `normalize`: ≤20 правил, ≤30 слов в списке, слово ≤40 символов, MC ≤24 цифр, `name` ≤60.
- `ruleName` в payload и DTO: ≤60 символов, без `\n\r`.
- User-facing строки расширения и бэкенда — **только английский** (`npm run check:lang` падает на кириллице вне комментариев). Комментарии в коде — по-русски, как в репозитории.
- Коммиты без упоминания AI (правило пользователя). Тесты: корень `npm test`, бэкенд `cd backend && npm test`.
- Файл задачи `tasks/0013-alert-rules-engine.md` создаётся в Task 1 и обновляется по ходу.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `extension/alert-rules.js` (новый) | `LLRULES`: `normalize`, `normKeyword`, `active`, `matches`, `select`. Без DOM/сети. |
| `extension/alert-rules.test.js` (новый) | Тесты чистого модуля. |
| `extension/alerts.js` | `push` принимает `[{load, rule}]`, `toPayload(load, rule)` добавляет `ruleName`. |
| `extension/alerts.test.js` | Кейсы на `ruleName` и новый формат `push`. |
| `backend/src/telegram/dto/notify.dto.ts` | Поле `ruleName?`. |
| `backend/src/telegram/telegram.service.ts` | `formatAlertMessage`: строка `🎯 <ruleName>`. |
| `backend/src/telegram/telegram.service.spec.ts` | Кейс на `ruleName`. |
| `extension/content.js` | Стейт `alertRules`, чтение/onChanged, замена отбора в `render`. |
| `extension/manifest.json` | Подключить `alert-rules.js` перед `content.js`. |
| `extension/popup.html`, `extension/popup.js` | Блок «Alert rules» в секции Telegram: список + редактор. |
| `CLAUDE.md`, `tasks/0013-alert-rules-engine.md` | Документация и трекинг. |

---

### Task 1: `LLRULES.normalize` / `normKeyword` / `active`

**Files:**
- Create: `extension/alert-rules.js`
- Create: `extension/alert-rules.test.js`
- Create: `tasks/0013-alert-rules-engine.md`

**Interfaces:**
- Consumes: `LLEQUIP.normalize(v) → string[]|null` из `extension/equip-filter.js` (глобал или `require`).
- Produces: `LLRULES.normalize(raw) → {version:1, rules: Rule[]}`, `LLRULES.normKeyword(s) → string`, `LLRULES.active(cfg) → Rule[]`, `LLRULES.LIMITS`. `Rule` = `{id, name, enabled, keywordsAny, keywordsNone, minRate, minRpm, maxDeadhead, minMiles, maxMiles, equipment, destStates, brokersAllow, brokersBlock, minCredit, score}`.

- [ ] **Step 1: Создать файл задачи**

```markdown
# Task: движок правил Telegram-алертов
Date: 2026-09-12
Status: in_progress

## Checklist
- [ ] LLRULES.normalize / normKeyword / active + тесты
- [ ] LLRULES.matches / select + тесты
- [ ] LLALERT: {load, rule} + ruleName
- [ ] backend: NotifyItemDto.ruleName + formatAlertMessage
- [ ] content.js + manifest: отбор через LLRULES
- [ ] popup: список правил + редактор
- [ ] CLAUDE.md
### Verification
- [ ] npm test (корень) + backend npm test
- [ ] build backend
- [ ] commit & push
```

Записать в `tasks/0013-alert-rules-engine.md`.

- [ ] **Step 2: Написать падающие тесты**

`extension/alert-rules.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");

globalThis.LLEQUIP = require("./equip-filter.js");
const LLRULES = require("./alert-rules.js");

test("normKeyword: lower-case, без дефисов/пробелов/точек", () => {
  assert.strictEqual(LLRULES.normKeyword("In-Bond"), "inbond");
  assert.strictEqual(LLRULES.normKeyword(" IN BOND "), "inbond");
  assert.strictEqual(LLRULES.normKeyword("T.S.A."), "tsa");
  assert.strictEqual(LLRULES.normKeyword(null), "");
});

test("normalize: мусорный storage → пустой список", () => {
  for (const raw of [undefined, null, "x", 5, [], {}, { rules: "no" }, { rules: [null, 1, {}] }]) {
    assert.deepStrictEqual(LLRULES.normalize(raw), { version: 1, rules: [] });
  }
});

test("normalize: правило приводится к канону, дефолты подставляются", () => {
  const cfg = LLRULES.normalize({ rules: [{ id: "r_1", name: "  Bonded ", keywordsAny: ["bonded", "", "TWIC", "bonded"] }] });
  assert.deepStrictEqual(cfg.rules[0], {
    id: "r_1", name: "Bonded", enabled: true,
    keywordsAny: ["bonded", "TWIC"], keywordsNone: [],
    minRate: null, minRpm: null, maxDeadhead: null, minMiles: null, maxMiles: null,
    equipment: null, destStates: [], brokersAllow: [], brokersBlock: [], minCredit: null, score: "any",
  });
});

test("normalize: числа, штаты, MC, equipment, score", () => {
  const r = LLRULES.normalize({ rules: [{
    id: "r_2", name: "", enabled: false, minRate: "2500", minRpm: -1, maxDeadhead: "abc",
    destStates: ["tx", "Ok", "xyz", ""], brokersAllow: ["MC-123456", "12 34"], brokersBlock: [],
    equipment: ["V", ""], minCredit: 90, score: "weird",
  }] }).rules[0];
  assert.strictEqual(r.name, "Rule");
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(r.minRate, 2500);
  assert.strictEqual(r.minRpm, null);
  assert.strictEqual(r.maxDeadhead, null);
  assert.deepStrictEqual(r.destStates, ["TX", "OK"]);
  assert.deepStrictEqual(r.brokersAllow, ["123456", "1234"]);
  assert.deepStrictEqual(r.equipment, ["V"]);
  assert.strictEqual(r.minCredit, 90);
  assert.strictEqual(r.score, "any");
});

test("normalize: лимиты — 20 правил, 30 слов, слово 40 символов, MC 24 цифры, имя 60", () => {
  const rules = Array.from({ length: 25 }, (_, i) => ({
    id: `r_${i}`, name: "n".repeat(100),
    keywordsAny: Array.from({ length: 40 }, (_, j) => `w${j}` + "x".repeat(50)),
    brokersBlock: ["9".repeat(30)],
  }));
  const cfg = LLRULES.normalize({ rules });
  assert.strictEqual(cfg.rules.length, 20);
  assert.strictEqual(cfg.rules[0].name.length, 60);
  assert.strictEqual(cfg.rules[0].keywordsAny.length, 30);
  assert.strictEqual(cfg.rules[0].keywordsAny[0].length, 40);
  assert.strictEqual(cfg.rules[0].brokersBlock[0].length, 24);
});

test("active: только enabled; принимает сырой storage", () => {
  const rules = [{ id: "a", enabled: true }, { id: "b", enabled: false }, { id: "c" }];
  assert.deepStrictEqual(LLRULES.active({ rules }).map((r) => r.id), ["a", "c"]);
  assert.deepStrictEqual(LLRULES.active(null), []);
});
```

- [ ] **Step 3: Запустить, убедиться, что падает**

Run: `node --test extension/alert-rules.test.js`
Expected: FAIL — `Cannot find module './alert-rules.js'`.

- [ ] **Step 4: Реализация**

`extension/alert-rules.js`:

```js
/* LoadLens — правила Telegram-алертов (ll_alert_rules). Чистый модуль: без DOM и сети.
   Внутри правила AND по заданным условиям (null / [] = условие выключено), между правилами OR.
   Нет включённых правил → content.js использует старый отбор (green + фильтр прицепа).
   Спека: docs/superpowers/specs/2026-09-12-alert-rules-engine-design.md */
const LLRULES = (() => {
  "use strict";
  const EQ = (typeof LLEQUIP !== "undefined") ? LLEQUIP
    : (typeof require === "function" ? require("./equip-filter.js") : null);

  const LIMITS = { rules: 20, words: 30, word: 40, mc: 24, name: 60, id: 40 };
  const SCORES = ["any", "green", "green_amber"];

  // нормализация ключевого слова: lower-case, без дефисов/пробелов/точек → "in-bond" ≡ "inbond" ≡ "IN BOND"
  function normKeyword(s) { return String(s || "").toLowerCase().replace(/[\s\-.]+/g, ""); }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return (isFinite(n) && n >= 0) ? n : null;
  }
  // список строк: trim, обрезка, дедуп, лимит. map — доп. преобразование, keep — фильтр валидности
  function list(arr, map, keep) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const v of arr) {
      let s = String(v == null ? "" : v).trim();
      if (map) s = map(s);
      if (!s || (keep && !keep(s)) || out.includes(s)) continue;
      out.push(s);
      if (out.length >= LIMITS.words) break;
    }
    return out;
  }
  const words = (arr) => list(arr, (s) => s.slice(0, LIMITS.word));
  const mcs = (arr) => list(arr, (s) => s.replace(/\D+/g, "").slice(0, LIMITS.mc));
  const states = (arr) => list(arr, (s) => s.toUpperCase(), (s) => /^[A-Z]{2}$/.test(s));

  function normalizeRule(r) {
    if (!r || typeof r !== "object" || !r.id) return null;
    const name = String(r.name || "").trim().slice(0, LIMITS.name);
    return {
      id: String(r.id).slice(0, LIMITS.id),
      name: name || "Rule",
      enabled: r.enabled !== false,
      keywordsAny: words(r.keywordsAny),
      keywordsNone: words(r.keywordsNone),
      minRate: num(r.minRate), minRpm: num(r.minRpm),
      maxDeadhead: num(r.maxDeadhead), minMiles: num(r.minMiles), maxMiles: num(r.maxMiles),
      equipment: EQ ? EQ.normalize(Array.isArray(r.equipment) ? r.equipment : null) : null,
      destStates: states(r.destStates),
      brokersAllow: mcs(r.brokersAllow), brokersBlock: mcs(r.brokersBlock),
      minCredit: num(r.minCredit),
      score: SCORES.includes(r.score) ? r.score : "any",
    };
  }

  // storage → канон. Любой мусор (старый формат, не объект) → пустой список правил.
  function normalize(raw) {
    const src = (raw && typeof raw === "object" && Array.isArray(raw.rules)) ? raw.rules : [];
    return { version: 1, rules: src.map(normalizeRule).filter(Boolean).slice(0, LIMITS.rules) };
  }

  function active(cfg) { return normalize(cfg).rules.filter((r) => r.enabled); }

  return { LIMITS, SCORES, normKeyword, normalize, active };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLRULES; }
if (typeof globalThis !== "undefined") globalThis.LLRULES = LLRULES;
```

- [ ] **Step 5: Запустить тесты**

Run: `node --test extension/alert-rules.test.js`
Expected: 6 passed.

- [ ] **Step 6: Коммит**

```bash
git add extension/alert-rules.js extension/alert-rules.test.js tasks/0013-alert-rules-engine.md
git commit -m "feat(extension): LLRULES — нормализация правил алертов"
```

Отметить первый пункт чеклиста в `tasks/0013-alert-rules-engine.md`.

---

### Task 2: `LLRULES.matches` / `select`

**Files:**
- Modify: `extension/alert-rules.js`
- Modify: `extension/alert-rules.test.js`

**Interfaces:**
- Consumes: `Rule` из Task 1; `LLEQUIP.matches(filter, equipment)`.
- Produces: `LLRULES.matches(rule, load, ctx) → boolean`, `LLRULES.select(rules, loads, ctx) → [{load, rule}]`. `ctx = { equipFilter: string[]|null, badgeFor?: (load) => {level} }`.

- [ ] **Step 1: Добавить падающие тесты**

Дописать в `extension/alert-rules.test.js`:

```js
const LOAD = {
  board: "dat", originMarket: "LOS ANGELES_CA", destMarket: "DALLAS_TX", equipment: "V",
  rate: 4000, loadedMiles: 1400, deadheadMiles: 100, brokerMc: "MC-123456", creditScore: 92,
  comments: "In-Bond shipment, TWIC required. No hazmat.",
};
const rule = (over) => LLRULES.normalize({ rules: [{ id: "r", ...over }] }).rules[0];
const ctx = { equipFilter: null };

test("matches: правило без условий матчит всё, что прошло equipment", () => {
  assert.ok(LLRULES.matches(rule({}), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({}), LOAD, { equipFilter: ["R"] }));       // глобальный фильтр
  assert.ok(LLRULES.matches(rule({ equipment: ["V"] }), LOAD, { equipFilter: ["R"] })); // своё equipment важнее
});

test("matches: keywordsAny — нормализованная подстрока; нет comments → false", () => {
  assert.ok(LLRULES.matches(rule({ keywordsAny: ["inbond"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ keywordsAny: ["bonded", "twic"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ keywordsAny: ["airport"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ keywordsAny: ["twic"] }), { ...LOAD, comments: null }, ctx));
});

test("matches: keywordsNone — исключает; пустые comments проходят", () => {
  assert.ok(!LLRULES.matches(rule({ keywordsNone: ["hazmat"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ keywordsNone: ["team"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ keywordsNone: ["hazmat"] }), { ...LOAD, comments: "" }, ctx));
});

test("matches: AND внутри правила", () => {
  assert.ok(LLRULES.matches(rule({ keywordsAny: ["twic"], maxDeadhead: 150 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ keywordsAny: ["twic"], maxDeadhead: 50 }), LOAD, ctx));
});

test("matches: minRate / minRpm (с deadhead) / miles", () => {
  assert.ok(LLRULES.matches(rule({ minRate: 4000 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minRate: 4001 }), LOAD, ctx));
  // 4000 / (1400 + 100) = 2.67
  assert.ok(LLRULES.matches(rule({ minRpm: 2.6 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minRpm: 2.7 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minRpm: 1 }), { ...LOAD, loadedMiles: 0, deadheadMiles: 0 }, ctx));
  assert.ok(LLRULES.matches(rule({ minMiles: 1400, maxMiles: 1400 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minMiles: 1401 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ maxMiles: 1399 }), LOAD, ctx));
});

test("matches: deadheadMiles null → считаем 0, груз проходит maxDeadhead", () => {
  assert.ok(LLRULES.matches(rule({ maxDeadhead: 10 }), { ...LOAD, deadheadMiles: null }, ctx));
  assert.ok(!LLRULES.matches(rule({ maxDeadhead: 10 }), LOAD, ctx));
});

test("matches: destStates по хвосту destMarket", () => {
  assert.ok(LLRULES.matches(rule({ destStates: ["tx", "ok"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ destStates: ["CA"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ destStates: ["TX"] }), { ...LOAD, destMarket: "" }, ctx));
});

test("matches: брокер — block побеждает allow; minCredit", () => {
  assert.ok(LLRULES.matches(rule({ brokersAllow: ["123456"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ brokersAllow: ["999"] }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ brokersAllow: ["123456"], brokersBlock: ["123456"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ brokersBlock: ["999"] }), LOAD, ctx));
  assert.ok(LLRULES.matches(rule({ brokersBlock: ["999"] }), { ...LOAD, brokerMc: null }, ctx));
  assert.ok(!LLRULES.matches(rule({ brokersAllow: ["999"] }), { ...LOAD, brokerMc: null }, ctx));
  assert.ok(LLRULES.matches(rule({ minCredit: 90 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minCredit: 95 }), LOAD, ctx));
  assert.ok(!LLRULES.matches(rule({ minCredit: 1 }), { ...LOAD, creditScore: null }, ctx));
});

test("matches: score через badgeFor; при 'any' badgeFor не вызывается", () => {
  let calls = 0;
  const bf = (lvl) => ({ equipFilter: null, badgeFor: () => { calls++; return { level: lvl }; } });
  assert.ok(LLRULES.matches(rule({ score: "any" }), LOAD, bf("red")));
  assert.strictEqual(calls, 0);
  assert.ok(LLRULES.matches(rule({ score: "green" }), LOAD, bf("green")));
  assert.ok(!LLRULES.matches(rule({ score: "green" }), LOAD, bf("amber")));
  assert.ok(LLRULES.matches(rule({ score: "green_amber" }), LOAD, bf("amber")));
  assert.ok(!LLRULES.matches(rule({ score: "green_amber" }), LOAD, bf("red")));
  assert.ok(!LLRULES.matches(rule({ score: "green" }), LOAD, { equipFilter: null })); // нет badgeFor → не матчит
});

test("select: OR между правилами, первое совпавшее; несовпавшие грузы выпадают", () => {
  const rules = LLRULES.normalize({ rules: [
    { id: "kw", name: "Bonded", keywordsAny: ["bonded"], keywordsNone: ["hazmat"] },
    { id: "rpm", name: "$8+", minRpm: 8 },
  ] }).rules;
  const rich = { ...LOAD, comments: "", rate: 15000 };                         // 15000/1500 = 10
  const dull = { ...LOAD, comments: "" };
  const hits = LLRULES.select(rules, [LOAD, rich, dull], ctx);
  assert.deepStrictEqual(hits.map((h) => [h.load, h.rule.id]), [[rich, "rpm"]]); // LOAD: "bonded" не подстрока "inbond", hazmat исключает; rpm 2.67 < 8
  assert.deepStrictEqual(LLRULES.select([], [LOAD], ctx), []);
  assert.deepStrictEqual(LLRULES.select(rules, null, ctx), []);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test extension/alert-rules.test.js`
Expected: новые кейсы FAIL — `LLRULES.matches is not a function`.

- [ ] **Step 3: Реализация**

Добавить в `extension/alert-rules.js` перед `return { ... }`:

```js
  // Груз проходит правило, если все ЗАДАННЫЕ условия выполнены. ctx.badgeFor — ленивый скоринг
  // (вызывается только при score !== "any"), ctx.equipFilter — глобальный фильтр прицепа.
  function matches(rule, load, ctx) {
    ctx = ctx || {};
    if (!rule || !load) return false;
    const eqFilter = (rule.equipment && rule.equipment.length) ? rule.equipment : (ctx.equipFilter || null);
    if (EQ && !EQ.matches(eqFilter, load.equipment)) return false;

    const text = normKeyword(load.comments);
    if (rule.keywordsAny.length && !(text && rule.keywordsAny.some((w) => text.includes(normKeyword(w))))) return false;
    if (rule.keywordsNone.length && text && rule.keywordsNone.some((w) => text.includes(normKeyword(w)))) return false;

    const rate = Number(load.rate) || 0;
    const miles = Number(load.loadedMiles) || 0;
    const dh = Number(load.deadheadMiles) || 0;          // null → 0: без DH-миль груз не выпадает
    if (rule.minRate != null && rate < rule.minRate) return false;
    if (rule.minRpm != null) {
      const total = miles + dh;                            // та же формула, что LLSCORE.trueRpm
      if (!(total > 0) || rate / total < rule.minRpm) return false;
    }
    if (rule.maxDeadhead != null && dh > rule.maxDeadhead) return false;
    if (rule.minMiles != null && miles < rule.minMiles) return false;
    if (rule.maxMiles != null && miles > rule.maxMiles) return false;

    if (rule.destStates.length) {
      const st = String(load.destMarket || "").split("_").pop();
      if (!st || !rule.destStates.includes(st)) return false;
    }

    const mc = String(load.brokerMc || "").replace(/\D+/g, "");
    if (rule.brokersBlock.length && mc && rule.brokersBlock.includes(mc)) return false;
    if (rule.brokersAllow.length && !rule.brokersAllow.includes(mc)) return false;
    if (rule.minCredit != null) {
      const c = load.creditScore == null ? NaN : Number(load.creditScore);
      if (isNaN(c) || c < rule.minCredit) return false;
    }

    if (rule.score !== "any") {
      const b = typeof ctx.badgeFor === "function" ? ctx.badgeFor(load) : null;
      const lvl = b && b.level;
      if (rule.score === "green" && lvl !== "green") return false;
      if (rule.score === "green_amber" && lvl !== "green" && lvl !== "amber") return false;
    }
    return true;
  }

  // Для каждого груза — первое совпавшее правило. Несовпавшие выпадают.
  function select(rules, loads, ctx) {
    const out = [];
    for (const load of (Array.isArray(loads) ? loads : [])) {
      const r = (rules || []).find((rule) => matches(rule, load, ctx));
      if (r) out.push({ load, rule: r });
    }
    return out;
  }
```

И расширить экспорт: `return { LIMITS, SCORES, normKeyword, normalize, active, matches, select };`

- [ ] **Step 4: Запустить тесты**

Run: `node --test extension/alert-rules.test.js`
Expected: 16 passed.

- [ ] **Step 5: Коммит**

```bash
git add extension/alert-rules.js extension/alert-rules.test.js
git commit -m "feat(extension): LLRULES.matches/select — отбор грузов по правилам"
```

---

### Task 3: `LLALERT` — `{load, rule}` и `ruleName`

**Files:**
- Modify: `extension/alerts.js`
- Modify: `extension/alerts.test.js`

**Interfaces:**
- Consumes: `LLRULES.select` output `[{load, rule}]`.
- Produces: `LLALERT.push(hits)` где `hits` = `[{load, rule}]` **или** голые грузы (обратная совместимость); `LLALERT.toPayload(load, rule?)` с полем `ruleName` (≤60, без переводов строк) при заданном `rule`.

- [ ] **Step 1: Добавить падающие тесты**

Дописать в `extension/alerts.test.js`:

```js
test("toPayload: ruleName пробрасывается (обрезка 60, без переводов строк); без rule — поля нет", () => {
  const p = LLALERT.toPayload(LOAD, { id: "r", name: "Bonded /\nTWIC" });
  assert.strictEqual(p.ruleName, "Bonded / TWIC");
  const long = LLALERT.toPayload(LOAD, { id: "r", name: "x".repeat(100) });
  assert.strictEqual(long.ruleName.length, 60);
  assert.strictEqual(LLALERT.toPayload(LOAD).ruleName, undefined);
  assert.strictEqual(LLALERT.toPayload(LOAD, { id: "r", name: "" }).ruleName, undefined);
});

test("push: принимает {load, rule} и голый груз; ruleName уходит на сервер", async () => {
  _sent = [];
  LLALERT._setStatus({ linked: true, enabled: true, configured: true });
  const other = { ...LOAD, rate: 2600 };
  const r = await LLALERT.push([{ load: { ...LOAD, rate: 2500 }, rule: { id: "r", name: "Bonded" } }, other]);
  assert.strictEqual(r.sent, 2);
  assert.strictEqual(_sent[0][0].ruleName, "Bonded");
  assert.strictEqual(_sent[0][1].ruleName, undefined);
  assert.strictEqual(_sent[0][1].rate, 2600);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test extension/alerts.test.js`
Expected: два новых кейса FAIL (`ruleName` undefined / `sent` не 2).

- [ ] **Step 3: Реализация**

В `extension/alerts.js`:

1. В `toPayload(l)` → `toPayload(l, rule)`; после строки с `contactPhone` добавить:

```js
    const ruleName = rule && rule.name ? String(rule.name).replace(/[\n\r]+/g, " ").trim().slice(0, 60) : "";
    if (ruleName) item.ruleName = ruleName;
```

2. В `push(loads)` заменить тело отбора и маппинга:

```js
  // Принимает [{load, rule}] (отбор LLRULES) или голые грузы (старый вызов). Шлёт новые на backend-релей.
  async function push(hits) {
    if (!hits || !hits.length) return { sent: 0 };
    const s = await refreshStatus();
    if (!s.configured || !s.linked || !s.enabled) return { sent: 0 };

    const pairs = hits.map((h) => (h && h.load) ? h : { load: h, rule: null });
    const fresh = pairs.filter((p) => p.load && !sentKeys.has(keyFor(p.load)));
    if (!fresh.length) return { sent: 0 };

    const items = fresh.map((p) => toPayload(p.load, p.rule)).filter(validItem).slice(0, MAX_BATCH);
    if (!items.length) return { sent: 0 };

    // оптимистично помечаем отправленными (повторный показ той же выдачи не спамит сеть)
    items.forEach((it) => sentKeys.add(it.dedupKey));
    const res = typeof LLAPI !== "undefined" ? await LLAPI.notifyAlerts(items) : null;
    return res || { sent: 0 };
  }
```

3. Обновить шапку-комментарий файла: «Принимает `{load, rule}` от `LLRULES.select`; `ruleName` — имя сработавшего правила, печатается ботом первой строкой».

- [ ] **Step 4: Запустить тесты**

Run: `node --test extension/alerts.test.js`
Expected: все passed (старые кейсы не тронуты: `push([LOAD])` работает через голый груз).

- [ ] **Step 5: Коммит**

```bash
git add extension/alerts.js extension/alerts.test.js
git commit -m "feat(extension): LLALERT принимает {load, rule}, шлёт ruleName"
```

---

### Task 4: Бэкенд — `ruleName` в DTO и сообщении

**Files:**
- Modify: `backend/src/telegram/dto/notify.dto.ts`
- Modify: `backend/src/telegram/telegram.service.ts:31-54`
- Modify: `backend/src/telegram/telegram.service.spec.ts`

**Interfaces:**
- Consumes: payload `NotifyItemDto` от `LLALERT`.
- Produces: `NotifyItemDto.ruleName?: string`; `formatAlertMessage` с первой строкой `🎯 <ruleName>` при наличии.

- [ ] **Step 1: Добавить падающий тест**

В `backend/src/telegram/telegram.service.spec.ts`, внутрь `describe('formatAlertMessage', ...)`:

```ts
  it('ruleName — первой строкой 🎯; без него сообщение начинается с 🟢', () => {
    const withRule = formatAlertMessage({ ...ITEM, ruleName: 'Bonded / TWIC' });
    expect(withRule.startsWith('🎯 Bonded / TWIC\n🟢 CHICAGO_IL → DALLAS_TX · R')).toBe(true);
    expect(formatAlertMessage(ITEM).startsWith('🟢 ')).toBe(true);
  });
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `cd backend && npx jest src/telegram/telegram.service.spec.ts -t "ruleName"`
Expected: FAIL (сообщение начинается с `🟢`).

- [ ] **Step 3: Реализация**

`backend/src/telegram/dto/notify.dto.ts` — в `NotifyItemDto` после `contactPhone`:

```ts
  // Имя сработавшего правила алертов (пользовательская строка из расширения). Печатается первой строкой.
  @IsOptional() @IsString() @MaxLength(60) @Matches(/^[^\n\r]{1,60}$/)
  ruleName?: string;
```

`backend/src/telegram/telegram.service.ts` — в `formatAlertMessage`:

```ts
  const ruleLine = l.ruleName ? `🎯 ${l.ruleName}\n` : '';
  const head = `${ruleLine}🟢 ${l.originMarket} → ${l.destMarket} · ${l.equipment}`;
```

(заменить существующую строку `const head = ...`).

- [ ] **Step 4: Запустить тесты и сборку**

Run: `cd backend && npx jest src/telegram && npm run build`
Expected: все passed, сборка без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/telegram/dto/notify.dto.ts backend/src/telegram/telegram.service.ts backend/src/telegram/telegram.service.spec.ts
git commit -m "feat(telegram): ruleName в NotifyItemDto и первой строкой сообщения"
```

---

### Task 5: `content.js` + `manifest.json` — отбор через `LLRULES`

**Files:**
- Modify: `extension/manifest.json:42`
- Modify: `extension/content.js:22` (стейт), `:528-533` (отбор в `render`), `:888-897` (boot), `:931` (onChanged)

**Interfaces:**
- Consumes: `LLRULES.active(cfg)`, `LLRULES.select(rules, loads, {equipFilter, badgeFor})`, `LLALERT.push([{load, rule}])`.
- Produces: стейт `alertRules` (канон `{version, rules}`), обновляемый из storage.

Тестов на `content.js` в репозитории нет (DOM-модуль); проверка — ручная в Chrome + `npm test` (чистые модули).

- [ ] **Step 1: manifest**

В `extension/manifest.json` в массив `content_scripts[0].js` после `"equip-filter.js",` вставить `"alert-rules.js",`.

- [ ] **Step 2: стейт**

В `extension/content.js` после строки 22 (`let equipFilter = null; ...`):

```js
  let alertRules = { version: 1, rules: [] }; // правила Telegram-алертов из попапа (ll_alert_rules); пусто → green+equip
```

- [ ] **Step 3: boot — чтение**

В `boot`, в `chrome.storage.local.get([...])` добавить ключ `"ll_alert_rules"` в оба места (деструктуризация и массив), затем после `equipFilter = LLEQUIP.normalize(ll_equip_filter);`:

```js
      if (typeof LLRULES !== "undefined") alertRules = LLRULES.normalize(ll_alert_rules);
```

- [ ] **Step 4: onChanged**

В `chrome.storage.onChanged.addListener` после строки `if (ch.ll_equip_filter) ...`:

```js
        if (ch.ll_alert_rules && typeof LLRULES !== "undefined") alertRules = LLRULES.normalize(ch.ll_alert_rules.newValue);
```

- [ ] **Step 5: отбор в render**

Заменить блок (строки 528–533):

```js
    // green + passEquip — те же грузы, что в «Выгодные сейчас». Шлём их в Telegram (фоновый канал,
    // гейт/дедуп/cap внутри LLALERT и на сервере). Считаем до early-return, чтобы работало и со свёрнутой панелью.
    const greens = loads.filter(passEquip)
      .map((l) => ({ l, b: LLSCORE.profitBadge(l, { costPerMile, dieselPrice, laneMedian: laneCache.get(laneKeyOf(l)), targetRpm: targetFor(l) }) }))
      .filter((d) => d.b.level === "green");
    if (typeof LLALERT !== "undefined") LLALERT.push(greens.map((d) => d.l)).catch(() => {});
```

на:

```js
    // Telegram-алерты. Есть включённые правила (ll_alert_rules) → отбор через LLRULES (OR между
    // правилами, AND внутри); нет → прежнее поведение: green + passEquip (те же, что «Выгодные сейчас»).
    // Гейт/дедуп/cap внутри LLALERT и на сервере. Считаем до early-return, чтобы работало и со свёрнутой панелью.
    const badgeFor = (l) => LLSCORE.profitBadge(l, { costPerMile, dieselPrice, laneMedian: laneCache.get(laneKeyOf(l)), targetRpm: targetFor(l) });
    const activeRules = (typeof LLRULES !== "undefined") ? LLRULES.active(alertRules) : [];
    const alertHits = activeRules.length
      ? LLRULES.select(activeRules, loads, { equipFilter, badgeFor })
      : loads.filter(passEquip).map((l) => ({ load: l, rule: null })).filter((d) => badgeFor(d.load).level === "green");
    if (typeof LLALERT !== "undefined") LLALERT.push(alertHits).catch(() => {});
```

- [ ] **Step 6: Проверка**

Run: `npm test`
Expected: sync:shared, check:lang, все тесты зелёные. Затем в Chrome: `chrome://extensions` → перезагрузить распакованное → открыть DAT-выдачу → в консоли нет ошибок `LLRULES is not defined`.

- [ ] **Step 7: Коммит**

```bash
git add extension/manifest.json extension/content.js
git commit -m "feat(extension): отбор Telegram-алертов через правила LLRULES"
```

---

### Task 6: Попап — список правил и редактор

**Files:**
- Modify: `extension/popup.html:48-57` (подключить `alert-rules.js`, контейнер уже есть — `#telegram`)
- Modify: `extension/popup.js:316-362` (`renderTelegram`) + новые функции

**Interfaces:**
- Consumes: `LLRULES.normalize`, `LLRULES.SCORES`, `LLRULES.LIMITS`, `EQUIP_TYPES`, `escA`, `LLAPI.telegramStatus/getMe`.
- Produces: `chrome.storage.local.ll_alert_rules` в каноне.

Тестов на popup нет (DOM); проверка ручная + `npm run check:lang` (строки — только английский).

- [ ] **Step 1: popup.html**

После `<script src="equip-filter.js"></script>` добавить `<script src="alert-rules.js"></script>`. В `<style>` добавить:

```css
  .rule { border:1px solid #e7ebef; border-radius:9px; padding:8px 10px; margin-top:8px; }
  .rule .hd { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .rule .hd b { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rule .sum { color:#6b7785; font-size:11px; margin-top:4px; }
  .rule input[type=text], .rule select { width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #e7ebef; border-radius:7px; font:inherit; }
  .rule .two { display:flex; gap:6px; } .rule .two > * { flex:1; }
  .rule label { display:block; color:#6b7785; font-size:11px; margin-top:6px; }
  .rule .actions { display:flex; gap:6px; margin-top:8px; } .rule .actions button { flex:1; }
```

- [ ] **Step 2: popup.js — состояние и рендер списка**

Добавить после `const tgEl = ...`:

```js
// ---- правила алертов (ll_alert_rules): список карточек + inline-редактор ----
let rulesCfg = { version: 1, rules: [] };
let editingRuleId = null;   // id правила в редакторе; "new" — черновик нового

async function loadRules() {
  const { ll_alert_rules } = await chrome.storage.local.get("ll_alert_rules");
  rulesCfg = LLRULES.normalize(ll_alert_rules);
}
async function saveRules() {
  rulesCfg = LLRULES.normalize(rulesCfg);
  await chrome.storage.local.set({ ll_alert_rules: rulesCfg });
}
const csv = (arr) => (arr || []).join(", ");
const splitCsv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const numOrNull = (id) => { const v = document.getElementById(id).value; return v === "" ? null : Number(v); };

function ruleSummary(r) {
  const bits = [];
  if (r.keywordsAny.length) bits.push(`any: ${csv(r.keywordsAny)}`);
  if (r.keywordsNone.length) bits.push(`none: ${csv(r.keywordsNone)}`);
  if (r.minRate != null) bits.push(`≥ $${r.minRate}`);
  if (r.minRpm != null) bits.push(`≥ $${r.minRpm}/mi`);
  if (r.maxDeadhead != null) bits.push(`DH ≤ ${r.maxDeadhead}`);
  if (r.minMiles != null || r.maxMiles != null) bits.push(`${r.minMiles ?? 0}–${r.maxMiles ?? "∞"} mi`);
  if (r.equipment) bits.push(`equip: ${csv(r.equipment)}`);
  if (r.destStates.length) bits.push(`to: ${csv(r.destStates)}`);
  if (r.brokersAllow.length) bits.push(`brokers: ${csv(r.brokersAllow)}`);
  if (r.brokersBlock.length) bits.push(`block: ${csv(r.brokersBlock)}`);
  if (r.minCredit != null) bits.push(`credit ≥ ${r.minCredit}`);
  if (r.score !== "any") bits.push(r.score === "green" ? "green only" : "green + amber");
  return bits.length ? bits.join(" · ") : "no conditions = every load";
}

function ruleCard(r) {
  return `<div class="rule" data-id="${escA(r.id)}"><div class="hd">` +
    `<input type="checkbox" class="rule-on" style="width:auto"${r.enabled ? " checked" : ""}>` +
    `<b>${escA(r.name)}</b>` +
    `<button type="button" class="linkbtn rule-edit">Edit</button>` +
    `<button type="button" class="linkbtn rule-del">Delete</button></div>` +
    `<div class="sum">${escA(ruleSummary(r))}</div></div>`;
}

function ruleForm(r) {
  const eqSel = new Set(r.equipment || []);
  const scoreOpt = (v, label) => `<option value="${v}"${r.score === v ? " selected" : ""}>${label}</option>`;
  return `<div class="rule" data-id="${escA(r.id)}">` +
    `<label>Name</label><input type="text" id="rf-name" value="${escA(r.name)}" maxlength="${LLRULES.LIMITS.name}">` +
    `<label>Comments contain any of (comma-separated)</label><input type="text" id="rf-any" value="${escA(csv(r.keywordsAny))}" placeholder="bonded, in-bond, TWIC, airport">` +
    `<label>Comments must NOT contain</label><input type="text" id="rf-none" value="${escA(csv(r.keywordsNone))}" placeholder="hazmat, team">` +
    `<div class="two"><div><label>Min rate, $</label><input type="text" id="rf-rate" inputmode="decimal" value="${r.minRate ?? ""}"></div>` +
    `<div><label>Min $/mi (incl. deadhead)</label><input type="text" id="rf-rpm" inputmode="decimal" value="${r.minRpm ?? ""}"></div></div>` +
    `<div class="two"><div><label>Max deadhead, mi</label><input type="text" id="rf-dh" inputmode="numeric" value="${r.maxDeadhead ?? ""}"></div>` +
    `<div><label>Min credit score</label><input type="text" id="rf-credit" inputmode="numeric" value="${r.minCredit ?? ""}"></div></div>` +
    `<div class="two"><div><label>Min loaded miles</label><input type="text" id="rf-minmi" inputmode="numeric" value="${r.minMiles ?? ""}"></div>` +
    `<div><label>Max loaded miles</label><input type="text" id="rf-maxmi" inputmode="numeric" value="${r.maxMiles ?? ""}"></div></div>` +
    `<label>Equipment (none selected = same as global filter)</label><div class="chips" id="rf-equip">` +
    EQUIP_TYPES.map((e) => `<button type="button" class="chip${eqSel.has(e.code) ? " on" : ""}" data-code="${escA(e.code)}" title="${escA(e.label)}">${escA(e.code)}</button>`).join("") +
    `</div>` +
    `<label>Destination states (comma-separated)</label><input type="text" id="rf-states" value="${escA(csv(r.destStates))}" placeholder="TX, OK, ON">` +
    `<div class="two"><div><label>Brokers allow (MC)</label><input type="text" id="rf-allow" value="${escA(csv(r.brokersAllow))}"></div>` +
    `<div><label>Brokers block (MC)</label><input type="text" id="rf-block" value="${escA(csv(r.brokersBlock))}"></div></div>` +
    `<label>Score</label><select id="rf-score">${scoreOpt("any", "Any")}${scoreOpt("green", "Green only")}${scoreOpt("green_amber", "Green or amber")}</select>` +
    `<div class="note">All filled conditions must match (AND). Rules combine with OR. A rule without conditions matches every load.</div>` +
    `<div class="actions"><button type="button" id="rf-save">Save rule</button><button type="button" id="rf-cancel">Cancel</button></div></div>`;
}

function readRuleForm(id) {
  return {
    id,
    name: document.getElementById("rf-name").value,
    enabled: (rulesCfg.rules.find((r) => r.id === id) || { enabled: true }).enabled,
    keywordsAny: splitCsv(document.getElementById("rf-any").value),
    keywordsNone: splitCsv(document.getElementById("rf-none").value),
    minRate: numOrNull("rf-rate"), minRpm: numOrNull("rf-rpm"),
    maxDeadhead: numOrNull("rf-dh"), minCredit: numOrNull("rf-credit"),
    minMiles: numOrNull("rf-minmi"), maxMiles: numOrNull("rf-maxmi"),
    equipment: [...document.querySelectorAll("#rf-equip .chip.on")].map((c) => c.dataset.code),
    destStates: splitCsv(document.getElementById("rf-states").value),
    brokersAllow: splitCsv(document.getElementById("rf-allow").value),
    brokersBlock: splitCsv(document.getElementById("rf-block").value),
    score: document.getElementById("rf-score").value,
  };
}

function renderRules() {
  const box = document.getElementById("tg-rules");
  if (!box) return;
  const draft = editingRuleId === "new"
    ? LLRULES.normalize({ rules: [{ id: "new", name: "" }] }).rules[0] : null;
  const cards = rulesCfg.rules.map((r) => (r.id === editingRuleId ? ruleForm(r) : ruleCard(r))).join("");
  const full = rulesCfg.rules.length >= LLRULES.LIMITS.rules;
  box.innerHTML = '<h4>Alert rules</h4>' +
    (rulesCfg.rules.length ? "" : '<div class="note">No rules: every profitable (green) load matching your equipment filter is sent.</div>') +
    cards + (draft ? ruleForm(draft) : "") +
    (editingRuleId || full ? "" : '<button type="button" id="rule-add" style="margin-top:8px">Add rule</button>');

  box.querySelectorAll(".rule-on").forEach((cb) => cb.onchange = async (e) => {
    const id = e.target.closest(".rule").dataset.id;
    const r = rulesCfg.rules.find((x) => x.id === id); if (r) { r.enabled = e.target.checked; await saveRules(); renderRules(); }
  });
  box.querySelectorAll(".rule-edit").forEach((b) => b.onclick = (e) => { editingRuleId = e.target.closest(".rule").dataset.id; renderRules(); });
  box.querySelectorAll(".rule-del").forEach((b) => b.onclick = async (e) => {
    const id = e.target.closest(".rule").dataset.id;
    if (!confirm("Delete this rule?")) return;
    rulesCfg.rules = rulesCfg.rules.filter((x) => x.id !== id); await saveRules(); renderRules();
  });
  const add = document.getElementById("rule-add");
  if (add) add.onclick = () => { editingRuleId = "new"; renderRules(); };
  box.querySelectorAll("#rf-equip .chip").forEach((c) => c.onclick = () => c.classList.toggle("on"));
  const save = document.getElementById("rf-save");
  if (save) save.onclick = async () => {
    const isNew = editingRuleId === "new";
    const id = isNew ? `r_${Date.now()}` : editingRuleId;
    const next = readRuleForm(id);
    if (isNew) rulesCfg.rules.push(next);
    else rulesCfg.rules = rulesCfg.rules.map((r) => (r.id === id ? next : r));
    editingRuleId = null; await saveRules(); renderRules();
  };
  const cancel = document.getElementById("rf-cancel");
  if (cancel) cancel.onclick = () => { editingRuleId = null; renderRules(); };
}
```

Примечание: `readRuleForm("new")` ищет правило `new` в `rulesCfg` — его нет, поэтому `enabled: true`; затем id подменяется на `r_<ts>` до `push`. Это намеренно.

- [ ] **Step 3: popup.js — встроить в `renderTelegram`**

В ветке `linked` (последний `tgEl.innerHTML = ...` в `renderTelegram`) заменить финальную строку `'<div class="note">One load = one message, ...</div>'` на:

```js
    '<div class="note">One load = one message, duplicates filtered out. Works only while a DAT tab is open.</div>' +
    '<div id="tg-rules"></div>';
```

и после назначения `tg-unlink.onclick` добавить:

```js
  await loadRules();
  renderRules();
```

В Pro-тизере (ветка `me.plan !== "pro"`) заменить текст note на:
`'Alerts for profitable loads and custom alert rules (keywords, rate, deadhead, brokers) are a Pro feature.'`

- [ ] **Step 4: Проверка**

Run: `npm run check:lang && npm test`
Expected: зелёные. В Chrome: попап → Telegram alerts (Pro, linked) → Add rule → заполнить «bonded, in-bond, TWIC» / «hazmat, team» → Save → карточка с summary; тумблер выключает; Edit открывает форму с теми же значениями; Delete спрашивает подтверждение. В `chrome.storage.local.ll_alert_rules` — канон из Task 1. Второе правило: Min $/mi = 8. На DAT-вкладке после `render` в консоли `LLALERT` шлёт только совпадения (проверить через Network `telegram/notify`: в items есть `ruleName`).

- [ ] **Step 5: Коммит**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(popup): редактор правил Telegram-алертов"
```

---

### Task 7: Документация, финальная проверка, push

**Files:**
- Modify: `CLAUDE.md:38` (структура), `:154` (конвенция Telegram-алертов)
- Modify: `tasks/0013-alert-rules-engine.md`

- [ ] **Step 1: CLAUDE.md — структура**

После строки `equip-filter.js (LLEQUIP) ...` добавить:

```
  alert-rules.js (LLRULES)  чистые normalize/active/matches/select правил Telegram-алертов (ll_alert_rules): AND внутри правила, OR между; пусто → green+equip. Спека 2026-09-12
```

- [ ] **Step 2: CLAUDE.md — конвенция**

В пункте «**Telegram-алерты**» после фразы `content.render отдаёт LLALERT.push грузы **green+passEquip** (те же, что «Выгодные сейчас»);` вставить:

```
  **с 2026-09-12 — только если нет включённых правил**; при наличии правил (`ll_alert_rules`, редактор в
  popup) отбор делает `LLRULES.select` (ключевые слова в comments с нормализацией `in-bond`≡`inbond`,
  min rate/$/mi, max DH, miles, equipment, штаты назначения, MC allow/block, credit, score) — OR между
  правилами, AND внутри, `deadheadMiles:null`→0. Имя правила уходит как `ruleName` и печатается ботом
  первой строкой `🎯`. Спека — `docs/superpowers/specs/2026-09-12-alert-rules-engine-design.md`;
```

- [ ] **Step 3: Полная проверка**

Run: `npm test && (cd backend && npm test && npm run build)`
Expected: все зелёные, сборка без ошибок. Записать количество тестов в task-файл.

- [ ] **Step 4: Закрыть задачу и запушить**

В `tasks/0013-alert-rules-engine.md` проставить все `[x]`, `Status: done`.

```bash
git add CLAUDE.md tasks/0013-alert-rules-engine.md
git commit -m "docs: правила Telegram-алертов в CLAUDE.md, задача 0013 закрыта"
git push origin main
```

Push в `main` → автодеплой бэкенда в Coolify (`coolify --context yoolip999 app deployments list hiooby9kgzj8i79ycl33drec` для контроля). Расширение — перезагрузить распакованное у пользователя/клиента.
