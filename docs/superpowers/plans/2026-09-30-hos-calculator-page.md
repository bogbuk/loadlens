# HOS-калькулятор на лендинге — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бесплатная страница `/hos-calculator/` (+ `/ru/`, `/ro/`): остаток часов по правилам HOS и легальный план рейса, считается в браузере, ведёт к установке расширения.

**Architecture:** Чистый модуль расчёта `shared/hos-trip.js` (`LLHOSTRIP`) копируется в `backend/public/js/`. Общие для страниц сайта CSS/JS выносятся из `index.html` в `css/site.css` и `js/site.js`. `scripts/build-landing.js` обобщается с одной страницы на список `PAGES`: перевод, SEO-блок, JSON-строки для JS, FAQ JSON-LD, sitemap.

**Tech Stack:** vanilla JS (без зависимостей), `node:test`, статика через NestJS ServeStatic.

**Spec:** `docs/superpowers/specs/2026-09-30-hos-calculator-page-design.md`

**Где работать:** в worktree (в этом каталоге параллельно работают другие сессии и `main` может уехать):
```bash
git worktree add ../dat.com-hoscalc -b feat/hos-calculator main && cd ../dat.com-hoscalc
```
В конце — ff-merge в `main` из основного каталога и push (автодеплой).

## Global Constraints

- Коммиты без упоминания Claude/AI и без `Co-Authored-By` (правило пользователя).
- Лимиты в минутах: `DRIVE=660`, `WINDOW=840`, `BREAK_AFTER=480`, `BREAK=30`, `RESET=600`, `RESTART=2040`, `CYCLES={"70-8":4200,"60-7":3600}`.
- Поездка: `miles` 0–5000, `mph` 30–75 (пусто → 55), `loadMin`/`unloadMin` 0–600 (не передано → 60).
- Кнопка установки на калькуляторе: `data-cws="hos_calc"`, href `https://chromewebstore.google.com/detail/chemnjopdclcmcckgfbmabielhobmknk?utm_source=hos_calc`.
- Метрика — только после согласия (как на главной); поля калькулятора с классом `ym-disable-keys` (Webvisor не пишет ввод).
- Формулировки без «compliant»/«guarantee»; обязателен дисклеймер «planning estimate, not a replacement for your ELD».
- В `shared/` — никакой кириллицы в строках кода (проверяет `npm run check:lang`), комментарии — можно.
- `backend/public/{ru,ro}/…`, `sitemap.xml` и SEO-блоки генерирует `npm run build:landing` — руками не править.
- Мобильная ширина 375px без горизонтального скролла, светлая и тёмная темы.

## Review Focus

1. «Вождение после перерыва» больше, чем «вождение в смене» (противоречивый ввод) → `sinceBreakMin` зажимается до `drivenMin` (10h reset тоже перерыв), без ложного «перерыв сейчас». Тест — Task 1.
2. Очищенное поле, строка, минуты > 59 (`"90"`) → считаются как число/0, в UI никогда нет `NaN`. Тест `normalize` на строки — Task 1.
3. Цикл исчерпан до начала рейса → план начинается с 34h restart и завершается (нет бесконечного цикла). Тест — Task 1.
4. Перерыв нужен, а в окне ≤30 мин → сразу 10h reset, а не бессмысленный перерыв. Тест — Task 1.
5. На RU/RO-страницах внутренние ссылки (логотип, «калькулятор») ведут на ту же языковую версию, а переключатель языка калькулятора — на версии калькулятора. Тесты — Task 3 и Task 4.

---

### Task 1: Модуль расчёта `LLHOSTRIP`

**Files:**
- Create: `shared/hos-trip.js`
- Test: `shared/hos-trip.test.js`
- Modify: `scripts/sync-shared.js` (копия в `backend/public/js/hos-trip.js`)
- Create (генерится): `backend/public/js/hos-trip.js`

**Interfaces:**
- Produces: глобал/CommonJS `LLHOSTRIP = { normalize, remaining, plan, LIMITS, CYCLES }`.
  - `normalize(state) → { cycle, drivenMin, shiftMin, sinceBreakMin, cycleUsedMin }`
  - `remaining(state) → { drive, window, break, cycle, driveNow, limitedBy }` (`limitedBy ∈ "cycle"|"window"|"drive"|"break"`)
  - `plan(state, { miles, mph, loadMin, unloadMin }) → { segments: [{type, min, miles?}], totalMin, driveMin, restMin, resets, restarts }`, `type ∈ "duty"|"drive"|"break"|"reset"|"restart"`
  - `LIMITS = { drive: 660, window: 840, break: 480 }`, `CYCLES = { "70-8": 4200, "60-7": 3600 }`

- [ ] **Step 1: Написать падающие тесты** — `shared/hos-trip.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const H = require("./hos-trip.js");

const FRESH = { cycle: "70-8", drivenMin: 0, shiftMin: 0, sinceBreakMin: 0, cycleUsedMin: 0 };
const NO_DOCK = { loadMin: 0, unloadMin: 0 };
const shape = (p) => p.segments.map((s) => `${s.type}:${s.min}`);

test("normalize: мусор, отрицательные и строки зажимаются; неизвестный цикл → 70-8", () => {
  assert.deepStrictEqual(
    H.normalize({ cycle: "x", drivenMin: -5, shiftMin: "abc", sinceBreakMin: 999, cycleUsedMin: 99999 }),
    { cycle: "70-8", drivenMin: 0, shiftMin: 0, sinceBreakMin: 0, cycleUsedMin: 4200 });
  assert.deepStrictEqual(
    H.normalize({ cycle: "60-7", drivenMin: "90", shiftMin: "", sinceBreakMin: "45", cycleUsedMin: 4000 }),
    { cycle: "60-7", drivenMin: 90, shiftMin: 0, sinceBreakMin: 45, cycleUsedMin: 3600 });
});

test("normalize: вождение после перерыва не больше вождения в смене", () => {
  assert.strictEqual(H.normalize({ drivenMin: 120, sinceBreakMin: 300 }).sinceBreakMin, 120);
});

test("remaining: свежий водитель упирается в 30-минутный перерыв через 8 часов", () => {
  assert.deepStrictEqual(H.remaining(FRESH),
    { drive: 660, window: 840, break: 480, cycle: 4200, driveNow: 480, limitedBy: "break" });
});

test("remaining: минимум — лимит 11h; при равенстве побеждает окно (порядок cycle, window, drive, break)", () => {
  assert.strictEqual(H.remaining({ drivenMin: 600, shiftMin: 600 }).limitedBy, "drive");
  const tie = H.remaining({ drivenMin: 600, shiftMin: 780 });
  assert.strictEqual(tie.limitedBy, "window");
  assert.strictEqual(tie.driveNow, 60);
});

test("remaining: цикл 60/7 исчерпан → ехать нельзя", () => {
  const r = H.remaining({ cycle: "60-7", cycleUsedMin: 3600 });
  assert.strictEqual(r.driveNow, 0);
  assert.strictEqual(r.limitedBy, "cycle");
});

test("plan: 500 mi @ 55 свежим — перерыв после 8h, без отдыха 10h", () => {
  const p = H.plan(FRESH, { miles: 500, mph: 55, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:480", "break:30", "drive:65"]);
  assert.deepStrictEqual(p.segments.map((s) => s.miles), [440, undefined, 60]);
  assert.strictEqual(p.totalMin, 575);
  assert.strictEqual(p.driveMin, 545);
  assert.strictEqual(p.restMin, 30);
  assert.strictEqual(p.resets, 0);
});

test("plan: 700 mi @ 50 — 10h reset после 11h вождения", () => {
  const p = H.plan(FRESH, { miles: 700, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:480", "break:30", "drive:180", "reset:600", "drive:180"]);
  assert.strictEqual(p.resets, 1);
  assert.strictEqual(p.totalMin, 1470);
});

test("plan: окно 14h кончается раньше 11h → reset по окну", () => {
  const p = H.plan({ drivenMin: 120, shiftMin: 780 }, { miles: 100, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:60", "reset:600", "drive:60"]);
});

test("plan: цикл кончается в пути → 34h restart", () => {
  const p = H.plan({ ...FRESH, cycleUsedMin: 4140 }, { miles: 100, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:60", "restart:2040", "drive:60"]);
  assert.strictEqual(p.restarts, 1);
});

test("plan: цикл исчерпан ещё до рейса → начинается с restart и завершается", () => {
  const p = H.plan({ ...FRESH, cycleUsedMin: 4200 }, { miles: 100, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["restart:2040", "drive:120"]);
});

test("plan: перерыв нужен, а в окне ≤30 мин → сразу 10h reset", () => {
  const p = H.plan({ drivenMin: 480, sinceBreakMin: 480, shiftMin: 820 }, { miles: 50, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["reset:600", "drive:60"]);
});

test("plan: погрузка ≥30 мин засчитывается как перерыв, <30 — нет", () => {
  const st = { drivenMin: 400, sinceBreakMin: 400, shiftMin: 420 };
  assert.deepStrictEqual(shape(H.plan(st, { miles: 100, mph: 50, loadMin: 30, unloadMin: 0 })),
    ["duty:30", "drive:120"]);
  assert.deepStrictEqual(shape(H.plan(st, { miles: 100, mph: 50, loadMin: 20, unloadMin: 0 })),
    ["duty:20", "drive:80", "break:30", "drive:40"]);
});

test("plan: соседние сегменты одного типа склеиваются; дефолты погрузки 60/60", () => {
  assert.deepStrictEqual(shape(H.plan(FRESH, { miles: 0, loadMin: 20, unloadMin: 20 })), ["duty:40"]);
  assert.deepStrictEqual(shape(H.plan(FRESH, { miles: 55, mph: 55 })), ["duty:60", "drive:60", "duty:60"]);
});

test("plan: скорость зажимается в 30–75, пустая → 55", () => {
  assert.strictEqual(H.plan(FRESH, { miles: 75, mph: 500, ...NO_DOCK }).driveMin, 60);
  assert.strictEqual(H.plan(FRESH, { miles: 55, mph: "", ...NO_DOCK }).driveMin, 60);
});

test("plan: 5000 mi @ 30 — длинный рейс с рестартами завершается, сегментов < 200", () => {
  const p = H.plan(FRESH, { miles: 5000, mph: 30, ...NO_DOCK });
  assert.strictEqual(p.driveMin, 10000);
  assert.ok(p.restarts >= 2);
  assert.ok(p.segments.length < 200);
});
```

- [ ] **Step 2: Убедиться, что падают**

Run: `node --test shared/hos-trip.test.js`
Expected: FAIL — `Cannot find module './hos-trip.js'`

- [ ] **Step 3: Реализация** — `shared/hos-trip.js`:

```js
/* LoadLens — HOS-калькулятор для страницы лендинга /hos-calculator/.
   Zero-dep (браузер + Node + тесты), все величины — минуты. Модель упрощённая (см. спеку
   2026-09-30-hos-calculator-page-design): 11h driving, окно 14h, 30-мин перерыв после 8h вождения,
   цикл 70/8 или 60/7, 10h reset, 34h restart. Split sleeper, adverse conditions, short-haul и
   «скатывание» часов цикла по дням не моделируются. planner.stepHos сознательно не трогаем —
   он питает скоринг расширения. */
const LLHOSTRIP = (() => {
  "use strict";

  const DRIVE = 660, WINDOW = 840, BREAK_AFTER = 480, BREAK = 30, RESET = 600, RESTART = 2040;
  const CYCLES = { "70-8": 4200, "60-7": 3600 };
  const LIMITS = { drive: DRIVE, window: WINDOW, break: BREAK_AFTER };
  const MAX_STEPS = 400;                         // страховка от бесконечного цикла; при mph ≥ 30 недостижимо
  const ORDER = ["cycle", "window", "drive", "break"]; // при равенстве — то, что лечится дольше

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));
  const orDefault = (v, d) => (v == null || v === "" ? d : v);

  function normalize(s = {}) {
    const cycle = CYCLES[s.cycle] ? s.cycle : "70-8";
    const drivenMin = clamp(s.drivenMin, 0, DRIVE);
    return {
      cycle,
      drivenMin,
      shiftMin: clamp(s.shiftMin, 0, WINDOW),
      // 10h reset тоже перерыв, поэтому вождение после перерыва не может превышать вождение в смене
      sinceBreakMin: clamp(s.sinceBreakMin, 0, Math.min(BREAK_AFTER, drivenMin)),
      cycleUsedMin: clamp(s.cycleUsedMin, 0, CYCLES[cycle]),
    };
  }

  function remaining(state) {
    const s = normalize(state);
    const r = {
      drive: DRIVE - s.drivenMin,
      window: WINDOW - s.shiftMin,
      break: BREAK_AFTER - s.sinceBreakMin,
      cycle: CYCLES[s.cycle] - s.cycleUsedMin,
    };
    let limitedBy = ORDER[0];
    for (const k of ORDER) if (r[k] < r[limitedBy]) limitedBy = k;
    return { ...r, driveNow: r[limitedBy], limitedBy };
  }

  function plan(state, trip = {}) {
    const s = normalize(state);
    const limit = CYCLES[s.cycle];
    const miles = clamp(trip.miles, 0, 5000);
    const mph = clamp(orDefault(trip.mph, 55), 30, 75);
    const loadMin = clamp(orDefault(trip.loadMin, 60), 0, 600);
    const unloadMin = clamp(orDefault(trip.unloadMin, 60), 0, 600);
    let driven = s.drivenMin, shift = s.shiftMin, since = s.sinceBreakMin, used = s.cycleUsedMin;
    const raw = [];

    const push = (type, min, mi) => {
      if (min <= 0) return;
      const last = raw[raw.length - 1];
      if (last && last.type === type) { last.min += min; last.mi += mi || 0; }
      else raw.push({ type, min, mi: mi || 0 });
    };
    // Погрузка/разгрузка — on duty, не driving: правила её не запрещают даже при исчерпанных
    // лимитах; с 2020 on-duty ≥30 мин засчитывается как 30-минутный перерыв.
    const duty = (min) => {
      push("duty", min);
      shift += min; used += min;
      if (min >= BREAK) since = 0;
    };

    duty(loadMin);
    let left = Math.round((miles / mph) * 60);
    for (let step = 0; left > 0 && step < MAX_STEPS; step++) {
      const now = Math.max(0, Math.min(DRIVE - driven, WINDOW - shift, BREAK_AFTER - since, limit - used));
      if (now > 0) {
        const d = Math.min(left, now);
        push("drive", d, (d * mph) / 60);
        driven += d; shift += d; since += d; used += d; left -= d;
      } else if (limit - used <= 0) {
        push("restart", RESTART);
        driven = 0; shift = 0; since = 0; used = 0;
      } else if (DRIVE - driven <= 0 || WINDOW - shift <= BREAK) {
        // окно почти закрыто — 30-мин перерыв бесполезен, нужен 10h reset
        push("reset", RESET);
        driven = 0; shift = 0; since = 0;
      } else {
        push("break", BREAK);
        shift += BREAK; since = 0;
      }
    }
    duty(unloadMin);

    const segments = raw.map((x) => (x.type === "drive" ? { type: x.type, min: x.min, miles: Math.round(x.mi) } : { type: x.type, min: x.min }));
    const sum = (types) => segments.filter((x) => types.includes(x.type)).reduce((a, x) => a + x.min, 0);
    return {
      segments,
      totalMin: sum(["duty", "drive", "break", "reset", "restart"]),
      driveMin: sum(["drive"]),
      restMin: sum(["break", "reset", "restart"]),
      resets: segments.filter((x) => x.type === "reset").length,
      restarts: segments.filter((x) => x.type === "restart").length,
    };
  }

  return { normalize, remaining, plan, LIMITS, CYCLES };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLHOSTRIP;
if (typeof globalThis !== "undefined") globalThis.LLHOSTRIP = LLHOSTRIP;
```

Замечание к тесту «окно ≤30»: ветка `WINDOW - shift <= BREAK` срабатывает и когда driving упёрся в перерыв при почти закрытом окне; в тесте «окно 14h кончается раньше 11h» окно = 0 — тоже reset. Проверить, что тест «500 mi» не задет: после 480 мин окно = 360 > 30 → break.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test shared/hos-trip.test.js`
Expected: PASS, 15 тестов. Если `segments.map(s => s.miles)` в тесте 500 mi даёт `[440, undefined, 60]` — ок (у break нет поля `miles`).

- [ ] **Step 5: Копия для сайта** — в `scripts/sync-shared.js` после блока копирования seed в backend добавить:

```js
// Модули, которые грузят страницы сайта (backend/public/js/): HOS-калькулятор лендинга.
const PUBLIC_JS = path.join(ROOT, "backend", "public", "js");
const SITE_FILES = ["hos-trip.js"];
fs.mkdirSync(PUBLIC_JS, { recursive: true });
for (const f of SITE_FILES) {
  fs.writeFileSync(path.join(PUBLIC_JS, f), BANNER + fs.readFileSync(path.join(SHARED, f), "utf8"));
}
```
и заменить финальный `console.log` на:
```js
console.log(`synced ${FILES.length + 1} files -> extension/vendor/ + backend/shared/markets.seed.json + ${SITE_FILES.length} -> backend/public/js/`);
```

- [ ] **Step 6: Полный прогон**

Run: `npm test`
Expected: всё зелёное, `check:lang` без находок, появился `backend/public/js/hos-trip.js` с баннером AUTO-GENERATED.

- [ ] **Step 7: Commit**

```bash
git add shared/hos-trip.js shared/hos-trip.test.js scripts/sync-shared.js backend/public/js/hos-trip.js
git commit -m "feat(hos-trip): модуль расчёта HOS для калькулятора на лендинге — остатки и легальный план рейса"
```

---

### Task 2: Общие CSS/JS сайта (`css/site.css`, `js/site.js`)

Поведение главной не меняется: тот же вид, язык, согласие, Метрика, цель `install_click`. Меняется только то, что редирект по языку теперь сохраняет путь страницы.

**Files:**
- Create: `backend/public/css/site.css`, `backend/public/js/site.js`
- Modify: `backend/public/index.html`, `scripts/landing-i18n.test.js`

**Interfaces:**
- Produces: `/css/site.css` (токены, база, шапка, кнопки, баннер согласия, футер), `/js/site.js` (запоминание языка, согласие, Метрика, `install_click`). Требования к разметке страницы: `#consent`, `#ck-yes`, `#ck-no`, `#ck-open`, ссылки `[data-lang]`, кнопки `[data-cws]`.
- Produces: инлайн-редирект в `<head>` одинаковый для всех EN-страниц (см. Step 4).

- [ ] **Step 1: Поправить тесты под новое размещение** — в `scripts/landing-i18n.test.js`:

после строки `const html = fs.readFileSync(...index.html...)` добавить
```js
const PUB = path.join(__dirname, "..", "backend", "public");
const siteJs = fs.readFileSync(path.join(PUB, "js", "site.js"), "utf8");
```
в тесте «Метрика грузится только после согласия» заменить `assert.match(html, /function loadMetrika\(\)/);` на `assert.match(siteJs, /function loadMetrika\(\)/);` и добавить
```js
  assert.match(html, /<script src="\/js\/site\.js"><\/script>\s*<\/body>/);
```
в тесте «цель install_click» заменить два `assert.match(html, …)` на `assert.match(siteJs, …)`. Добавить тест:
```js
test("общие стили и редирект по языку: site.css в <head>, редирект сохраняет путь страницы", () => {
  const head = html.split("</head>")[0];
  assert.match(head, /<link rel="stylesheet" href="\/css\/site\.css" \/>/);
  assert.ok(head.includes('location.replace("/" + lang + location.pathname + location.hash)'));
  assert.ok(!/\.consent \{/.test(head), "стили баннера должны жить в site.css");
});
```

- [ ] **Step 2: Убедиться, что падают**

Run: `node --test scripts/landing-i18n.test.js`
Expected: FAIL — `ENOENT … js/site.js`

- [ ] **Step 3: Вынести CSS** — создать `backend/public/css/site.css`, первой строкой комментарий
`/* Общие стили страниц сайта (лендинг, HOS-калькулятор): токены темы, база, шапка, кнопки, баннер согласия, футер. */`,
и ПЕРЕНЕСТИ (вырезать из `index.html`, отступ снять) два диапазона внутри `<style>`:
  - от `:root {` (строка 45) до конца блока `/* кнопки */` включительно — последняя перенесённая строка `.ctas { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0 10px; }`;
  - от `.consent { position: fixed; …` до `footer nav { display: flex; flex-wrap: wrap; gap: 8px 16px; }` включительно.

В `index.html` в `<head>` сразу перед `<style>` вставить `<link rel="stylesheet" href="/css/site.css" />`. В `<style>` остаются только блоки главной (`/* первый экран */` … `.final .ctas`).

- [ ] **Step 4: Редирект по языку сохраняет путь** — в инлайн-скрипте `<head>` `index.html` заменить
```js
      location.replace("/" + lang + "/" + location.hash);
```
на
```js
      location.replace("/" + lang + location.pathname + location.hash);
```
(`/` → `/ru/`, `/hos-calculator/` → `/ru/hos-calculator/`). Скрипт в начале выходит, если `lang` страницы не `en`, — на RU/RO не срабатывает.

- [ ] **Step 5: Вынести JS** — всё содержимое последнего `<script>` в конце `<body>` (от комментария «Выбор языка в шапке запоминаем» до закрывающего `})();` IIFE согласия) перенести в `backend/public/js/site.js` без изменений, первой строкой:
`/* Общий скрипт страниц сайта: запоминание языка, согласие на аналитику (GDPR), Яндекс Метрика только после Accept, цель install_click. Подключается в конце <body>. */`.
В `index.html` на месте удалённого блока оставить `  <script src="/js/site.js"></script>` (прямо перед `</body>`).

- [ ] **Step 6: Собрать и прогнать**

Run: `npm run build:landing && npm test`
Expected: PASS. `ru/index.html`, `ro/index.html` пересобраны и тоже ссылаются на `/css/site.css` и `/js/site.js`.

- [ ] **Step 7: Проверка в браузере** (регрессия главной)

Run: `python3 -m http.server -d backend/public 8099` → открыть `http://localhost:8099/?lang=en`.
Expected: вид как до правки (светлая и тёмная тема), баннер согласия виден, «Decline» прячет его; `/?lang=ru` уводит на `/ru/`; «Cookie settings» открывает баннер. Сервер остановить.

- [ ] **Step 8: Commit**

```bash
git add backend/public/css/site.css backend/public/js/site.js backend/public/index.html backend/public/ru/index.html backend/public/ro/index.html scripts/landing-i18n.test.js
git commit -m "refactor(landing): общие стили и скрипт сайта в css/site.css и js/site.js, редирект по языку сохраняет путь"
```

---

### Task 3: Сборка лендинга на несколько страниц

Генерализация без новой страницы: `PAGES` пока содержит только главную, вывод для главной должен остаться байт-в-байт, кроме логотипа с `data-local`.

**Files:**
- Modify: `scripts/build-landing.js`, `scripts/landing-i18n.test.js`, `backend/public/index.html` (логотип `data-local`)

**Interfaces:**
- Produces: `module.exports = { build, BASE, LANGS, PAGES, urlOf }`
  - `LANGS = { en: { path: "/", locale }, ru: { path: "/ru/", … }, ro: { path: "/ro/", … } }` (префикс языка)
  - `PAGES = [{ src, dict, path, ld }]`, `ld ∈ "app" | "tool"`
  - `urlOf(lang, page) → string` (`urlOf("ru", {path:"/hos-calculator/"}) === "/ru/hos-calculator/"`)
- Соглашения разметки для следующих задач:
  - `<a data-local href="/…">` — на RU/RO href получает префикс языка (атрибут `data-local` СТРОГО перед `href`);
  - `<!--STRINGS-START--><!--STRINGS-END-->` — сборка вставляет `<script type="application/json" id="ll-strings">` со всеми ключами `js.*` словаря страницы;
  - FAQ: элементы `data-i18n="faq.qN"` / `data-i18n="faq.aN"` (N с 1, текст без тегов) → JSON-LD `FAQPage` для `ld: "tool"`.
  - Словарь страницы накладывается поверх `landing/i18n.json` (общие ключи шапки/футера/согласия/`cta.install` берутся оттуда).

- [ ] **Step 1: Падающие тесты** — в `scripts/landing-i18n.test.js`:

заменить импорт на `const { build, BASE, LANGS, PAGES, urlOf } = require("./build-landing");` и добавить:
```js
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
```

- [ ] **Step 2: Убедиться, что падают**

Run: `node --test scripts/landing-i18n.test.js`
Expected: FAIL — `urlOf is not a function`

- [ ] **Step 3: Логотип главной** — в `backend/public/index.html` шапка:
`<a class="logo" href="/">` → `<a class="logo" data-local href="/">`.

- [ ] **Step 4: Переписать `scripts/build-landing.js`** — шапочный комментарий дополнить «Страницы — список PAGES; словарь страницы накладывается на общий landing/i18n.json.», затем заменить всё от `const LANGS = {` до конца файла на:

```js
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
```
Далее функции `translateBody` и `mailHrefs` — без изменений. После них:

```js
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
```
Старую функцию `seoBlock(lang, d)` и старые `page`/`sitemap`/`build` удалить (заменены выше).

- [ ] **Step 5: Собрать и сравнить** — главная не должна измениться, кроме логотипа:

Run: `npm run build:landing && git diff --stat backend/public && git diff backend/public/ru/index.html | grep '^[-+][^-+]'`
Expected: в `index.html`, `ru/index.html`, `ro/index.html` меняется только строка логотипа (`data-local`, на RU/RO — `href="/ru/"`/`"/ro/"`); `sitemap.xml` не меняется.

- [ ] **Step 6: Полный прогон**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-landing.js scripts/landing-i18n.test.js backend/public/index.html backend/public/ru/index.html backend/public/ro/index.html backend/public/sitemap.xml
git commit -m "refactor(build-landing): сборка на несколько страниц — PAGES, строки для JS, FAQ JSON-LD, ссылки на свой язык"
```

---

### Task 4: Страница калькулятора EN/RU/RO

**Files:**
- Create: `backend/public/hos-calculator/index.html` (EN-исходник, правится руками)
- Create: `backend/public/js/hos-page.js`
- Create: `landing/hos-calculator.i18n.json`
- Modify: `scripts/build-landing.js` (запись в `PAGES`), `scripts/landing-i18n.test.js`
- Create (генерится): `backend/public/ru/hos-calculator/index.html`, `backend/public/ro/hos-calculator/index.html`, `backend/public/sitemap.xml`

**Interfaces:**
- Consumes: `LLHOSTRIP.remaining/plan/normalize/LIMITS/CYCLES` (Task 1); `/css/site.css`, `/js/site.js`, редирект в `<head>` (Task 2); `PAGES`, `urlOf`, `data-local`, `<!--STRINGS-*-->`, `faq.*` (Task 3).
- Produces: ключи словаря `js.*` (читает `hos-page.js`): `js.hm`, `js.left`, `js.now`, `js.next.{break,drive,window,cycle}`, `js.seg.{duty,drive,break,reset,restart}`, `js.total`, `js.arrive`.

- [ ] **Step 1: Падающие тесты** — в `scripts/landing-i18n.test.js` добавить в конец:

```js
// ---- HOS-калькулятор ----
const CALC = PAGES.find((p) => p.path === "/hos-calculator/");
const calcHtml = fs.readFileSync(path.join(PUB, "hos-calculator", "index.html"), "utf8");
const CALC_I18N = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "landing", "hos-calculator.i18n.json"), "utf8"));
const calcKeys = new Set([...calcHtml.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
const hosPageJs = fs.readFileSync(path.join(PUB, "js", "hos-page.js"), "utf8");
const JS_KEYS = ["js.hm", "js.left", "js.now", "js.total", "js.arrive",
  ...["break", "drive", "window", "cycle"].map((k) => "js.next." + k),
  ...["duty", "drive", "break", "reset", "restart"].map((k) => "js.seg." + k)];

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
```

- [ ] **Step 2: Убедиться, что падают**

Run: `node --test scripts/landing-i18n.test.js`
Expected: FAIL — `ENOENT … hos-calculator/index.html`

- [ ] **Step 3: EN-страница** — `backend/public/hos-calculator/index.html`. `<head>`: скопировать из `backend/public/index.html` строки от `<!doctype html>` до `<link rel="stylesheet" href="/css/site.css" />` включительно (doctype, charset, viewport, иконка, `<!--SEO-START-->…<!--SEO-END-->` — содержимое между маркерами можно оставить пустым, сборка перезапишет; инлайн-редирект по языку), затем:

```html
  <style>
    .calc-head { padding: 48px 0 8px; }
    .calc-head h1 { margin-bottom: 12px; }
    .calc { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; padding: 24px 0 56px; }
    @media (max-width: 860px) { .calc { grid-template-columns: minmax(0, 1fr); } }
    .panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: var(--shadow); }
    .panel h2 { font-size: 20px; margin-bottom: 14px; }
    fieldset { border: 0; padding: 0; margin: 0 0 16px; min-width: 0; }
    legend, .field > label { display: block; font-weight: 600; font-size: 15px; margin-bottom: 6px; }
    .radios { display: flex; flex-wrap: wrap; gap: 8px 16px; }
    .radios label { display: inline-flex; gap: 6px; align-items: center; font-size: 15px; }
    .field { margin-bottom: 14px; }
    .hm, .one { display: flex; align-items: center; gap: 6px; }
    .hm input, .one input { width: 88px; min-height: 44px; padding: 8px 10px; font: inherit; color: var(--ink);
                            background: var(--bg); border: 1px solid var(--line); border-radius: 10px; }
    .hm span { color: var(--mut); margin-right: 8px; }
    .trip { border-top: 1px solid var(--line); padding-top: 16px; }
    .trip .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .now { font-size: 17px; margin-bottom: 16px; }
    .meter { margin-bottom: 12px; }
    .meter .top { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
    .meter .val { font-weight: 700; }
    .meter .track { height: 8px; border-radius: 999px; background: var(--bg2); overflow: hidden; margin-top: 4px; }
    .meter .fill { height: 100%; background: var(--green); }
    .meter.first .fill { background: var(--amber); }
    .meter.first .top { color: var(--amber); }
    .plan { list-style: none; margin: 0 0 12px; padding: 0; }
    .plan li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0 8px 14px; border-bottom: 1px solid var(--line);
               font-size: 15px; border-left: 3px solid var(--line); }
    .plan li.drive { border-left-color: var(--green); }
    .plan li.duty { border-left-color: var(--blue); }
    .plan li.break, .plan li.reset { border-left-color: var(--amber); }
    .plan li.restart { border-left-color: var(--red); }
    .note { font-size: 14px; padding: 10px 12px; border-radius: 10px; background: var(--amber-bg); color: var(--amber); margin-top: 12px; }
    .note[hidden], #plan-box[hidden], #plan-hint[hidden] { display: none; }
    .cta { text-align: center; }
    .cta .ctas { justify-content: center; }
    .faq h3 { margin-top: 20px; }
    .disc { font-size: 14px; color: var(--mut); margin-top: 28px; }
  </style>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="logo" data-local href="/"><img src="/icon.png" alt="" /><span>Load<b>Lens</b></span></a>
      <div class="langs" role="group" aria-label="Language">
        <a href="/hos-calculator/" hreflang="en" lang="en" data-lang="en" aria-current="page">EN</a>
        <a href="/ru/hos-calculator/" hreflang="ru" lang="ru" data-lang="ru">RU</a>
        <a href="/ro/hos-calculator/" hreflang="ro" lang="ro" data-lang="ro">RO</a>
      </div>
    </div>
  </header>

  <main>
    <section class="calc-head">
      <div class="wrap">
        <h1 data-i18n="h.title">HOS calculator: how many hours can you still drive?</h1>
        <p class="lead" data-i18n="h.lead">Enter today's hours and get the time left on every FMCSA limit. Add a load's miles to see a legal trip plan with breaks and 10-hour resets.</p>
      </div>
    </section>

    <div class="wrap calc">
      <form class="panel" id="calc" onsubmit="return false">
        <fieldset>
          <legend data-i18n="in.cycle">Cycle</legend>
          <div class="radios">
            <label><input type="radio" name="cycle" value="70-8" checked /> <span data-i18n="in.c70">70 hours / 8 days</span></label>
            <label><input type="radio" name="cycle" value="60-7" /> <span data-i18n="in.c60">60 hours / 7 days</span></label>
          </div>
        </fieldset>
        <div class="field"><label for="driven-h" data-i18n="in.driven">Driving time this shift</label>
          <div class="hm"><input class="ym-disable-keys" type="number" id="driven-h" min="0" max="11" inputmode="numeric" value="0" /><span data-i18n="u.h">h</span>
            <input class="ym-disable-keys" type="number" id="driven-m" min="0" max="59" inputmode="numeric" value="0" /><span data-i18n="u.m">m</span></div></div>
        <div class="field"><label for="shift-h" data-i18n="in.shift">Time since your shift started</label>
          <div class="hm"><input class="ym-disable-keys" type="number" id="shift-h" min="0" max="14" inputmode="numeric" value="0" /><span data-i18n="u.h">h</span>
            <input class="ym-disable-keys" type="number" id="shift-m" min="0" max="59" inputmode="numeric" value="0" /><span data-i18n="u.m">m</span></div></div>
        <div class="field"><label for="since-h" data-i18n="in.since">Driving since your last 30-minute break</label>
          <div class="hm"><input class="ym-disable-keys" type="number" id="since-h" min="0" max="8" inputmode="numeric" value="0" /><span data-i18n="u.h">h</span>
            <input class="ym-disable-keys" type="number" id="since-m" min="0" max="59" inputmode="numeric" value="0" /><span data-i18n="u.m">m</span></div></div>
        <div class="field"><label for="used-h" data-i18n="in.used">On-duty hours in the last 8 (or 7) days</label>
          <div class="hm"><input class="ym-disable-keys" type="number" id="used-h" min="0" max="70" inputmode="numeric" value="0" /><span data-i18n="u.h">h</span>
            <input class="ym-disable-keys" type="number" id="used-m" min="0" max="59" inputmode="numeric" value="0" /><span data-i18n="u.m">m</span></div></div>
        <fieldset class="trip">
          <legend data-i18n="in.trip">Load (optional)</legend>
          <div class="row">
            <div class="field"><label for="miles" data-i18n="in.miles">Loaded miles</label>
              <div class="one"><input class="ym-disable-keys" type="number" id="miles" min="0" max="5000" inputmode="numeric" /></div></div>
            <div class="field"><label for="mph" data-i18n="in.mph">Average speed, mph</label>
              <div class="one"><input class="ym-disable-keys" type="number" id="mph" min="30" max="75" inputmode="numeric" value="55" /></div></div>
            <div class="field"><label for="load" data-i18n="in.load">Loading, min</label>
              <div class="one"><input class="ym-disable-keys" type="number" id="load" min="0" max="600" inputmode="numeric" value="60" /></div></div>
            <div class="field"><label for="unload" data-i18n="in.unload">Unloading, min</label>
              <div class="one"><input class="ym-disable-keys" type="number" id="unload" min="0" max="600" inputmode="numeric" value="60" /></div></div>
          </div>
        </fieldset>
      </form>

      <div>
        <div class="panel" aria-live="polite">
          <h2 data-i18n="r.title">Time left</h2>
          <p class="now" id="now"></p>
          <div class="meter" data-k="drive"><div class="top"><span data-i18n="r.drive">11-hour driving limit</span><span class="val"></span></div><div class="track"><div class="fill"></div></div></div>
          <div class="meter" data-k="window"><div class="top"><span data-i18n="r.window">14-hour window</span><span class="val"></span></div><div class="track"><div class="fill"></div></div></div>
          <div class="meter" data-k="break"><div class="top"><span data-i18n="r.break">Until the 30-minute break</span><span class="val"></span></div><div class="track"><div class="fill"></div></div></div>
          <div class="meter" data-k="cycle"><div class="top"><span data-i18n="r.cycle">Cycle</span><span class="val"></span></div><div class="track"><div class="fill"></div></div></div>
        </div>
        <div class="panel" style="margin-top: 16px">
          <h2 data-i18n="p.title">Legal trip plan</h2>
          <p class="mut" id="plan-hint" data-i18n="p.hint">Enter loaded miles to see a trip plan.</p>
          <div id="plan-box" hidden>
            <ol class="plan" id="plan"></ol>
            <p><b id="total"></b></p>
            <p class="mut small" id="arrive"></p>
            <p class="note" id="restart-note" hidden data-i18n="p.restart">This trip needs a 34-hour restart because the cycle runs out on the road. If some hours drop off your 8-day (7-day) total during the trip, you may need less.</p>
          </div>
        </div>
      </div>
    </div>

    <section class="alt cta">
      <div class="wrap">
        <h2 data-i18n="cta.t">LoadLens runs this check on every load in DAT One</h2>
        <p class="lead" style="margin: 0 auto" data-i18n="cta.p">The extension puts an HOS badge next to each posting, together with true $/mile after deadhead and a broker check. Free plan, no card.</p>
        <div class="ctas">
          <a class="btn primary" data-cws="hos_calc" href="https://chromewebstore.google.com/detail/chemnjopdclcmcckgfbmabielhobmknk?utm_source=hos_calc" target="_blank" rel="noopener" data-i18n="cta.install">Add to Chrome, free</a>
        </div>
      </div>
    </section>

    <section class="faq">
      <div class="wrap">
        <h2 data-i18n="faq.title">Frequently asked questions</h2>
        <h3 data-i18n="faq.q1">How many hours can a truck driver drive in a day?</h3>
        <p data-i18n="faq.a1">Up to 11 hours of driving after 10 consecutive hours off duty, and only inside a 14-hour window that starts when the shift begins. Breaks do not extend the 14-hour window.</p>
        <h3 data-i18n="faq.q2">When is the 30-minute break required?</h3>
        <p data-i18n="faq.a2">After 8 hours of driving in total without a break of at least 30 minutes. The break can be off duty, in the sleeper berth or on duty not driving, for example while loading.</p>
        <h3 data-i18n="faq.q3">What is the 70-hour/8-day rule?</h3>
        <p data-i18n="faq.a3">A driver may not drive after 70 hours on duty in 8 days in a row, or 60 hours in 7 days if the carrier does not operate every day. A 34-hour off-duty restart sets the count back to zero.</p>
        <h3 data-i18n="faq.q4">Is this calculator a replacement for an ELD?</h3>
        <p data-i18n="faq.a4">No. It is a planning estimate for dispatchers and drivers. At an inspection, only your ELD record counts.</p>
        <p class="disc" data-i18n="disc">Planning estimate, not legal advice and not a replacement for your ELD. Split sleeper berth, adverse driving conditions and short-haul exceptions are not modelled, and the cycle total is treated as fixed during the trip.</p>
      </div>
    </section>
  </main>
```
Затем скопировать из `index.html` блок `<div class="consent" …>…</div>` и `<footer>…</footer>` без изменений, и закончить:
```html
  <!--STRINGS-START--><!--STRINGS-END-->
  <script src="/js/hos-trip.js"></script>
  <script src="/js/hos-page.js"></script>
  <script src="/js/site.js"></script>
</body>
</html>
```

- [ ] **Step 4: Скрипт страницы** — `backend/public/js/hos-page.js`:

```js
/* Страница HOS-калькулятора: форма → LLHOSTRIP (js/hos-trip.js) → остатки и план рейса.
   Строки интерфейса — JSON #ll-strings, его вписывает build-landing для каждого языка.
   Всё считается в браузере, ничего не отправляется. */
(function () {
  "use strict";
  const S = JSON.parse(document.getElementById("ll-strings").textContent);
  const $ = (id) => document.getElementById(id);
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : ""));
  const num = (id) => { const n = parseFloat($(id).value); return Number.isFinite(n) && n > 0 ? n : 0; };
  const hm = (name) => num(name + "-h") * 60 + num(name + "-m");
  const fmt = (min) => { const t = Math.max(0, Math.round(min)); return fill(S["js.hm"], { h: Math.floor(t / 60), m: t % 60 }); };

  function readState() {
    return {
      cycle: document.querySelector('input[name="cycle"]:checked').value,
      drivenMin: hm("driven"), shiftMin: hm("shift"), sinceBreakMin: hm("since"), cycleUsedMin: hm("used"),
    };
  }

  function renderRemaining(state) {
    const r = LLHOSTRIP.remaining(state);
    const full = { ...LLHOSTRIP.LIMITS, cycle: LLHOSTRIP.CYCLES[LLHOSTRIP.normalize(state).cycle] };
    for (const k of ["drive", "window", "break", "cycle"]) {
      const row = document.querySelector(`.meter[data-k="${k}"]`);
      row.querySelector(".fill").style.width = ((100 * r[k]) / full[k]).toFixed(1) + "%";
      row.querySelector(".val").textContent = fill(S["js.left"], { t: fmt(r[k]) });
      row.classList.toggle("first", k === r.limitedBy);
    }
    const next = {
      break: S["js.next.break"], drive: S["js.next.drive"], window: S["js.next.window"], cycle: S["js.next.cycle"],
    }[r.limitedBy];
    $("now").textContent = fill(S["js.now"], { t: fmt(r.driveNow), next });
  }

  const SEG = {
    duty: S["js.seg.duty"], drive: S["js.seg.drive"], break: S["js.seg.break"],
    reset: S["js.seg.reset"], restart: S["js.seg.restart"],
  };

  function renderPlan(state) {
    const miles = num("miles");
    $("plan-box").hidden = !miles;
    $("plan-hint").hidden = !!miles;
    if (!miles) return;
    // Пустое поле погрузки = 0 (пользователь стёр), пустая скорость = дефолт модуля (55).
    const p = LLHOSTRIP.plan(state, { miles, mph: $("mph").value, loadMin: num("load"), unloadMin: num("unload") });
    const list = $("plan");
    list.textContent = "";
    for (const s of p.segments) {
      const li = document.createElement("li");
      li.className = s.type;
      const name = document.createElement("span");
      name.textContent = fill(SEG[s.type], { mi: s.miles || 0 });
      const t = document.createElement("b");
      t.textContent = fmt(s.min);
      li.append(name, t);
      list.append(li);
    }
    $("total").textContent = fill(S["js.total"], { t: fmt(p.totalMin), d: fmt(p.driveMin), r: fmt(p.restMin) });
    const when = new Date(Date.now() + p.totalMin * 60000)
      .toLocaleString(document.documentElement.lang, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    $("arrive").textContent = fill(S["js.arrive"], { when });
    $("restart-note").hidden = !p.restarts;
  }

  function update() {
    const st = readState();
    renderRemaining(st);
    renderPlan(st);
  }

  $("calc").addEventListener("input", update);
  update();
})();
```
Ключи `js.next.*`/`js.seg.*` перечислены явно (`S["…"]`), чтобы тест находил их в исходнике.

- [ ] **Step 5: Словарь** — `landing/hos-calculator.i18n.json` (EN — только `meta.*` и `js.*`, остальной EN-текст живёт в разметке; RO — вычитать носителем после релиза, как и RO главной):

```json
{
  "en": {
    "meta.title": "HOS Calculator: How Many Hours Can a Truck Driver Still Drive? | LoadLens",
    "meta.desc": "Free Hours-of-Service calculator for truck drivers and dispatchers: time left on the 11-hour, 14-hour, 30-minute break and 70/60-hour rules, plus a legal trip plan with breaks and resets.",
    "js.hm": "{h}h {m}m",
    "js.left": "{t} left",
    "js.now": "You can drive {t} right now, then you need {next}.",
    "js.next.break": "a 30-minute break",
    "js.next.drive": "a 10-hour reset: the 11-hour driving limit is used up",
    "js.next.window": "a 10-hour reset: the 14-hour window closes",
    "js.next.cycle": "a 34-hour restart: the cycle is used up",
    "js.seg.duty": "On duty: loading or unloading",
    "js.seg.drive": "Drive {mi} mi",
    "js.seg.break": "30-minute break",
    "js.seg.reset": "10-hour reset",
    "js.seg.restart": "34-hour restart",
    "js.total": "Legal trip time: {t} (driving {d}, breaks and rest {r}).",
    "js.arrive": "Done around {when} by your computer's clock."
  },
  "ru": {
    "meta.title": "HOS-калькулятор: сколько ещё может ехать водитель | LoadLens",
    "meta.desc": "Бесплатный калькулятор HOS для водителей и диспетчеров: остаток по правилам 11 и 14 часов, 30-минутному перерыву и циклу 70/60 часов, плюс легальный план рейса с перерывами и отдыхом.",
    "h.title": "HOS-калькулятор: сколько ещё можно ехать?",
    "h.lead": "Введите часы за сегодня и узнайте остаток по каждому лимиту FMCSA. Добавьте мили груза, чтобы увидеть легальный план рейса с перерывами и 10-часовым отдыхом.",
    "in.cycle": "Цикл",
    "in.c70": "70 часов / 8 дней",
    "in.c60": "60 часов / 7 дней",
    "in.driven": "Вождение в этой смене",
    "in.shift": "Прошло с начала смены",
    "in.since": "Вождение после последнего перерыва 30 мин",
    "in.used": "Часов on duty за последние 8 (или 7) дней",
    "in.trip": "Груз (необязательно)",
    "in.miles": "Мили с грузом",
    "in.mph": "Средняя скорость, миль/ч",
    "in.load": "Погрузка, мин",
    "in.unload": "Разгрузка, мин",
    "u.h": "ч",
    "u.m": "мин",
    "r.title": "Осталось",
    "r.drive": "Лимит вождения 11 часов",
    "r.window": "Окно 14 часов",
    "r.break": "До 30-минутного перерыва",
    "r.cycle": "Цикл",
    "p.title": "Легальный план рейса",
    "p.hint": "Введите мили с грузом, чтобы увидеть план рейса.",
    "p.restart": "Рейсу нужен 34-часовой рестарт: цикл заканчивается в пути. Если за время рейса часть часов выпадет из суммы за 8 (7) дней, может хватить и меньшего отдыха.",
    "cta.t": "LoadLens делает эту проверку на каждом грузе в DAT One",
    "cta.p": "Расширение ставит бейдж HOS рядом с каждым постингом вместе с реальным $/миля с учётом пустого пробега и проверкой брокера. Бесплатный тариф, без карты.",
    "faq.title": "Частые вопросы",
    "faq.q1": "Сколько часов в день может ехать водитель грузовика?",
    "faq.a1": "До 11 часов вождения после 10 часов подряд вне смены, и только внутри 14-часового окна, которое начинается с началом смены. Перерывы окно 14 часов не продлевают.",
    "faq.q2": "Когда нужен 30-минутный перерыв?",
    "faq.a2": "После 8 часов вождения в сумме без перерыва хотя бы в 30 минут. Перерыв может быть вне смены, в спальнике или на смене без вождения, например на погрузке.",
    "faq.q3": "Что такое правило 70 часов за 8 дней?",
    "faq.a3": "Водитель не может ехать после 70 часов на смене за 8 дней подряд, или 60 часов за 7 дней, если перевозчик работает не каждый день. 34-часовой рестарт вне смены обнуляет счёт.",
    "faq.q4": "Заменяет ли калькулятор ELD?",
    "faq.a4": "Нет. Это оценка для планирования диспетчерам и водителям. На проверке считается только запись вашего ELD.",
    "disc": "Оценка для планирования, а не юридическая консультация и не замена ELD. Split sleeper, неблагоприятные условия и исключения для коротких рейсов не учитываются, а сумма цикла считается неизменной на время рейса.",
    "js.hm": "{h} ч {m} мин",
    "js.left": "осталось {t}",
    "js.now": "Сейчас можно ехать {t}, потом нужен {next}.",
    "js.next.break": "30-минутный перерыв",
    "js.next.drive": "10-часовой отдых: лимит вождения 11 часов исчерпан",
    "js.next.window": "10-часовой отдых: закрывается окно 14 часов",
    "js.next.cycle": "34-часовой рестарт: цикл исчерпан",
    "js.seg.duty": "На смене: погрузка или разгрузка",
    "js.seg.drive": "Ехать {mi} миль",
    "js.seg.break": "Перерыв 30 минут",
    "js.seg.reset": "Отдых 10 часов",
    "js.seg.restart": "Рестарт 34 часа",
    "js.total": "Легальное время рейса: {t} (вождение {d}, перерывы и отдых {r}).",
    "js.arrive": "Готово примерно {when} по часам вашего компьютера."
  },
  "ro": {
    "meta.title": "Calculator HOS: câte ore mai poate conduce șoferul | LoadLens",
    "meta.desc": "Calculator HOS gratuit pentru șoferi și dispeceri: timpul rămas pentru regulile de 11 și 14 ore, pauza de 30 de minute și ciclul de 70/60 de ore, plus un plan legal de cursă cu pauze și odihnă.",
    "h.title": "Calculator HOS: câte ore mai poți conduce?",
    "h.lead": "Introdu orele de azi și vezi timpul rămas pentru fiecare limită FMCSA. Adaugă milele cursei ca să vezi un plan legal cu pauze și odihnă de 10 ore.",
    "in.cycle": "Ciclu",
    "in.c70": "70 de ore / 8 zile",
    "in.c60": "60 de ore / 7 zile",
    "in.driven": "Timp de condus în tura curentă",
    "in.shift": "Timp de la începutul turei",
    "in.since": "Condus de la ultima pauză de 30 de minute",
    "in.used": "Ore on duty în ultimele 8 (sau 7) zile",
    "in.trip": "Cursă (opțional)",
    "in.miles": "Mile cu marfă",
    "in.mph": "Viteză medie, mph",
    "in.load": "Încărcare, min",
    "in.unload": "Descărcare, min",
    "u.h": "h",
    "u.m": "min",
    "r.title": "Timp rămas",
    "r.drive": "Limita de condus de 11 ore",
    "r.window": "Fereastra de 14 ore",
    "r.break": "Până la pauza de 30 de minute",
    "r.cycle": "Ciclu",
    "p.title": "Plan legal de cursă",
    "p.hint": "Introdu milele cu marfă ca să vezi planul cursei.",
    "p.restart": "Cursa are nevoie de un restart de 34 de ore, pentru că ciclul se termină pe drum. Dacă în timpul cursei unele ore ies din totalul pe 8 (7) zile, poate fi nevoie de mai puțin.",
    "cta.t": "LoadLens face această verificare pentru fiecare cursă din DAT One",
    "cta.p": "Extensia pune un badge HOS lângă fiecare anunț, împreună cu $/milă real după drumul în gol și verificarea brokerului. Plan gratuit, fără card.",
    "faq.title": "Întrebări frecvente",
    "faq.q1": "Câte ore pe zi poate conduce un șofer de camion?",
    "faq.a1": "Până la 11 ore de condus după 10 ore consecutive libere, și doar într-o fereastră de 14 ore care începe odată cu tura. Pauzele nu prelungesc fereastra de 14 ore.",
    "faq.q2": "Când este obligatorie pauza de 30 de minute?",
    "faq.a2": "După 8 ore de condus în total fără o pauză de cel puțin 30 de minute. Pauza poate fi liberă, în cabina de dormit sau în tură fără condus, de exemplu la încărcare.",
    "faq.q3": "Ce este regula de 70 de ore în 8 zile?",
    "faq.a3": "Șoferul nu poate conduce după 70 de ore în tură în 8 zile consecutive, sau 60 de ore în 7 zile dacă transportatorul nu lucrează zilnic. Un restart de 34 de ore libere readuce contorul la zero.",
    "faq.q4": "Înlocuiește acest calculator un ELD?",
    "faq.a4": "Nu. Este o estimare pentru planificare, pentru dispeceri și șoferi. La un control contează doar înregistrarea din ELD.",
    "disc": "Estimare pentru planificare, nu consultanță juridică și nu înlocuiește ELD-ul. Split sleeper, condițiile nefavorabile și excepțiile pentru curse scurte nu sunt modelate, iar totalul ciclului este considerat fix pe durata cursei.",
    "js.hm": "{h} h {m} min",
    "js.left": "{t} rămase",
    "js.now": "Poți conduce {t} chiar acum, apoi ai nevoie de {next}.",
    "js.next.break": "o pauză de 30 de minute",
    "js.next.drive": "o odihnă de 10 ore: limita de condus de 11 ore s-a epuizat",
    "js.next.window": "o odihnă de 10 ore: se închide fereastra de 14 ore",
    "js.next.cycle": "un restart de 34 de ore: ciclul s-a epuizat",
    "js.seg.duty": "În tură: încărcare sau descărcare",
    "js.seg.drive": "Condus {mi} mile",
    "js.seg.break": "Pauză de 30 de minute",
    "js.seg.reset": "Odihnă de 10 ore",
    "js.seg.restart": "Restart de 34 de ore",
    "js.total": "Timp legal al cursei: {t} (condus {d}, pauze și odihnă {r}).",
    "js.arrive": "Gata în jurul orei {when}, după ceasul calculatorului tău."
  }
}
```

- [ ] **Step 6: Страница в сборке** — в `scripts/build-landing.js` в `PAGES` добавить:
```js
  { src: "hos-calculator/index.html", dict: "landing/hos-calculator.i18n.json", path: "/hos-calculator/", ld: "tool" },
```

- [ ] **Step 7: Собрать и прогнать**

Run: `npm run build:landing && npm test`
Expected: PASS; созданы `backend/public/ru/hos-calculator/index.html`, `backend/public/ro/hos-calculator/index.html`; `sitemap.xml` содержит 6 URL лендинга + stats/privacy.

- [ ] **Step 8: Проверка в браузере**

Run: `python3 -m http.server -d backend/public 8099`, открыть `http://localhost:8099/hos-calculator/?lang=en`, затем `/ru/hos-calculator/`, `/ro/hos-calculator/`.
Проверить:
- по умолчанию «You can drive 8h 0m right now, then you need a 30-minute break.», полоса «Until the 30-minute break» янтарная;
- миль 500 при погрузке/разгрузке 60 → план: погрузка 1h 0m, Drive 440 mi 8h 0m, 30-minute break 0h 30m, Drive 60 mi 1h 5m, разгрузка 1h 0m; итог 11h 35m (погрузка засчитана как перерыв, поэтому следующий нужен только после 8h вождения);
- used = 69h, миль 100 → в плане «34-hour restart», янтарная заметка видна;
- стереть поле часов → нет `NaN`, считается как 0;
- ширина 375px (DevTools) — без горизонтального скролла; тёмная тема;
- `/hos-calculator/?lang=ru` уводит на `/ru/hos-calculator/`; логотип на RU ведёт на `/ru/`.
Сервер остановить.

- [ ] **Step 9: Commit**

```bash
git add backend/public/hos-calculator backend/public/ru/hos-calculator backend/public/ro/hos-calculator backend/public/js/hos-page.js backend/public/sitemap.xml landing/hos-calculator.i18n.json scripts/build-landing.js scripts/landing-i18n.test.js
git commit -m "feat(landing): бесплатный HOS-калькулятор /hos-calculator/ на EN/RU/RO — остаток часов и легальный план рейса"
```

---

### Task 5: Ссылки с главной, privacy, документация, релиз

**Files:**
- Modify: `backend/public/index.html`, `landing/i18n.json`, `backend/public/privacy.html`, `backend/public/hos-calculator/index.html` (футер), `CLAUDE.md`, `scripts/landing-i18n.test.js`
- Генерится: RU/RO главной и калькулятора

- [ ] **Step 1: Падающий тест** — в `scripts/landing-i18n.test.js`:

```js
test("главная ссылается на калькулятор (карточка HOS и футер), privacy упоминает калькулятор", () => {
  assert.match(html, /<a data-local href="\/hos-calculator\/" data-i18n="f2\.link">/);
  assert.match(html, /<a data-local href="\/hos-calculator\/" data-i18n="ft\.hos">/);
  assert.match(built[path.join("ru", "index.html")], /data-local href="\/ru\/hos-calculator\/"/);
  const privacy = fs.readFileSync(path.join(PUB, "privacy.html"), "utf8");
  assert.match(privacy, /HOS calculator/);
  assert.ok(!privacy.includes("The page has no forms"), "на калькуляторе есть поля — формулировка устарела");
});
```

Run: `node --test scripts/landing-i18n.test.js` → Expected: FAIL.

- [ ] **Step 2: Ссылки на главной** — в `backend/public/index.html`:
  - в карточке HOS после `<p data-i18n="f2.p">…</p>` (перед `</div>` карточки) вставить
    `<p><a data-local href="/hos-calculator/" data-i18n="f2.link">Try the free HOS calculator →</a></p>`;
  - в футере `<nav>` после ссылки `ft.stats` вставить
    `<a data-local href="/hos-calculator/" data-i18n="ft.hos">HOS calculator</a>`.
  То же ссылку `ft.hos` добавить в `<nav>` футера `backend/public/hos-calculator/index.html` (после `ft.stats`).

В `landing/i18n.json` добавить в `ru`: `"f2.link": "Попробуйте бесплатный HOS-калькулятор →"`, `"ft.hos": "HOS-калькулятор"`; в `ro`: `"f2.link": "Încearcă calculatorul HOS gratuit →"`, `"ft.hos": "Calculator HOS"` (рядом с `f2.p` и `ft.stats` соответственно).

- [ ] **Step 3: Privacy** — в `backend/public/privacy.html`:
  - список получателей: `receives analytics about visits to our website's home page (section 8)` → `receives analytics about visits to our website's home page and HOS calculator (section 8)`;
  - §8, первое предложение: `the home page of <code>loadlens.krait.studio</code>` → `the home page and the free HOS calculator of <code>loadlens.krait.studio</code>`;
  - `use the page.` → `use these pages.`; `at the bottom of the home page` → `at the bottom of these pages`;
  - `The page has no forms, so no text you type is recorded.` → `The home page has no forms, and the numbers you enter in the HOS calculator are excluded from session replay; the calculator works entirely in your browser and sends nothing to our servers.`

- [ ] **Step 4: CLAUDE.md** — в блоке структуры строку `backend/public/` дополнить: после `robots.txt, og.png;` вставить
  `hos-calculator/ — бесплатный HOS-калькулятор (EN-исходник, RU/RO генерит build:landing; расчёт — shared/hos-trip.js → public/js/ через sync:shared); css/site.css + js/site.js — общие стили/скрипт страниц (согласие, Метрика);`
  и в строке про `shared/` добавить `hos-trip.js` в список канона.

- [ ] **Step 5: Собрать и прогнать**

Run: `npm run build:landing && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/public/index.html backend/public/ru backend/public/ro backend/public/hos-calculator landing/i18n.json backend/public/privacy.html CLAUDE.md scripts/landing-i18n.test.js
git commit -m "feat(landing): ссылки на HOS-калькулятор с главной, privacy — аналитика на странице калькулятора"
```

- [ ] **Step 7: Влить и выкатить** — из основного каталога `/Users/bogdan/work/startup/dat.com`:

```bash
git fetch && git merge --ff-only feat/hos-calculator && git push origin main
```
Если `--ff-only` не проходит (main уехал) — `git rebase main` в worktree, повторить `npm test`, затем снова ff-merge. После автодеплоя (скилл `coolify-deploy`, `--context yoolip999`, `app deployments list hiooby9kgzj8i79ycl33drec`) проверить на проде:
```bash
for u in / /hos-calculator/ /ru/hos-calculator/ /ro/hos-calculator/ /js/hos-trip.js /js/site.js /css/site.css /sitemap.xml; do
  printf "%s " "$u"; curl -s -o /dev/null -w "%{http_code}\n" "https://loadlens.krait.studio$u"; done
curl -s https://loadlens.krait.studio/ru/hos-calculator/ | grep -o '<title>[^<]*</title>'
```
Expected: все 200, title русский. В браузере на проде: баннер согласия на калькуляторе, после Accept `ym` загружен, клик по кнопке шлёт `install_click` с `place=hos_calc`.

- [ ] **Step 8: Убрать worktree**

```bash
git worktree remove ../dat.com-hoscalc && git branch -d feat/hos-calculator
```
