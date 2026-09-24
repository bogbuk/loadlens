# Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести попап и плавающую панель грузов LoadLens в штатную боковую панель Chrome (`chrome.sidePanel`), оставив на странице DAT только построчные бейджи, FAB и меню отзыва о брокере.

**Architecture:** `content.js` остаётся «мозгом» (скоринг, цепочки, кэши, авто-пилот). На каждый `render()` он строит чистым модулем `LLVIEW` сериализуемый снапшот и шлёт его в порт `ll-panel`, который открывает боковая панель к активной вкладке борда. Панель (`sidepanel.js` + чистый рендер `LLPANEL`) только рисует и шлёт команды обратно. Вкладка Settings панели — бывший попап (`popup.js` без изменений логики).

**Tech Stack:** Chrome MV3 (`sidePanel` Chrome 116+, `runtime`/`tabs` ports), vanilla JS (IIFE-модули с `globalThis.X` + `module.exports`), `node --test`, Playwright (python) e2e.

**Spec:** `docs/superpowers/specs/2026-09-24-side-panel-design.md`

**Workspace:** общий checkout уезжает под параллельными сессиями — работать в worktree (`superpowers:using-git-worktrees`), в `main` вливать только `--ff-only`.

## Global Constraints

- `minimum_chrome_version: "116"`; новое разрешение только `sidePanel` (НЕ добавлять `tabs`).
- Весь user-facing текст — на английском (`npm run check:lang` падает на кириллице вне комментариев). Комментарии в коде — по-русски, как в окружающем коде.
- `vendor/*` и `backend/shared/*` руками не править (автокопии `shared/`).
- Никаких новых запросов к DAT; ToS-граница не меняется.
- Модули — IIFE `const LLX = (() => { ... })();` + `if (typeof module !== "undefined" && module.exports) module.exports = LLX; if (typeof globalThis !== "undefined") globalThis.LLX = LLX;`.
- Снапшот — только JSON-сериализуемые данные (без функций, Map, DOM, HTML).
- Версия расширения после релиза — `0.9.0`.

## Review Focus

1. **Снапшот-шторм от MutationObserver DAT** — DAT мутирует DOM постоянно, `render()` зовётся каждые ~400 мс; одинаковый снапшот не должен ни пересылаться, ни перерисовывать панель (дедуп по JSON с обеих сторон) — тест в Task 4 (`postSnapshot` дедуп) и в Task 5 (manual).
2. **Фокус в полях панели** — перерисовка `innerHTML`, пока пользователь печатает Cost/mi или Start, не должна стирать ввод: откладываем paint до blur, после `change` делаем `blur()` — Task 5.
3. **Вкладка без content-скрипта** (DAT открыт до установки/обновления расширения) — порт рвётся сразу; панель должна сказать «Reload the DAT tab», а не висеть на «Connecting…» — Task 5.
4. **Враждебные строки из DAT** (brokerName/comments/bookingUrl с `<img onerror>` / `javascript:`) — экранирование в рендере и `safeHttpUrl` в view-model — тесты в Task 2 и Task 3.
5. **Деталь исчезнувшего груза** (новый поиск, груз ушёл из выдачи) — `detail: null`, панель возвращается к списку, без исключений — тест в Task 2 (`build` с `detailLoad:null`) + логика в Task 4.

---

## File Structure

| Файл | Что | Задача |
|---|---|---|
| `extension/manifest.json` | + `sidePanel`, `side_panel`, `background`, `minimum_chrome_version`; − `default_popup`; + `view-model.js` в content_scripts | 1, 2 |
| `extension/background.js` (new) | `setPanelBehavior` + `open-panel` → `sidePanel.open` | 1 |
| `extension/sidepanel.html` (new) | каркас: шапка, вкладки Loads/Settings, контейнеры попапа | 1, 5 |
| `extension/sidepanel.css` (new) | стили попапа + стили бывших `#ll-panel`/`#ll-detail` под `#loads` | 1, 5 |
| `extension/sidepanel.js` (new) | вкладки; порт к активной вкладке, делегирование кликов | 1, 5 |
| `extension/popup.html` | удаляется | 1 |
| `extension/popup.js` | − «Hide panel on page», правка текстов | 1 |
| `extension/view-model.js` (new) | `LLVIEW`: чистая сборка снапшота + форматтеры | 2 |
| `extension/view-model.test.js` (new) | тесты `LLVIEW` | 2 |
| `extension/panel/render.js` (new) | `LLPANEL`: снапшот → HTML | 3 |
| `extension/panel/render.test.js` (new) | тесты `LLPANEL` | 3 |
| `extension/content.js` | порт, команды, снапшот; − in-page панель/деталь | 4 |
| `extension/visibility.js` (+test) | `badgesVisible`, `fabVisible({hintsOff, panelOpen})` | 4 |
| `extension/styles.css` | − `#ll-panel`/`#ll-detail`; + `#ll-toast` | 4 |
| `scripts/package-ext.js` (+ new test) | файлы из `side_panel`/`background` | 1 |
| `scripts/popup-rules.e2e.py` | `sidepanel.html` + переход на вкладку Settings | 1 |
| `package.json` | `test:ext` + `extension/panel/*.test.js` | 3 |
| `CLAUDE.md` | структура/конвенции | 6 |

---

### Task 1: Каркас боковой панели + Settings (бывший попап)

**Files:**
- Create: `extension/background.js`, `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js`, `scripts/package-ext.test.js`
- Modify: `extension/manifest.json`, `extension/popup.js:23-24,70,84-85` (+ тексты), `scripts/package-ext.js:2-4,36-41`, `scripts/popup-rules.e2e.py:1-8,81-82` + все `page.reload()`
- Delete: `extension/popup.html`

**Interfaces:**
- Produces: сообщение `chrome.runtime.sendMessage({ type: "open-panel" })` → ответ `{ ok: boolean, error?: string }` (используется в Task 4). DOM-каркас `sidepanel.html`: `#loads` (контейнер вкладки Loads), `[data-tab="loads"|"settings"]`, `#tab-loads`, `#tab-settings` (используется в Task 5).

- [ ] **Step 1: Тест пакета (падает)**

`scripts/package-ext.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert");
const { collect } = require("./package-ext.js");

test("collect: боковая панель, service worker и их ассеты в пакете, popup.html нет", () => {
  const { files } = collect();
  for (const f of ["sidepanel.html", "sidepanel.css", "sidepanel.js", "background.js", "popup.js", "api.js"]) {
    assert.ok(files.includes(f), "нет в пакете: " + f);
  }
  assert.ok(!files.includes("popup.html"), "popup.html больше не существует");
});
```

- [ ] **Step 2: Прогон — FAIL**

Run: `node --test scripts/package-ext.test.js`
Expected: FAIL `нет в пакете: sidepanel.html`.

- [ ] **Step 3: manifest.json**

Заменить блок `permissions`/`action` и добавить новые ключи (остальное не трогать):
```json
  "minimum_chrome_version": "116",
  "permissions": ["storage", "sidePanel"],
  ...
  "action": {
    "default_title": "LoadLens"
  },
  "side_panel": { "default_path": "sidepanel.html" },
  "background": { "service_worker": "background.js" },
```

- [ ] **Step 4: background.js**

```js
/* LoadLens — service worker. Клик по иконке открывает боковую панель; FAB/бейджи на странице
   DAT просят открыть её сообщением open-panel. */
"use strict";

function enablePanelOnActionClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
enablePanelOnActionClick(); // и на каждом старте SW — поведение могло не сохраниться после обновления Chrome

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "open-panel" || !sender.tab) return false;
  // open() зовём СИНХРОННО в обработчике, без await до него — иначе Chrome теряет user gesture
  // клика в content-скрипте. windowId (а не tabId) — та же глобальная панель, что по иконке.
  chrome.sidePanel.open({ windowId: sender.tab.windowId })
    .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // ответ асинхронный
});
```

- [ ] **Step 5: sidepanel.html**

Каркас; содержимое `#tab-settings` — контейнеры из бывшего `popup.html` (id не менять, `popup.js` ищет их по id), скрипты — тот же список, что был в `popup.html`, плюс `sidepanel.js` последним:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LoadLens</title>
<link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <div class="hd">
    <div class="logo">Load<b>Lens</b></div>
    <nav class="tabs">
      <button type="button" data-tab="loads" class="on">Loads</button>
      <button type="button" data-tab="settings">Settings</button>
    </nav>
  </div>
  <section id="tab-loads"><div id="loads" class="bd"></div></section>
  <section id="tab-settings" hidden>
    <div class="bd" id="account"><div class="empty">Account…</div></div>
    <details class="bd settings-wrap"><summary>⚙ Settings</summary>
      <div id="settings"></div>
    </details>
    <div class="bd" id="fleet"></div>
    <div class="bd" id="telegram"></div>
    <div class="bd" id="cloud"></div>
  </section>
  <script src="vendor/load.model.js"></script>
  <script src="vendor/scoring.js"></script>
  <script src="vendor/email-template.js"></script>
  <script src="cloud.config.js"></script>
  <script src="cloud.js"></script>
  <script src="api.js"></script>
  <script src="hos.js"></script>
  <script src="drivers.js"></script>
  <script src="equip-filter.js"></script>
  <script src="alert-rules.js"></script>
  <script src="visibility.js"></script>
  <script src="autopilot-policy.js"></script>
  <script src="popup.js"></script>
  <script src="sidepanel.js"></script>
</body>
</html>
```
Перед удалением `popup.html` сверить: если в его `<body>` есть элементы, которых нет выше (кроме `.hd`), — перенести их в `#tab-settings` с теми же id.

- [ ] **Step 6: sidepanel.css**

Скопировать ВСЁ содержимое `<style>` из `popup.html` в `extension/sidepanel.css`, затем:
- в правиле `body { width: 280px; ... }` удалить `width: 280px;` (панель резиновая);
- дописать в конец:
```css
/* вкладки боковой панели */
.hd { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; }
.tabs { display: flex; gap: 4px; }
.tabs button { width: auto; margin: 0; padding: 4px 10px; border: 0; border-radius: 99px; background: rgba(255,255,255,.15); color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; }
.tabs button.on { background: #fff; color: #1e3a8a; }
#loads .empty-state { color: #6b7785; padding: 24px 4px; text-align: center; }
```
(Проверить: у `.hd` из попапа `padding` сохраняется; `button { width:100% }` попапа перебивается `.tabs button { width:auto }`.)

- [ ] **Step 7: sidepanel.js (каркас вкладок; порт — Task 5)**

```js
/* LoadLens side panel: вкладки Loads/Settings. Вкладка Settings — бывший попап (popup.js).
   Порт к content.js активной вкладки борда и рендер Loads — ниже (Task 5). */
(() => {
  "use strict";
  const $loads = document.getElementById("loads");

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.getElementById("tab-loads").hidden = name !== "loads";
    document.getElementById("tab-settings").hidden = name !== "settings";
  }
  document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

  $loads.innerHTML = '<div class="empty-state">Open a DAT One or Truckstop search tab — LoadLens shows its loads here.</div>';
})();
```

- [ ] **Step 8: popup.js — убрать «Hide panel on page»**

- строки 23–24: убрать `ll_hide_panel` из деструктуризации и из массива ключей `chrome.storage.local.get([...])`;
- строка 70: удалить `<div class="row"><span class="k">Hide panel on page</span>...s-hide-panel...</div>`;
- строка 85: удалить `document.getElementById("s-hide-panel").onchange = ...`;
- текст заметки: `'"On-page display" applies instantly...'` оставить; в заметке про авто-пилот заменить `the "Auto-refresh" toggle in the on-page panel header overrides it for that tab only` → `the "Auto-refresh" toggle on the Loads tab overrides it for the DAT tab you are on`;
- заголовок-комментарий файла: `/* LoadLens popup — ...` → `/* LoadLens — вкладка Settings боковой панели (бывший попап): настройки водителя, аккаунт, парк, Telegram, облако. */`.

Затем: `git rm extension/popup.html`.

- [ ] **Step 9: package-ext.js — файлы из side_panel/background**

Заменить блок `const popup = ...` (строки 36–41) на:
```js
  // Страницы расширения (боковая панель; попап — если когда-нибудь вернётся) + их <script>/<link>.
  for (const page of [mf.side_panel && mf.side_panel.default_path, mf.action && mf.action.default_popup]) {
    if (!page) continue;
    files.add(page);
    for (const f of assetsFromHtml(page)) files.add(f);
  }
  if (mf.background && mf.background.service_worker) files.add(mf.background.service_worker);
```
и в шапке-комментарии `(content_scripts, action.default_popup, icons) и из <script src>/<link href> в popup.html` → `(content_scripts, side_panel, background, icons) и из <script src>/<link href> страниц расширения`.

- [ ] **Step 10: Прогон — PASS**

Run: `node --test scripts/package-ext.test.js && npm test`
Expected: PASS (все наборы; `check:lang` зелёный).

- [ ] **Step 11: e2e на sidepanel.html**

В `scripts/popup-rules.e2e.py`:
- строка 81: `popup = f"chrome-extension://{unpacked_id(EXT)}/sidepanel.html"`;
- после определения `set_auth` добавить:
```python
def open_settings(page):
    """Редактор правил живёт на вкладке Settings боковой панели (Loads открыта по умолчанию)."""
    page.click('[data-tab="settings"]')
```
- после КАЖДОГО `page.wait_for_load_state("networkidle")`, который идёт за `page.goto(...)` или `page.reload()` (их 5, `grep -n "page.reload()\|page.goto" scripts/popup-rules.e2e.py`), вставить `open_settings(page)`;
- docstring: «в попапе расширения» → «на вкладке Settings боковой панели».

Run: `npm run e2e:popup`
Expected: все `PASS`, 0 `FAIL`. (Нет playwright локально → отметить шаг как не выполненный и сказать об этом, не пропускать молча.)

- [ ] **Step 12: Ручная проверка**

`chrome://extensions` → обновить распакованное расширение → клик по иконке открывает боковую панель; вкладка Settings показывает аккаунт/настройки/парк/Telegram как раньше; «Loads» — заглушка.

- [ ] **Step 13: Commit**

```bash
git add extension/manifest.json extension/background.js extension/sidepanel.* extension/popup.js scripts/package-ext.js scripts/package-ext.test.js scripts/popup-rules.e2e.py
git commit -m "feat(sidepanel): каркас боковой панели, попап переехал во вкладку Settings"
```

---

### Task 2: `LLVIEW` — чистая сборка снапшота

**Files:**
- Create: `extension/view-model.js`, `extension/view-model.test.js`
- Modify: `extension/manifest.json` (content_scripts: `"view-model.js"` сразу перед `"content.js"`)

**Interfaces:**
- Consumes: глобалы `LLMODEL.formatAge`, `LLPLAN.horizon` (vendor, уже грузятся раньше в content_scripts; в тестах — `require("../shared/…")`).
- Produces (для Task 3/4/5):
  - `LLVIEW.build(input) → Snapshot`, где
    `input = { board, loads: Load[], pool: Load[], chains: Chain[] /* LLPLAN.plan */, deals: {l: Load, b: ProfitBadge}[], start: string|null, dieselPrice: number, costPerMile: number, equipFilter: string[]|null, autoRefreshOn: bool, cloud: bool, sseLive: bool, sortPref: {field,dir}|null, sortFields: {field,label}[], drivers: Driver[], activeDriverId: string|null, hintsOff: bool, detailLoad: Load|null, detailFacts: Facts|null, now: number, look: Look }`,
    `Look = { laneMedianOf(o,d,e) → number|null, rep(mc) → Rep|null, strength(market) → 0..1, density(market) → number, age(load) → minutes|null, brokerBadge(load) → {level, creditScore, daysToPay} }`,
    `Facts = { laneMedian, profit, hos, broker, rep, flags: {label}[], flagLevel: "high"|"low"|null, trueRpm, offer: {ask, script}, fleet: FleetMatch|null, mail: {url, text}|null }`.
  - `Snapshot = { board, hintsOff, header: { loadsCount, equipFilter: string|null, start, diesel: string, cpm: number, autoRefresh: {on, cloud}, sseLive, sort: {field, dir}, sortFields, drivers: {id,label}[], activeDriverId }, chains: ChainView[], deals: DealView[], detail: DetailView|null }`
  - `ChainView = { sig, hos, path, meta, legs: LegView[] }`; `LegView` live `{ kind:"live", resultId: string|null, idx, route, nbMi, eco, chips: {text, cls}[] }` | forecast `{ kind:"forecast", route, nbMi, fresh, eco }`
  - `DealView = { loadId: string, lane, age: string|null, rpm: string }`
  - `DetailView = { loadId: string, title, rows: {k, v, href?}[], flags: string[], comments: string|null, fleet: {title, rows:{ok, text}[]}|null, actions: { book: {url,label}|null, mail: {url, primary}|null, call: {href, primary}|null, copyEmail: string|null, copy: string, brokerMc: string|null } }`
  - Форматтеры для бейджей content.js: `LLVIEW.profitText(p)`, `LLVIEW.crowdText(rep)`, `LLVIEW.hosIcon(level)`, `LLVIEW.safeHttpUrl(raw)`.

- [ ] **Step 1: Тесты (падают)**

`extension/view-model.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert");
require("../shared/load.model.js");   // globalThis.LLMODEL
require("../shared/planner.js");      // globalThis.LLPLAN
const LLVIEW = require("./view-model.js");

const NOW = Date.parse("2026-09-24T15:00:00Z");
const look = (over = {}) => ({
  laneMedianOf: () => null, rep: () => null, strength: () => 0.6, density: () => 0,
  age: () => null, brokerBadge: () => ({ level: "unknown" }), ...over,
});
const load = (over = {}) => ({
  loadId: "L1", resultId: "abc+row1", originMarket: "DALLAS_TX", destMarket: "ATLANTA_GA", equipment: "V",
  rate: 2400, loadedMiles: 780, deadheadMiles: 20, brokerName: "Acme", brokerMc: "123456", ...over,
});
const input = (over = {}) => ({
  board: "dat", loads: [], pool: [], chains: [], deals: [], start: "DALLAS_TX", dieselPrice: 3.9, costPerMile: 1.8,
  equipFilter: null, autoRefreshOn: false, cloud: false, sseLive: false, sortPref: null,
  sortFields: [{ field: "rate", label: "Rate" }], drivers: [], activeDriverId: null, hintsOff: false,
  detailLoad: null, detailFacts: null, now: NOW, look: look(), ...over,
});

test("header: драйверы, фильтр прицепа, дизель, сортировка по умолчанию", () => {
  const s = LLVIEW.build(input({
    equipFilter: ["V", "R"], activeDriverId: 7,
    drivers: [{ id: 7, name: "Bob", currentMarket: "DALLAS_TX", equipment: "V" }, { id: 8, name: "Ann" }],
  }));
  assert.deepStrictEqual(s.header.drivers, [{ id: "7", label: "Bob · DALLAS_TX · V" }, { id: "8", label: "Ann" }]);
  assert.strictEqual(s.header.activeDriverId, "7");
  assert.strictEqual(s.header.equipFilter, "V, R");
  assert.strictEqual(s.header.diesel, "3.90");
  assert.deepStrictEqual(s.header.sort, { field: "", dir: "desc" });
  assert.strictEqual(s.detail, null);
});

test("chains: живое плечо (груз в выдаче) и прогнозное (крауд) с медианой и силой рынка", () => {
  const live = load();
  const crowd = load({ loadId: "C1", resultId: undefined, originMarket: "ATLANTA_GA", destMarket: "CHICAGO_IL", lastSeen: new Date(NOW).toISOString() });
  const chain = {
    hosBadge: "green", chainNetRpm: 2.1, totalNet: 1500, totalMiles: 1500, totalDriveMin: 1500, totalIdleMin: 0,
    finalMarket: "CHICAGO_IL",
    legs: [
      { loadId: "L1", origin: "DALLAS_TX", dest: "ATLANTA_GA", equipment: "V", rate: 2400, loadedMiles: 780, deadhead: 20, hosBadge: "green" },
      { loadId: "C1", origin: "ATLANTA_GA", dest: "CHICAGO_IL", equipment: "V", rate: 1800, loadedMiles: 720, deadhead: 0, hosBadge: "amber" },
    ],
  };
  const s = LLVIEW.build(input({
    loads: [live], pool: [live, crowd], chains: [chain],
    look: look({ laneMedianOf: (o, d) => (o === "ATLANTA_GA" && d === "CHICAGO_IL" ? 2.5 : null), density: (m) => (m === "ATLANTA_GA" ? 3 : 0), strength: () => 0.8 }),
  }));
  const [c] = s.chains;
  assert.strictEqual(c.path, "DALLAS_TX → ATLANTA_GA → CHICAGO_IL");
  assert.strictEqual(c.hos, "green");
  assert.match(c.meta, /^\$2\.10\/mi · net \$1500 · ~/);
  const [l0, l1] = c.legs;
  assert.strictEqual(l0.kind, "live");
  assert.strictEqual(l0.resultId, "abc+row1");
  assert.strictEqual(l0.eco, "$2,400 · 780mi +20dh · $3.00/mi · HOS ✓");
  assert.strictEqual(l1.kind, "forecast");
  assert.strictEqual(l1.fresh, "seen today");
  assert.strictEqual(l1.eco, "$2.50/mi lane median · ~3 loads from market · dest. market ▰▰▰▰▱ · HOS !");
});

test("chips живого плеча: возраст, брокер по CS, pickup today, Book Now", () => {
  const l = load({ bookNow: true, availability: { earliest: new Date(NOW).toISOString() }, weight: 42000, lengthFt: 53 });
  const chain = { hosBadge: "green", chainNetRpm: 3, totalNet: 1, finalMarket: "ATLANTA_GA",
    legs: [{ loadId: "L1", origin: "DALLAS_TX", dest: "ATLANTA_GA", equipment: "V", rate: 2400, loadedMiles: 780, deadhead: 20, hosBadge: "green" }] };
  const s = LLVIEW.build(input({
    loads: [l], pool: [l], chains: [chain],
    look: look({ age: () => 12, brokerBadge: () => ({ level: "good", creditScore: 95 }) }),
  }));
  assert.deepStrictEqual(s.chains[0].legs[0].chips, [
    { text: "🕒 12m", cls: "good" },
    { text: "Acme · 🛡 trusted 95CS", cls: "good" },
    { text: "pickup today", cls: "" },
    { text: "42klb · 53ft", cls: "" },
    { text: "Book Now", cls: "book" },
  ]);
});

test("deals: loadId строкой, возраст и $/mi", () => {
  const s = LLVIEW.build(input({ deals: [{ l: load({ loadId: 5 }), b: { netRpm: 2.346 } }], look: look({ age: () => 75 }) }));
  assert.deepStrictEqual(s.deals, [{ loadId: "5", lane: "DALLAS_TX → ATLANTA_GA V", age: "1h", rpm: "2.35" }]);
});

const facts = (over = {}) => ({
  laneMedian: 2.5, profit: { level: "green", netRpm: 2.4 }, hos: "green", broker: { creditScore: 92, daysToPay: 30 },
  rep: null, flags: [], flagLevel: null, trueRpm: 3.0, offer: { ask: 2650, script: "Could you do $2,650?" },
  fleet: null, mail: { url: "https://mail.google.com/x", text: "Subj\n\nBody" }, ...over,
});

test("detail: строки, контакты, primary-кнопка по preferredContactMethod", () => {
  const l = load({ contactPhone: "555-1", contactEmail: "a@b.co", preferredContactMethod: "PHONE", bookingUrl: "https://book.me/1", comments: "60ft" });
  const s = LLVIEW.build(input({ loads: [l], detailLoad: l, detailFacts: facts() }));
  const d = s.detail;
  assert.strictEqual(d.loadId, "L1");
  assert.strictEqual(d.title, "DALLAS_TX → ATLANTA_GA · V");
  assert.deepStrictEqual(d.rows.find((r) => r.k === "Phone"), { k: "Phone", v: "555-1", href: "tel:555-1" });
  assert.strictEqual(d.rows.find((r) => r.k === "Ask").v, "Could you do $2,650?");
  assert.strictEqual(d.comments, "60ft");
  assert.deepStrictEqual(d.actions.book, { url: "https://book.me/1", label: "Open ↗" });
  assert.deepStrictEqual(d.actions.mail, { url: "https://mail.google.com/x", primary: false });
  assert.deepStrictEqual(d.actions.call, { href: "tel:555-1", primary: true });
  assert.strictEqual(d.actions.copyEmail, "Subj\n\nBody");
  assert.strictEqual(d.actions.brokerMc, "123456");
  assert.match(d.actions.copy, /^DALLAS_TX → ATLANTA_GA V\nRate: \$2400/);
});

test("detail: javascript:-bookingUrl отбрасывается, неполный груз не падает", () => {
  const l = { loadId: "X", originMarket: "A", destMarket: "B", equipment: "V", rate: null, bookingUrl: "javascript:alert(1)" };
  const d = LLVIEW.build(input({ detailLoad: l, detailFacts: facts({ trueRpm: null, profit: { level: "unknown", netRpm: null }, offer: { ask: null }, mail: null, broker: {} }) })).detail;
  assert.strictEqual(d.actions.book, null);
  assert.strictEqual(d.actions.mail, null);
  assert.strictEqual(d.actions.brokerMc, null);
  assert.strictEqual(d.rows.find((r) => r.k === "Rate").v, "—");
});

test("detail: разбивка по парку", () => {
  const fleet = { feasibleCount: 1, total: 2, matches: [
    { feasible: true, name: "Bob", hosBadge: "green", equipMatch: true, deadhead: 12, netRpm: 2.1 },
    { feasible: false, name: "Ann", hosBadge: "red", equipMatch: false, deadhead: 300, netRpm: null },
  ] };
  const d = LLVIEW.build(input({ detailLoad: load(), detailFacts: facts({ fleet }) })).detail;
  assert.deepStrictEqual(d.fleet, { title: "Fits drivers (1/2)", rows: [
    { ok: true, text: "✓ Bob · HOS green · DH 12mi · $2.10/mi" },
    { ok: false, text: "✕ Ann · HOS red · equipment mismatch · DH 300mi" },
  ] });
});

test("снапшот сериализуем без потерь (уходит через port.postMessage)", () => {
  const l = load();
  const s = LLVIEW.build(input({ loads: [l], pool: [l], deals: [{ l, b: { netRpm: 2 } }], detailLoad: l, detailFacts: facts() }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), s);
});

test("форматтеры бейджей", () => {
  assert.strictEqual(LLVIEW.profitText({ level: "green", netRpm: 2.5 }), "▲ profitable · $2.50/mi");
  assert.strictEqual(LLVIEW.profitText({ level: "unknown" }), "— no rate");
  assert.strictEqual(LLVIEW.hosIcon("amber"), "!");
  assert.strictEqual(LLVIEW.crowdText({ n: 3, level: "good", paid: 2, noIssue: 1 }), "👥 3/3 ok");
  assert.strictEqual(LLVIEW.crowdText(null), "👥 +review");
  assert.strictEqual(LLVIEW.safeHttpUrl("data:text/html,x"), null);
});
```

- [ ] **Step 2: Прогон — FAIL**

Run: `node --test extension/view-model.test.js`
Expected: FAIL `Cannot find module './view-model.js'`.

- [ ] **Step 3: view-model.js**

```js
/* LoadLens — view-model боковой панели. Чистый модуль: из состояния content.js строит
   сериализуемый снапшот (только данные, без HTML) для sidepanel.js. Кэши content.js приходят
   функциями в `look`, «сейчас» — числом `now`: тестируется без браузера.
   Форматтеры бейджей (profitText/crowdText/hosIcon) — отсюда же, чтобы тексты на странице и
   в панели не разъезжались. */
const LLVIEW = (() => {
  "use strict";
  const HOS_ICON = { green: "✓", amber: "!", red: "✕" };
  const hosIcon = (lvl) => HOS_ICON[lvl] || "?";
  const money = (n) => Math.round(n || 0).toLocaleString("en-US");
  const fmtAge = (m) => globalThis.LLMODEL.formatAge(m);

  function profitText(p) {
    if (!p || p.level === "unknown") return "— no rate";
    const rpm = p.netRpm != null ? "$" + p.netRpm.toFixed(2) + "/mi" : "—";
    const tag = p.level === "green" ? "▲ profitable" : p.level === "amber" ? "≈ marginal" : "▼ loss";
    return `${tag} · ${rpm}`;
  }
  function crowdText(rep) {
    if (!rep || !rep.n) return "👥 +review";
    if (rep.level === "bad") {
      const why = rep.doubleBrokered ? `${rep.doubleBrokered}× double-brokered` : `${rep.flaked}× flaked`;
      return `👥 ⚠ ${why} (${rep.n})`;
    }
    if (rep.level === "good") return `👥 ${rep.paid + rep.noIssue}/${rep.n} ok`;
    if (rep.level === "thin") return `👥 ${rep.n} ${rep.n === 1 ? "review" : "reviews"}`;
    return `👥 mixed (${rep.n})`;
  }
  function crowdShort(rep) {
    if (rep.level === "good") return "🛡 trusted";
    if (rep.level === "bad") return "⚠ risk";
    if (rep.level === "thin") return rep.n + (rep.n === 1 ? " review" : " reviews");
    return "mixed";
  }
  // bookingUrl приходит от брокера — допускаем только http/https (иначе javascript:/data: = XSS).
  function safeHttpUrl(raw) {
    if (!raw) return null;
    try { const u = new URL(String(raw)); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null; }
    catch { return null; }
  }
  function fmtPickup(av, now) {
    if (!av || !av.earliest) return null;
    const d = new Date(av.earliest);
    if (isNaN(d.getTime())) return null;
    if (d.toDateString() === new Date(now).toDateString()) return "today";
    return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  }
  function freshnessText(lastSeen, now) {
    if (!lastSeen) return "forecast";
    const d = new Date(lastSeen);
    if (isNaN(d.getTime())) return "forecast";
    const days = Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "seen today";
    if (days === 1) return "seen yesterday";
    return `seen ${days}d ago`;
  }
  // Серверная свежесть (0..1) → цветная точка + слово. Бакеты как в спеке.
  function livenessLabel(liveness) {
    if (liveness > 0.66) return { dot: "🟢", word: "fresh" };
    if (liveness >= 0.33) return { dot: "🟡", word: "cooling" };
    return { dot: "🔴", word: "may be gone" };
  }
  function strengthBar(s) {
    const n = Math.max(0, Math.min(5, Math.round((s || 0) * 5)));
    return "▰".repeat(n) + "▱".repeat(5 - n);
  }
  // сигнатура цепочки = путь рынков (стабильна между рендерами) — ключ раскрытия в панели
  function chainSig(c) { return c.legs.map((l) => l.origin).concat(c.finalMarket).join(">") + "|" + c.chainNetRpm + "|" + c.totalMiles; }

  function liveChips(load, look, now) {
    const out = [];
    const age = look.age(load);
    // ≤30 мин — свежак (зелёный), ≥6 ч — почти наверняка уже взят или репост (янтарный)
    if (age != null) out.push({ text: "🕒 " + fmtAge(age), cls: age <= 30 ? "good" : age >= 360 ? "ok" : "" });
    const bn = load.brokerName ? load.brokerName + " · " : "";
    const rep = load.brokerMc ? look.rep(load.brokerMc) : null;
    if (rep && rep.n) {
      out.push({ text: bn + crowdShort(rep), cls: { good: "good", bad: "risk", mixed: "ok" }[rep.level] || "" });
    } else {
      const b = look.brokerBadge(load);
      if (b && b.level !== "unknown") {
        const cls = b.level === "good" ? "good" : b.level === "ok" ? "ok" : "risk";
        const tag = b.level === "good" ? "🛡 trusted" : b.level === "ok" ? "ok" : "⚠ risk";
        out.push({ text: bn + tag + (b.creditScore != null ? " " + b.creditScore + "CS" : ""), cls });
      }
    }
    const pick = fmtPickup(load.availability, now);
    if (pick) out.push({ text: "pickup " + pick, cls: "" });
    if (load.weight || load.lengthFt) {
      out.push({ text: [load.weight ? Math.round(load.weight / 1000) + "klb" : null, load.lengthFt ? load.lengthFt + "ft" : null].filter(Boolean).join(" · "), cls: "" });
    }
    if (load.isNegotiable) out.push({ text: "negotiable", cls: "" });
    if (load.isFactorable) out.push({ text: "factoring", cls: "" });
    if (load.bookNow) out.push({ text: "Book Now", cls: "book" });
    return out;
  }

  // одно плечо: live (груз в текущей выдаче) или forecast (крауд)
  function leg(lg, i, c, ctx, look) {
    const full = ctx.poolById.get(lg.loadId) || {};
    const rpm = (lg.loadedMiles + lg.deadhead) > 0 ? lg.rate / (lg.loadedMiles + lg.deadhead) : 0;
    const route = `${lg.origin} → ${lg.dest}`;
    const nbMi = full.originDeadheadMi > 0 ? Math.round(full.originDeadheadMi) : 0;
    if (ctx.liveIds.has(lg.loadId)) {
      return {
        kind: "live", resultId: full.resultId != null ? String(full.resultId) : null,
        idx: `leg ${i + 1} · ${lg.equipment || ""}`, route, nbMi,
        eco: `$${money(lg.rate)} · ${lg.loadedMiles}mi${lg.deadhead ? " +" + lg.deadhead + "dh" : ""} · $${rpm.toFixed(2)}/mi · HOS ${hosIcon(lg.hosBadge)}`,
        chips: liveChips(full, look, ctx.now),
      };
    }
    const median = look.laneMedianOf(lg.origin, lg.dest, lg.equipment);
    const rpmTxt = median != null ? `$${median.toFixed(2)}/mi lane median` : `$${rpm.toFixed(2)}/mi`;
    let fresh = freshnessText(full.lastSeen, ctx.now);
    if (full.liveness != null) { const ll = livenessLabel(full.liveness); fresh = `${ll.dot} ${ll.word} · ${fresh}`; }
    const density = look.density(lg.origin);
    const densTxt = density ? ` · ~${density} loads from market` : "";
    const strengthTxt = i === c.legs.length - 1 ? ` · dest. market ${strengthBar(look.strength(lg.dest))}` : "";
    return { kind: "forecast", route, nbMi, fresh, eco: `${rpmTxt}${densTxt}${strengthTxt} · HOS ${hosIcon(lg.hosBadge)}` };
  }

  function chain(c, ctx, look) {
    const h = globalThis.LLPLAN.horizon(c);
    return {
      sig: chainSig(c), hos: c.hosBadge || "red",
      path: c.legs.map((l) => l.origin).concat(c.finalMarket).join(" → "),
      meta: `$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ~${h.days}d · $${h.perDay}/day · HOS ${hosIcon(c.hosBadge)}`,
      legs: c.legs.map((l, i) => leg(l, i, c, ctx, look)),
    };
  }

  function deal(d, look) {
    const age = look.age(d.l);
    return { loadId: String(d.l.loadId), lane: `${d.l.originMarket} → ${d.l.destMarket} ${d.l.equipment}`, age: age != null ? fmtAge(age) : null, rpm: d.b.netRpm.toFixed(2) };
  }

  function fleetLine(x) {
    return `${x.feasible ? "✓" : "✕"} ${x.name} · HOS ${x.hosBadge}${x.equipMatch ? "" : " · equipment mismatch"} · DH ${x.deadhead}mi` +
      `${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`;
  }

  function detail(load, f) {
    const rows = [];
    const add = (k, v, href) => rows.push(href ? { k, v, href } : { k, v });
    add("Rate", load.rate != null ? `$${load.rate.toLocaleString("en-US")}${load.rateBasis ? " (" + load.rateBasis + ")" : ""}` : "—");
    add("RPM", [
      f.trueRpm != null ? `true $${f.trueRpm.toFixed(2)}` : null,
      f.profit && f.profit.netRpm != null ? `net $${f.profit.netRpm.toFixed(2)}` : null,
      load.estimatedRatePerMile != null ? `DAT est $${Number(load.estimatedRatePerMile).toFixed(2)}` : null,
      f.laneMedian != null ? `market $${f.laneMedian.toFixed(2)}` : null,
    ].filter(Boolean).join(" · ") || "—");
    add("Miles", `${load.loadedMiles ?? "—"} loaded · ${load.deadheadMiles ?? 0} DH`);
    if (load.weight) add("Weight", `${load.weight.toLocaleString("en-US")} lbs`);
    if (load.availability) add("Available", `${load.availability.earliest || "?"} – ${load.availability.latest || "?"}`);
    const flagTag = f.flags.length ? " · 🚩 " + (f.flagLevel === "high" ? "risk" : "verify") : "";
    add("Score", `${profitText(f.profit)} · HOS ${hosIcon(f.hos)}${flagTag}`);
    if (f.offer && f.offer.ask != null) add("Ask", f.offer.script);
    const b = f.broker || {};
    add("Broker", [load.brokerName, load.brokerMc ? "MC " + load.brokerMc : null,
      b.creditScore != null ? b.creditScore + " CS" : null, b.daysToPay != null ? b.daysToPay + " DTP" : null,
      f.rep && f.rep.n ? "crowd: " + crowdText(f.rep).replace("👥 ", "") : null].filter(Boolean).join(" · ") || "—");
    if (load.contactPhone) add("Phone", load.contactPhone, "tel:" + load.contactPhone);
    if (load.contactEmail) add("Email", load.contactEmail, "mailto:" + load.contactEmail);

    // Ведущая кнопка контакта — по preferredContactMethod (брокер сам указал канал).
    const phonePreferred = String(load.preferredContactMethod || "").indexOf("PHONE") >= 0;
    const book = safeHttpUrl(load.bookingUrl);
    const hasMail = !!(f.mail && load.contactEmail);
    const script = f.offer && f.offer.script;
    const copy = `${load.originMarket} → ${load.destMarket} ${load.equipment}\n` +
      `Rate: $${load.rate ?? "?"} ${load.rateBasis || ""} | ${load.loadedMiles ?? "?"}mi +${load.deadheadMiles ?? 0}DH\n` +
      (f.trueRpm != null ? `RPM: true $${f.trueRpm.toFixed(2)}${f.laneMedian != null ? ` | market $${f.laneMedian.toFixed(2)}` : ""}\n` : "") +
      (script ? `Ask: ${script}\n` : "") +
      `Broker: ${load.brokerName || "?"} MC ${load.brokerMc || "?"} | ${load.creditScore ?? "?"} CS ${load.daysToPay ?? "?"} DTP\n` +
      (load.contactPhone ? `Tel: ${load.contactPhone}\n` : "") + (load.comments ? `Notes: ${load.comments}` : "");
    return {
      loadId: String(load.loadId),
      title: `${load.originMarket} → ${load.destMarket} · ${load.equipment}`,
      rows, flags: f.flags.map((x) => x.label), comments: load.comments || null,
      fleet: f.fleet ? { title: `Fits drivers (${f.fleet.feasibleCount}/${f.fleet.total})`, rows: f.fleet.matches.map((x) => ({ ok: !!x.feasible, text: fleetLine(x) })) } : null,
      actions: {
        book: book ? { url: book, label: load.bookNow ? "Book Now ↗" : "Open ↗" } : null,
        mail: hasMail ? { url: f.mail.url, primary: !phonePreferred } : null,
        call: load.contactPhone ? { href: "tel:" + load.contactPhone, primary: phonePreferred || !load.contactEmail } : null,
        copyEmail: hasMail ? f.mail.text : null,
        copy,
        brokerMc: load.brokerMc ? String(load.brokerMc) : null,
      },
    };
  }

  function build(i) {
    const ctx = { poolById: new Map(i.pool.map((l) => [l.loadId, l])), liveIds: new Set(i.loads.map((l) => l.loadId)), now: i.now };
    return {
      board: i.board,
      hintsOff: !!i.hintsOff,
      header: {
        loadsCount: i.loads.length,
        equipFilter: i.equipFilter && i.equipFilter.length ? i.equipFilter.join(", ") : null,
        start: i.start || null,
        diesel: Number(i.dieselPrice).toFixed(2),
        cpm: i.costPerMile,
        autoRefresh: { on: !!i.autoRefreshOn, cloud: !!i.cloud },
        sseLive: !!i.sseLive,
        sort: { field: (i.sortPref && i.sortPref.field) || "", dir: i.sortPref && i.sortPref.dir === "asc" ? "asc" : "desc" },
        sortFields: i.sortFields.map((s) => ({ field: s.field, label: s.label })),
        drivers: i.drivers.map((d) => ({ id: String(d.id), label: d.name + (d.currentMarket ? " · " + d.currentMarket : "") + (d.equipment ? " · " + d.equipment : "") })),
        activeDriverId: i.activeDriverId != null ? String(i.activeDriverId) : null,
      },
      chains: i.chains.map((c) => chain(c, ctx, i.look)),
      deals: i.deals.map((d) => deal(d, i.look)),
      detail: i.detailLoad && i.detailFacts ? detail(i.detailLoad, i.detailFacts) : null,
    };
  }

  return { build, profitText, crowdText, hosIcon, safeHttpUrl };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLVIEW; }
if (typeof globalThis !== "undefined") globalThis.LLVIEW = LLVIEW;
```

- [ ] **Step 4: Прогон — PASS**

Run: `node --test extension/view-model.test.js`
Expected: PASS (9 tests). Если падает `meta` из-за `horizon` — проверить поля фикстуры цепочки (`totalDriveMin`/`totalIdleMin`/`totalNet`), не формат.

- [ ] **Step 5: manifest — view-model.js в content_scripts**

В первом блоке `content_scripts[0].js` вставить `"view-model.js",` непосредственно перед `"content.js"`.

Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/view-model.js extension/view-model.test.js extension/manifest.json
git commit -m "feat(sidepanel): LLVIEW — чистая сборка снапшота панели"
```

---

### Task 3: `LLPANEL` — рендер снапшота в HTML

**Files:**
- Create: `extension/panel/render.js`, `extension/panel/render.test.js`
- Modify: `package.json` (`test:ext`)

**Interfaces:**
- Consumes: `Snapshot` / `ChainView` / `LegView` / `DealView` / `DetailView` из Task 2.
- Produces (для Task 5):
  - `LLPANEL.isBoardUrl(url) → boolean`
  - `LLPANEL.loadsView(snap, ui) → string`, `ui = { expandedSig: string|null, notice: string }`
  - `LLPANEL.empty(kind) → string`, `kind ∈ "not-board" | "connecting" | "no-script"`
  - Разметка команд (делегирует sidepanel.js): `data-cmd` ∈ `toggleChain`(`data-sig`), `scrollToRow`(`data-result`), `openDetail`(`data-load`), `closeDetail`, `exportCsv`, `setSortDir`(`data-dir`), `setHintsOff`(`data-on="1"|"0"`), `copy`(`data-what="email"|"load"`), `reportBroker`(`data-mc`,`data-outcome`); поля по id: `#ll-driver`(select), `#ll-cpm`(number), `#ll-start`(text), `#ll-ar`(checkbox), `#ll-sort-f`(select).

- [ ] **Step 1: Тесты (падают)**

`extension/panel/render.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert");
const LLPANEL = require("./render.js");

const header = (over = {}) => ({
  loadsCount: 3, equipFilter: null, start: "DALLAS_TX", diesel: "3.90", cpm: 1.8,
  autoRefresh: { on: false, cloud: false }, sseLive: false, sort: { field: "", dir: "desc" },
  sortFields: [{ field: "rate", label: "Rate" }], drivers: [], activeDriverId: null, ...over,
});
const snap = (over = {}) => ({ board: "dat", hintsOff: false, header: header(), chains: [], deals: [], detail: null, ...over });
const UI = { expandedSig: null, notice: "" };

test("isBoardUrl: DAT/Truckstop да, похожие домены нет", () => {
  assert.strictEqual(LLPANEL.isBoardUrl("https://one.dat.com/search-loads"), true);
  assert.strictEqual(LLPANEL.isBoardUrl("https://main.truckstop.com/app/search"), true);
  assert.strictEqual(LLPANEL.isBoardUrl("https://dat.com.evil.io/"), false);
  assert.strictEqual(LLPANEL.isBoardUrl("https://notdat.com/"), false);
  assert.strictEqual(LLPANEL.isBoardUrl(undefined), false);
});

test("loadsView: шапка — водители, сортировка, авто-пилот, hints-кнопка", () => {
  const html = LLPANEL.loadsView(snap({
    header: header({ drivers: [{ id: "7", label: "Bob" }, { id: "8", label: "Ann" }], activeDriverId: "8",
      sort: { field: "rate", dir: "asc" }, autoRefresh: { on: true, cloud: false }, sseLive: true }),
  }), UI);
  assert.match(html, /<option value="8" selected>Ann<\/option>/);
  assert.match(html, /<option value="rate" selected>Rate<\/option>/);
  assert.match(html, /data-cmd="setSortDir" data-dir="desc"/);
  assert.match(html, /id="ll-ar" checked/);
  assert.match(html, /● live/);
  assert.match(html, /data-cmd="setHintsOff" data-on="1"/);
  assert.match(html, /Chains appear once/);
});

test("loadsView: облако — чекбокс авто-пилота заблокирован", () => {
  const html = LLPANEL.loadsView(snap({ header: header({ autoRefresh: { on: true, cloud: true } }) }), UI);
  assert.match(html, /id="ll-ar" checked disabled/);
});

test("цепочка: плечи только у раскрытой, live-плечо несёт data-result", () => {
  const chains = [{ sig: "A>B|2|10", hos: "green", path: "A → B", meta: "m", legs: [
    { kind: "live", resultId: "x+r1", idx: "leg 1 · V", route: "A → B", nbMi: 0, eco: "e", chips: [{ text: "Book Now", cls: "book" }] },
    { kind: "forecast", route: "B → C", nbMi: 40, fresh: "seen today", eco: "f" },
  ] }];
  const closed = LLPANEL.loadsView(snap({ chains }), UI);
  assert.doesNotMatch(closed, /leg-live/);
  const open = LLPANEL.loadsView(snap({ chains }), { ...UI, expandedSig: "A>B|2|10" });
  assert.match(open, /class="leg leg-live" data-cmd="scrollToRow" data-result="x\+r1"/);
  assert.match(open, /↪ \+40mi nearby/);
  assert.match(open, /<span class="lchip book">Book Now<\/span>/);
});

test("экранирование: враждебные строки из DAT не становятся разметкой", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = LLPANEL.loadsView(snap({
    deals: [{ loadId: '"><b>', lane: evil, age: null, rpm: "2.00" }],
    header: header({ drivers: [{ id: '"x', label: evil }] }),
  }), UI);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-load="&quot;&gt;&lt;b&gt;"/);
});

test("деталь вместо списка: Back, строки, ссылки, отзыв о брокере", () => {
  const detail = {
    loadId: "L1", title: "A → B · V",
    rows: [{ k: "Rate", v: "$2,400" }, { k: "Phone", v: "555-1", href: "tel:555-1" }],
    flags: ["Rate far above market"], comments: "60ft <long>",
    fleet: { title: "Fits drivers (1/1)", rows: [{ ok: true, text: "✓ Bob" }] },
    actions: { book: null, mail: { url: "https://mail.google.com/x?a=1&b=2", primary: true }, call: { href: "tel:555-1", primary: false }, copyEmail: "s", copy: "c", brokerMc: "123" },
  };
  const html = LLPANEL.loadsView(snap({ detail }), UI);
  assert.match(html, /data-cmd="closeDetail"/);
  assert.doesNotMatch(html, /Get-out chains|Chains appear/);
  assert.match(html, /<a href="tel:555-1">555-1<\/a>/);
  assert.match(html, /href="https:\/\/mail\.google\.com\/x\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">✉️ Email broker/);
  assert.doesNotMatch(html, /Book Now ↗|Open ↗/);
  assert.match(html, /60ft &lt;long&gt;/);
  assert.match(html, /data-cmd="reportBroker" data-mc="123" data-outcome="double_brokered"/);
  assert.match(html, /data-cmd="copy" data-what="email"/);
});

test("notice и пустые состояния", () => {
  assert.match(LLPANEL.loadsView(snap(), { ...UI, notice: "No loads to export." }), /class="notice">No loads to export\./);
  assert.match(LLPANEL.empty("not-board"), /Open a DAT One or Truckstop search tab/);
  assert.match(LLPANEL.empty("no-script"), /Reload the DAT tab/);
  assert.match(LLPANEL.empty("connecting"), /Connecting/);
});
```

- [ ] **Step 2: Прогон — FAIL**

Run: `node --test extension/panel/render.test.js`
Expected: FAIL `Cannot find module './render.js'`.

- [ ] **Step 3: panel/render.js**

```js
/* LoadLens — рендер вкладки Loads боковой панели. Чистые функции «снапшот (LLVIEW) → HTML-строка».
   Всё, что пришло из DAT, экранируется здесь; клики размечены data-cmd — их делегирует sidepanel.js. */
const LLPANEL = (() => {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BOARD_RE = /^https:\/\/([a-z0-9-]+\.)*(dat|truckstop)\.com\//i;
  const isBoardUrl = (url) => typeof url === "string" && BOARD_RE.test(url);
  const row = (k, vHtml) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${vHtml}</span></div>`;
  const REPORT_OPTS = [
    { o: "paid", t: "✅ Paid" },
    { o: "no_issue", t: "👍 No issues" },
    { o: "slow", t: "🐢 Slow pay" },
    { o: "flaked", t: "🚫 Flaked / canceled" },
    { o: "double_brokered", t: "⛔ Double-broker" },
  ];

  function header(h) {
    const ar = h.autoRefresh;
    return (h.drivers.length ? `<div class="ll-driver"><span class="k">Driver</span><select id="ll-driver">` +
        h.drivers.map((d) => `<option value="${esc(d.id)}"${d.id === h.activeDriverId ? " selected" : ""}>${esc(d.label)}</option>`).join("") +
        `</select></div>` : "") +
      row("Loads in results", esc(h.loadsCount)) +
      (h.equipFilter ? row("Equipment filter", esc(h.equipFilter)) : "") +
      row("Start market", h.start ? esc(h.start) : "—") +
      row("Diesel", "$" + esc(h.diesel) + "/gal") +
      `<div class="ll-cfg">Cost/mi: <input id="ll-cpm" type="number" step="0.05" value="${esc(h.cpm)}"> ` +
      `Start: <input id="ll-start" type="text" value="${esc(h.start || "")}" placeholder="CHICAGO_IL"></div>` +
      `<div class="ll-cfg" title="Auto-pilot: the DAT tab clicks Search itself and holds the sort order. This checkbox overrides the global switch (Settings) for this tab only">` +
        `<label${ar.cloud ? ' title="Cloud mode: auto-pilot is always on in the cloud browser"' : ""}><input type="checkbox" id="ll-ar"${ar.on ? " checked" : ""}${ar.cloud ? " disabled" : ""}> Auto-refresh${ar.cloud ? " (Cloud)" : ""}</label> ` +
        (h.sseLive ? `<span class="ll-live" title="Listening to DAT's live match stream for this search — new loads arrive without a refresh">● live</span> ` : "") +
        `Sort: <select id="ll-sort-f"><option value="">—</option>` +
        h.sortFields.map((s) => `<option value="${esc(s.field)}"${h.sort.field === s.field ? " selected" : ""}>${esc(s.label)}</option>`).join("") +
        `</select> <button data-cmd="setSortDir" data-dir="${h.sort.dir === "asc" ? "desc" : "asc"}" title="Sort direction">${h.sort.dir === "asc" ? "▲ Low" : "▼ High"}</button></div>`;
  }

  function chips(list) { return list.map((c) => `<span class="lchip${c.cls ? " " + esc(c.cls) : ""}">${esc(c.text)}</span>`).join(""); }
  function legHtml(l) {
    const nb = l.nbMi > 0 ? `<span class="leg-nb">↪ +${esc(l.nbMi)}mi nearby</span>` : "";
    if (l.kind === "live") {
      return `<div class="leg leg-live" data-cmd="scrollToRow"${l.resultId != null ? ` data-result="${esc(l.resultId)}"` : ""}>` +
        `<div class="leg-top"><span class="leg-tag live">● LIVE IN RESULTS ↗</span><span class="leg-idx">${esc(l.idx)}</span></div>` +
        `<div class="leg-route">${esc(l.route)}${nb}</div><div class="leg-eco">${esc(l.eco)}</div>` +
        `<div class="leg-chips">${chips(l.chips)}</div></div>`;
    }
    return `<div class="leg leg-fc"><div class="leg-top"><span class="leg-tag fc">◔ MARKET FORECAST</span><span class="leg-idx">${esc(l.fresh)}</span></div>` +
      `<div class="leg-route">${esc(l.route)}${nb}</div><div class="leg-eco">${esc(l.eco)}</div></div>`;
  }
  function chainHtml(c, expandedSig) {
    const open = c.sig === expandedSig;
    return `<div class="chain ll-${esc(c.hos)}${open ? " open" : ""}">` +
      `<div class="chain-hd" data-cmd="toggleChain" data-sig="${esc(c.sig)}">` +
      `<div class="route">${esc(c.path)} <span class="caret">${open ? "▾" : "▸"}</span></div><div class="meta">${esc(c.meta)}</div></div>` +
      (open ? `<div class="chain-legs">${c.legs.map(legHtml).join("")}</div>` : "") + `</div>`;
  }
  function dealHtml(d) {
    return `<div class="deal" data-cmd="openDetail" data-load="${esc(d.loadId)}"><span class="m">${esc(d.lane)}` +
      (d.age != null ? ` <span class="age">🕒 ${esc(d.age)}</span>` : "") + `</span><span class="p">$${esc(d.rpm)}/mi</span></div>`;
  }

  function detailHtml(d) {
    const a = d.actions;
    const link = (href, label, primary) => `<a class="btn${primary ? " primary" : ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return `<div class="detail"><div class="dhd"><button type="button" class="back" data-cmd="closeDetail">← Back</button><span class="ttl">${esc(d.title)}</span></div>` +
      d.rows.map((r) => `<div class="drow"><span class="k">${esc(r.k)}</span><span class="v">${r.href ? `<a href="${esc(r.href)}">${esc(r.v)}</a>` : esc(r.v)}</span></div>`).join("") +
      (d.flags.length ? `<div class="flags">${d.flags.map((f) => "• " + esc(f)).join("\n")}</div>` : "") +
      (d.comments ? `<div class="drow"><span class="k">Notes</span><span class="v comments">${esc(d.comments)}</span></div>` : "") +
      (d.fleet ? `<div class="fleet-match"><div class="fleet-h">${esc(d.fleet.title)}</div>` +
        d.fleet.rows.map((r) => `<div class="fleet-row ll-${r.ok ? "ok" : "no"}">${esc(r.text)}</div>`).join("") + `</div>` : "") +
      `<div class="actions">` +
        (a.book ? link(a.book.url, esc(a.book.label), true) : "") +
        (a.mail ? link(a.mail.url, "✉️ Email broker", a.mail.primary) : "") +
        (a.call ? `<a class="btn${a.call.primary ? " primary" : ""}" href="${esc(a.call.href)}">📞 Call</a>` : "") +
        (a.copyEmail ? `<button type="button" class="btn" data-cmd="copy" data-what="email">📋 Copy email</button>` : "") +
        `<button type="button" class="btn" data-cmd="copy" data-what="load">Copy</button>` +
      `</div>` +
      (a.brokerMc ? `<details class="review"><summary>Broker review · MC ${esc(a.brokerMc)}</summary>` +
        REPORT_OPTS.map((r) => `<button type="button" class="ll-rep-opt" data-cmd="reportBroker" data-mc="${esc(a.brokerMc)}" data-outcome="${r.o}">${r.t}</button>`).join("") +
        `</details>` : "") +
      `</div>`;
  }

  function loadsView(snap, ui) {
    const notice = ui.notice ? `<div class="notice">${esc(ui.notice)}</div>` : "";
    if (snap.detail) return notice + detailHtml(snap.detail);
    return header(snap.header) +
      (snap.chains.length ? "<h4>Get-out chains</h4>" + snap.chains.map((c) => chainHtml(c, ui.expandedSig)).join("")
        : "<div class='note'>Chains appear once enough loads from the start market are visible.</div>") +
      (snap.deals.length ? "<h4>Hot loads</h4>" + snap.deals.map(dealHtml).join("") : "") +
      `<div class="ll-ft"><button type="button" data-cmd="exportCsv" title="Export visible loads to CSV">⬇ CSV</button><span class="pro-tag">Pro</span>` +
      `<button type="button" data-cmd="setHintsOff" data-on="${snap.hintsOff ? "0" : "1"}" title="LoadLens badges and button on this DAT tab">${snap.hintsOff ? "👁 Show on page" : "🙈 Hide on page"}</button></div>` +
      notice +
      "<div class='note'>Scoring accounts for deadhead, fuel and the lane market median. The board rate is the broker's asking price. The HOS badge shows whether the driver can legally run it.</div>";
  }

  const EMPTY = {
    "not-board": "Open a DAT One or Truckstop search tab — LoadLens shows its loads here.",
    "connecting": "Connecting to the DAT tab…",
    "no-script": "Reload the DAT tab to connect LoadLens (it was opened before the extension was installed or updated).",
  };
  const empty = (kind) => `<div class="empty-state">${esc(EMPTY[kind] || EMPTY["not-board"])}</div>`;

  return { isBoardUrl, loadsView, empty };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLPANEL; }
if (typeof globalThis !== "undefined") globalThis.LLPANEL = LLPANEL;
```

- [ ] **Step 4: Прогон — PASS**

Run: `node --test extension/panel/render.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: package.json — тесты panel/ в test:ext**

```json
    "test:ext": "node --test extension/*.test.js extension/adapters/*.test.js extension/panel/*.test.js",
```
Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/panel/render.js extension/panel/render.test.js package.json
git commit -m "feat(sidepanel): LLPANEL — рендер вкладки Loads"
```

---

### Task 4: content.js — порт `ll-panel`, команды, снапшот; уборка in-page панели

**Files:**
- Modify: `extension/content.js` (множество мест — ниже по функциям), `extension/visibility.js`, `extension/visibility.test.js`, `extension/styles.css`

**Interfaces:**
- Consumes: `LLVIEW.build/profitText/crowdText/hosIcon/safeHttpUrl` (Task 2); сообщение `open-panel` (Task 1).
- Produces (для Task 5): `chrome.runtime.onConnect` с `port.name === "ll-panel"`. Вкладка → панель: `{type:"snapshot", data: Snapshot}`, `{type:"scrollResult", ok: boolean}`, `{type:"csv", filename, csv}`, `{type:"notice", text}`. Панель → вкладка: `{type:"cmd", cmd, ...args}` с `cmd ∈ setDriver{id} | setCpm{value} | setStart{market} | setAutorefresh{on} | setSort{field?|dir?} | scrollToRow{resultId} | openDetail{loadId} | closeDetail | exportCsv | setHintsOff{on} | reportBroker{mc, outcome}`.
- `LLVIS.badgesVisible({hintsOff, hideBadges})`, `LLVIS.fabVisible({hintsOff, panelOpen})`.

- [ ] **Step 1: visibility — тесты (падают)**

Заменить `extension/visibility.test.js` целиком:
```js
const test = require("node:test");
const assert = require("node:assert");
const LLVIS = require("./visibility.js");

// state: { hintsOff, hideBadges, panelOpen } — все флаги по умолчанию false
const S = (over) => ({ hintsOff: false, hideBadges: false, panelOpen: false, ...over });

test("badgesVisible: по умолчанию видны", () => { assert.strictEqual(LLVIS.badgesVisible(S()), true); });
test("badgesVisible: hintsOff (per-tab) скрывает", () => { assert.strictEqual(LLVIS.badgesVisible(S({ hintsOff: true })), false); });
test("badgesVisible: hideBadges (глобально) скрывает", () => { assert.strictEqual(LLVIS.badgesVisible(S({ hideBadges: true })), false); });
test("badgesVisible: открытая панель не влияет", () => { assert.strictEqual(LLVIS.badgesVisible(S({ panelOpen: true })), true); });

test("fabVisible: панель закрыта → FAB как вход в неё", () => { assert.strictEqual(LLVIS.fabVisible(S()), true); });
test("fabVisible: панель подключена к вкладке → FAB не нужен", () => { assert.strictEqual(LLVIS.fabVisible(S({ panelOpen: true })), false); });
test("fabVisible: hintsOff per-tab → без FAB (вернуть — из панели)", () => { assert.strictEqual(LLVIS.fabVisible(S({ hintsOff: true })), false); });
test("fabVisible: hideBadges не прячет FAB", () => { assert.strictEqual(LLVIS.fabVisible(S({ hideBadges: true })), true); });
```
Run: `node --test extension/visibility.test.js` → FAIL (`fabVisible` при `panelOpen`).

- [ ] **Step 2: visibility.js**

```js
/* LoadLens — видимость наших наложений на странице DAT/Truckstop. Панель грузов живёт в боковой
   панели Chrome, на странице — только построчные бейджи и FAB (вход в боковую панель):
   - hintsOff  — per-tab «скрыть всё на этой вкладке» (кнопка в боковой панели)
   - hideBadges — глобальная настройка (ll_hide_badges, вкладка Settings)
   - panelOpen — боковая панель подключена к этой вкладке (порт ll-panel) */
const LLVIS = (() => {
  function badgesVisible(s) { return !s.hintsOff && !s.hideBadges; }
  function fabVisible(s) { return !s.hintsOff && !s.panelOpen; }
  return { badgesVisible, fabVisible };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLVIS; }
if (typeof globalThis !== "undefined") globalThis.LLVIS = LLVIS;
```
Run: `node --test extension/visibility.test.js` → PASS.

- [ ] **Step 3: content.js — состояние**

В блоке `let` вверху файла:
- удалить `let panelCollapsed = false;`, `let hidePanel = false; ...`, `let expandedChainSig = null; ...`;
- добавить:
```js
  let panelPort = null;          // порт боковой панели (runtime.onConnect "ll-panel"), null — панель не смотрит на эту вкладку
  let lastSnapJson = "";         // последний отправленный снапшот — не слать одинаковые (MutationObserver DAT шумит)
  let detailLoadId = null;       // груз, открытый в карточке боковой панели
```
- комментарий шапки файла: `строит «get out» цепочки в плавающей панели` → `строит «get out» цепочки и шлёт снапшот в боковую панель (LLVIEW → sidepanel.js)`.

- [ ] **Step 4: content.js — удалить in-page рендер**

Удалить функции целиком: `safeHttpUrl`, `closeLoadDetail`, `drow`, `openLoadDetail`, `profitText`, `hosIcon`, `crowdText`, `buildPanel`, `exportCsv` (заменится ниже), `chainSig`, `chainCtx`, `HOS_ICON`, `chainCard`, `legRow`, `liveChips`, `crowdShort`, `fmtPickup`, `freshnessText`, `livenessLabel`, `neighborTag`, `strengthBar`, `money`, `row`, `esc` (перед удалением `esc`: `grep -n "esc(" extension/content.js` — вне удаляемых функций использований быть не должно; если есть — заменить на `textContent`).
Добавить после `const log = ...`:
```js
  // тексты бейджей — из LLVIEW, чтобы страница и боковая панель говорили одно и то же
  const profitText = LLVIEW.profitText, crowdText = LLVIEW.crowdText, hosIcon = LLVIEW.hosIcon;
```
Удалить `REPORT_OPTS`? — НЕТ: меню отзыва на странице (`openReportMenu`) остаётся.

- [ ] **Step 5: content.js — FAB, открытие панели, тост**

Заменить `showFab` на:
```js
  // ---------- вход в боковую панель ----------
  // Открыть боковую панель можно только по жесту пользователя: вызываем СИНХРОННО из click-обработчика.
  function openSidePanel() {
    const fail = () => toast("Click the LoadLens icon in the Chrome toolbar to open the panel");
    try {
      chrome.runtime.sendMessage({ type: "open-panel" }, (r) => { if (chrome.runtime.lastError || !r || !r.ok) fail(); });
    } catch (_) { fail(); } // контекст расширения инвалидирован (расширение обновили) — вкладку надо перезагрузить
  }
  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById("ll-toast");
    if (!t) { t = document.createElement("div"); t.id = "ll-toast"; document.body.appendChild(t); }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 4000);
  }
  function showFab() {
    if (document.getElementById("ll-fab")) return;
    const f = document.createElement("button");
    f.id = "ll-fab"; f.textContent = "🚚 LoadLens"; f.title = "Open the LoadLens side panel";
    f.onclick = openSidePanel;
    document.body.appendChild(f);
  }
  function removeFab() { const f = document.getElementById("ll-fab"); if (f) f.remove(); }
  function openDetailInPanel(load) {
    openSidePanel();                 // первым — пока жест клика жив
    detailLoadId = String(load.loadId);
    render();
  }
```
В `fleetChip` и `detailChip` заменить `openLoadDetail(load)` на `openDetailInPanel(load)`.

- [ ] **Step 6: content.js — снапшот и отправка**

Добавить (рядом с `render`):
```js
  // ---------- боковая панель: снапшот ----------
  function postSnapshot(snap) {
    if (!panelPort) return;
    const json = JSON.stringify(snap);
    if (json === lastSnapJson) return; // ничего не поменялось — не будим панель
    lastSnapJson = json;
    panelSend({ type: "snapshot", data: snap });
  }
  function panelSend(msg) {
    if (!panelPort) return;
    try { panelPort.postMessage(msg); } catch (_) { panelPort = null; }
  }
  const look = {
    laneMedianOf: (o, d, e) => { const v = laneCache.get(laneKeyOf({ originMarket: o, destMarket: d, equipment: e })); return v == null ? null : v; },
    rep: (mc) => repCache.get(String(mc)) || null,
    strength: strengthOf,
    density: (m) => (crowdCache.get(m) || []).length,
    age: ageOf,
    brokerBadge: (l) => LLSCORE.brokerBadge(l),
  };
  // факты для карточки груза — те же расчёты, что были в openLoadDetail
  function detailFacts(load) {
    const laneMedian = look.laneMedianOf(load.originMarket, load.destMarket, load.equipment);
    const rep = load.brokerMc ? look.rep(load.brokerMc) : null;
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: rep });
    const offer = LLSCORE.counterOffer(load, { laneMedian, costPerMile });
    let mail = null;
    if (load.contactEmail && typeof LLMAIL !== "undefined") {
      const subject = LLMAIL.subjectFor(load);
      const body = LLMAIL.fillTemplate(mailTemplate, load, activeDriver, { counterOffer: offer.script });
      mail = { url: LLMAIL.gmailComposeUrl(load.contactEmail, subject, body), text: subject + "\n\n" + body };
    }
    return {
      laneMedian, rep, flags, offer, mail,
      profit: LLSCORE.profitBadge(load, { costPerMile, dieselPrice, laneMedian, targetRpm: targetFor(load) }),
      hos: hosBadge(load),
      broker: LLSCORE.brokerBadge(load),
      flagLevel: flags.length ? LLSCORE.redFlagLevel(flags) : null,
      trueRpm: LLSCORE.trueRpm(load.rate, load.loadedMiles, load.deadheadMiles),
      fleet: drivers.length && typeof LLFLEET !== "undefined" ? fleetMatch(load) : null,
    };
  }
```

- [ ] **Step 7: content.js — хвост `render()`**

Заменить всё в `render()` от `clearBadges();` до конца функции на:
```js
    clearBadges();
    const vis = { hintsOff, hideBadges, panelOpen: !!panelPort };
    // построчные бейджи: матчим видимые DOM-строки с грузами (DAT — по resultId, TS — parseRow).
    if (LLVIS.badgesVisible(vis)) {
      (adapter.anchor ? adapter.anchor(loads) : []).forEach((p) => badgeRow(p.anchor || p.row, p.load));
    }
    if (LLVIS.fabVisible(vis)) showFab(); else removeFab();

    // Цепочки/Hot loads/деталь нужны только боковой панели — без подключённого порта не считаем.
    if (!panelPort) return;
    const pool = chainPool(loads);
    const chains = buildChains(pool, start).filter((c) => c.legs.length >= 1);
    // «Выгодные сейчас» — свежие вперёд: из двух зелёных первым нужен тот, что ещё не разобрали.
    const dealOrder = new Map(freshestFirst(greens.map((d) => d.l)).map((l, i) => [l, i]));
    const deals = greens.slice().sort((a, b) => dealOrder.get(a.l) - dealOrder.get(b.l)).slice(0, 5);
    // груз ушёл из выдачи (новый поиск) → карточка закрывается, панель возвращается к списку
    const detailLoad = detailLoadId != null ? loads.find((l) => String(l.loadId) === detailLoadId) || null : null;
    if (!detailLoad) detailLoadId = null;
    postSnapshot(LLVIEW.build({
      board: adapter.board, loads, pool, chains, deals, start, dieselPrice, costPerMile, equipFilter,
      autoRefreshOn: autoRefresh.on, cloud: !!cloudCfg, sseLive: sseLive(), sortPref, sortFields: SORT_FIELDS,
      drivers, activeDriverId: activeDriver ? activeDriver.id : null, hintsOff,
      detailLoad, detailFacts: detailLoad ? detailFacts(detailLoad) : null, now: Date.now(), look,
    }));
  }
```
(Ранний `return` при `!LLVIS.panelVisible(...)` и весь блок `buildPanel()`/`bd.innerHTML`/обработчики — удалены этой заменой.)

- [ ] **Step 8: content.js — CSV через панель**

```js
  // Pro-экспорт CSV видимых грузов (гейт через LLAPI.getMe().plan). Файл скачивает боковая панель:
  // у content-скрипта после async-проверки плана уже нет жеста, а страница расширения качать может.
  async function exportCsv(loads) {
    const me = typeof LLAPI !== "undefined" ? await LLAPI.getMe() : null;
    if (!me || me.plan !== "pro") return panelSend({ type: "notice", text: "CSV export is a Pro feature. Sign in on the Settings tab." });
    if (!loads.length) return panelSend({ type: "notice", text: "No loads to export." });
    panelSend({ type: "csv", filename: `loadlens_${adapter.board}_${new Date().toISOString().slice(0, 10)}.csv`, csv: LLCSV.buildLoadsCsv(loads) });
  }
```

- [ ] **Step 9: content.js — команды панели**

```js
  // ---------- боковая панель: команды ----------
  async function onPanelCmd(m) {
    if (!m || m.type !== "cmd") return;
    switch (m.cmd) {
      case "setDriver":
        activeDriver = (typeof LLDRV !== "undefined") ? LLDRV.pickActive(drivers, m.id) : null;
        if (typeof LLDRV !== "undefined") await LLDRV.setActive(m.id);
        break;
      case "setCpm": { const v = parseFloat(m.value); if (v > 0) baseCostPerMile = v; break; }
      case "setStart": currentMarket = String(m.market || "").trim().toUpperCase() || null; break;
      case "setAutorefresh":
        if (cloudCfg) break; // в облаке авто-пилот всегда ВКЛ — снапшот вернёт галку назад
        autoRefresh.on = !!m.on;
        if (typeof LLTAB !== "undefined") LLTAB.setAutorefresh(sessionStorage, autoRefresh.on);
        scheduleAuto();
        if (autoRefresh.on && autoRefresh.scroll) scrollToLoadAll(); // доскроллить уже открытую выдачу сразу
        break;
      case "setSort": {
        const patch = {};
        if ("field" in m) patch.field = m.field || null;
        if ("dir" in m) patch.dir = m.dir === "asc" ? "asc" : "desc";
        await persistSort(patch); // storage.onChanged → applySortPref + schedule
        break;
      }
      case "scrollToRow": {
        const ok = m.resultId != null && adapter && typeof adapter.scrollToRow === "function" && adapter.scrollToRow(m.resultId);
        panelSend({ type: "scrollResult", ok: !!ok });
        return;
      }
      case "openDetail": detailLoadId = m.loadId != null ? String(m.loadId) : null; break;
      case "closeDetail": detailLoadId = null; break;
      case "exportCsv": exportCsv(currentLoads()); return;
      case "setHintsOff":
        hintsOff = !!m.on;
        if (typeof LLTAB !== "undefined") LLTAB.setHintsOff(sessionStorage, hintsOff);
        break;
      case "reportBroker":
        if (m.mc && typeof LLAPI !== "undefined") {
          const ok = await LLAPI.reportBroker(String(m.mc), m.outcome);
          panelSend({ type: "notice", text: ok ? "Thanks — review saved." : "Could not save the review." });
          if (ok) refreshRep(String(m.mc));
        }
        return;
      default: return;
    }
    render();
  }
```

- [ ] **Step 10: content.js — `boot()`**

- в `chrome.storage.local.get([...])` и деструктуризации убрать `ll_hide_panel`; удалить строку `hidePanel = !!ll_hide_panel;`; в `onChanged` удалить `if (ch.ll_hide_panel) ...`;
- перед финальным `render();` в `boot()` добавить:
```js
    // боковая панель подключается к активной вкладке борда портом ll-panel
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== "ll-panel") return;
      panelPort = port;
      lastSnapJson = ""; // новому слушателю — полный снапшот сразу
      port.onMessage.addListener((m) => { onPanelCmd(m).catch((err) => log("panel cmd error", err)); });
      port.onDisconnect.addListener(() => { if (panelPort === port) { panelPort = null; render(); } });
      render();
    });
```
- в delta-poll интервале заменить `if (panelCollapsed || document.visibilityState !== "visible") return;` на `if (!panelPort || document.visibilityState !== "visible") return;` и комментарий `пока панель открыта` → `пока боковая панель смотрит на эту вкладку`.

- [ ] **Step 11: Проверка остатков**

Run: `grep -n "panelCollapsed\|hidePanel\|ll-panel\"\|getElementById(\"ll-panel\|ll-detail\|openLoadDetail\|expandedChainSig\|buildPanel" extension/content.js`
Expected: пусто (кроме строки `port.name !== "ll-panel"`).

Run: `grep -nw "safeHttpUrl\|drow\|chainSig\|chainCtx\|chainCard\|legRow\|liveChips\|crowdShort\|fmtPickup\|freshnessText\|livenessLabel\|neighborTag\|strengthBar\|money\|row\|esc\|HOS_ICON\|closeLoadDetail" extension/content.js`
Expected: пусто — ни одной ссылки на удалённые функции (иначе ReferenceError в рантайме, тесты его не поймают).

Run: `node -e "new (require('vm').Script)(require('fs').readFileSync('extension/content.js','utf8'))" && npm test`
Expected: синтаксис ок, все тесты PASS.

- [ ] **Step 12: styles.css**

- удалить все правила с селекторами `#ll-panel` и `#ll-detail` (блоки «карточка детали груза» и «плавающая панель» + аккордеон/плечи/deal/ll-ft/note) — предварительно СКОПИРОВАТЬ их в буфер для Task 5 (`grep -n "#ll-panel\|#ll-detail" extension/styles.css > /tmp/…` не нужен — Task 5 даёт готовый CSS);
- оставить: бейджи, `#ll-report-menu`, `@keyframes ll-row-flash`/`.ll-row-flash`, `#ll-fab`;
- добавить:
```css
#ll-toast {
  position: fixed; right: 16px; bottom: 64px; z-index: 2147483647; max-width: 280px;
  background: #0f1720; color: #fff; padding: 9px 12px; border-radius: 10px;
  font: 600 12.5px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; box-shadow: 0 8px 20px rgba(15,23,42,.3);
}
```
- шапка-комментарий файла: `бейджи на строках грузов + плавающая панель` → `бейджи на строках грузов, FAB и меню отзыва (панель грузов — в боковой панели, sidepanel.css)`.

Run: `grep -c "#ll-panel\|#ll-detail" extension/styles.css` → `0`.

- [ ] **Step 13: Commit**

```bash
git add extension/content.js extension/visibility.js extension/visibility.test.js extension/styles.css
git commit -m "feat(sidepanel): content.js шлёт снапшот в боковую панель, in-page панель убрана"
```

---

### Task 5: sidepanel.js — порт, рендер Loads, команды

**Files:**
- Modify: `extension/sidepanel.js` (целиком), `extension/sidepanel.html` (+ скрипты), `extension/sidepanel.css` (+ стили Loads)

**Interfaces:**
- Consumes: `LLPANEL.isBoardUrl/loadsView/empty` (Task 3); протокол порта (Task 4).

- [ ] **Step 1: sidepanel.html — подключить рендер**

Перед `<script src="sidepanel.js"></script>` добавить `<script src="panel/render.js"></script>`.

- [ ] **Step 2: sidepanel.js**

```js
/* LoadLens side panel: вкладки Loads/Settings. Вкладка Settings — бывший попап (popup.js).
   Loads: порт ll-panel к content.js АКТИВНОЙ вкладки борда в этом окне; content шлёт снапшоты
   (LLVIEW), мы рисуем их LLPANEL и отправляем команды обратно. Фоновые вкладки не подключены —
   их авто-пилот не тратит CPU на снапшоты. */
(() => {
  "use strict";
  const $loads = document.getElementById("loads");
  let winId = null;
  let port = null, portTabId = null;
  let snap = null, lastJson = "", lastDetailId = null;
  let expandedSig = null;        // раскрытая цепочка — чисто панельное состояние
  let notice = "", noticeTimer = null;
  let deferred = false;          // снапшот пришёл, пока пользователь в поле ввода — рисуем на blur
  let retriedTab = null;         // одна повторная попытка на вкладку (content ещё не успел загрузиться)

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.getElementById("tab-loads").hidden = name !== "loads";
    document.getElementById("tab-settings").hidden = name !== "settings";
  }
  document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

  // Перерисовка innerHTML сбросила бы ввод — пока фокус в поле/селекте панели, откладываем.
  function editing() {
    const a = document.activeElement;
    return !!a && $loads.contains(a) && (a.tagName === "SELECT" || (a.tagName === "INPUT" && (a.type === "text" || a.type === "number")));
  }
  function paint() {
    if (!snap) return;
    if (editing()) { deferred = true; return; }
    deferred = false;
    $loads.innerHTML = LLPANEL.loadsView(snap, { expandedSig, notice });
  }
  $loads.addEventListener("focusout", () => { if (deferred) setTimeout(paint, 0); });

  function flash(text) {
    notice = text; paint();
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ""; paint(); }, 2500);
  }
  function download(filename, csv) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function showEmpty(kind) { snap = null; lastJson = ""; $loads.innerHTML = LLPANEL.empty(kind); }

  function onMsg(m) {
    if (!m) return;
    if (m.type === "snapshot") {
      const json = JSON.stringify(m.data);
      if (json === lastJson) return;
      lastJson = json; snap = m.data;
      const did = snap.detail ? snap.detail.loadId : null;
      if (did != null && did !== lastDetailId) showTab("loads"); // клик ⓘ на странице — показать карточку
      lastDetailId = did;
      paint();
    } else if (m.type === "scrollResult") {
      if (!m.ok) flash("Load is not in the visible results");
    } else if (m.type === "csv") {
      download(m.filename, m.csv);
    } else if (m.type === "notice") {
      flash(m.text);
    }
  }
  function send(cmd, args) {
    if (!port) return;
    try { port.postMessage({ type: "cmd", cmd, ...(args || {}) }); } catch (_) { port = null; portTabId = null; }
  }

  function disconnect() {
    if (port) { try { port.disconnect(); } catch (_) { /* уже закрыт */ } }
    port = null; portTabId = null;
  }
  async function connectActive() {
    let tab = null;
    try { [tab] = await chrome.tabs.query({ active: true, windowId: winId }); } catch (_) { tab = null; }
    // URL есть только у вкладок из host_permissions — у остальных он undefined → «не борд»
    if (!tab || !LLPANEL.isBoardUrl(tab.url)) { disconnect(); showEmpty("not-board"); return; }
    if (port && portTabId === tab.id) return;
    disconnect();
    showEmpty("connecting");
    const p = chrome.tabs.connect(tab.id, { name: "ll-panel" });
    port = p; portTabId = tab.id;
    let gotAny = false;
    p.onMessage.addListener((m) => { gotAny = true; onMsg(m); });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // «Could not establish connection» — ожидаемо, не шумим в консоль
      if (port !== p) return;       // уже переподключились к другой вкладке
      port = null; portTabId = null;
      if (gotAny) return;           // вкладка перезагружается — переподключимся на onUpdated(complete)
      if (retriedTab !== tab.id) { retriedTab = tab.id; setTimeout(connectActive, 1500); return; }
      showEmpty("no-script");
    });
  }

  chrome.tabs.onActivated.addListener((info) => { if (info.windowId === winId) { retriedTab = null; connectActive(); } });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.active || tab.windowId !== winId) return;
    if (info.status === "complete" || info.url) connectActive();
  });

  $loads.addEventListener("click", (e) => {
    const el = e.target.closest("[data-cmd]");
    if (!el) return;
    const c = el.dataset.cmd;
    if (c === "toggleChain") { expandedSig = expandedSig === el.dataset.sig ? null : el.dataset.sig; paint(); return; }
    if (c === "copy") {
      const a = snap && snap.detail && snap.detail.actions;
      const text = a && (el.dataset.what === "email" ? a.copyEmail : a.copy);
      if (text) navigator.clipboard.writeText(text).then(() => flash("Copied ✓"), () => flash("Clipboard is not available"));
      return;
    }
    if (c === "scrollToRow") { if (!el.dataset.result) flash("Load is not in the visible results"); else send("scrollToRow", { resultId: el.dataset.result }); return; }
    if (c === "setSortDir") return send("setSort", { dir: el.dataset.dir });
    if (c === "setHintsOff") return send("setHintsOff", { on: el.dataset.on === "1" });
    if (c === "openDetail") return send("openDetail", { loadId: el.dataset.load });
    if (c === "reportBroker") return send("reportBroker", { mc: el.dataset.mc, outcome: el.dataset.outcome });
    if (c === "closeDetail" || c === "exportCsv") return send(c);
  });
  $loads.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "ll-driver") send("setDriver", { id: t.value });
    else if (t.id === "ll-cpm") send("setCpm", { value: t.value });
    else if (t.id === "ll-start") send("setStart", { market: t.value });
    else if (t.id === "ll-ar") send("setAutorefresh", { on: t.checked });
    else if (t.id === "ll-sort-f") send("setSort", { field: t.value || null });
    else return;
    // значение ушло во вкладку — отпускаем фокус, иначе отложенная перерисовка ждала бы клика мимо
    if (t.tagName === "SELECT" || t.type === "text" || t.type === "number") t.blur();
  });

  chrome.windows.getCurrent().then((w) => { winId = w.id; connectActive(); });
})();
```

- [ ] **Step 3: sidepanel.css — стили Loads**

Дописать в конец `extension/sidepanel.css` (перенос бывших `#ll-panel`/`#ll-detail` под `#loads`, без позиционирования плавающего окна):
```css
/* ----- вкладка Loads (бывшая плавающая панель) ----- */
#loads .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #eef1f4; }
#loads .row .k, #loads .ll-driver .k { color: #6b7785; }
#loads .ll-driver { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
#loads .ll-driver select { flex: 1; }
#loads h4 { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color: #1e3a8a; }
#loads .ll-cfg { font-size: 12px; color: #475569; margin: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#loads .ll-cfg input[type=number] { width: 64px; } #loads .ll-cfg input[type=text] { width: 120px; }
#loads .ll-cfg input, #loads .ll-cfg select { border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 5px; font: inherit; }
#loads .ll-cfg button, #loads .ll-ft button { width: auto; margin: 0; }
#loads .ll-live { color: #16a34a; font-weight: 600; font-size: 11px; letter-spacing: .02em; }
#loads .chain { padding: 6px 8px; margin: 5px 0; border-radius: 9px; background: #f8fafc; border-left: 3px solid #94a3b8; }
#loads .chain.ll-green { border-left-color: #16a34a; }
#loads .chain.ll-amber { border-left-color: #d97706; }
#loads .chain.ll-red { border-left-color: #dc2626; }
#loads .chain .route { font-weight: 700; font-size: 12.5px; }
#loads .chain .meta { color: #64748b; font-size: 11.5px; margin-top: 2px; }
#loads .chain .chain-hd { cursor: pointer; }
#loads .chain .caret { color: #94a3b8; font-weight: 700; }
#loads .chain.open { background: #eef4ff; }
#loads .chain-legs { margin-top: 6px; border-top: 1px dashed #e2e8f0; }
#loads .leg { padding: 7px 2px 7px 8px; border-bottom: 1px dashed #eef1f4; }
#loads .leg:last-child { border-bottom: 0; }
#loads .leg.leg-live { cursor: pointer; }
#loads .leg.leg-live:hover { background: #f1f5f9; border-radius: 6px; }
#loads .leg.leg-fc { opacity: .72; }
#loads .leg-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
#loads .leg-tag { font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 9px; white-space: nowrap; }
#loads .leg-tag.live { background: #dcfce7; color: #166534; }
#loads .leg-tag.fc { background: #eef1f4; color: #64748b; }
#loads .leg-idx { font-size: 10px; color: #94a3b8; white-space: nowrap; }
#loads .leg-route { font-weight: 700; font-size: 12px; margin-top: 3px; }
#loads .leg-eco { font-size: 11.5px; color: #475569; margin-top: 2px; }
#loads .leg-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
#loads .lchip { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: #eef1f4; color: #475569; white-space: nowrap; }
#loads .lchip.good { background: #dcfce7; color: #166534; }
#loads .lchip.ok { background: #fef9c3; color: #854d0e; }
#loads .lchip.risk { background: #fee2e2; color: #991b1b; }
#loads .lchip.book { background: #dbeafe; color: #1e40af; }
#loads .leg-nb { margin-left: 6px; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: #eef1f4; color: #64748b; white-space: nowrap; }
#loads .deal { display: flex; justify-content: space-between; padding: 4px 2px; font-size: 12.5px; cursor: pointer; border-radius: 6px; }
#loads .deal:hover { background: #f1f5f9; }
#loads .deal .p { font-weight: 700; color: #166534; }
#loads .deal .age { color: #64748b; font-size: 11px; }
#loads .ll-ft { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
#loads .ll-ft button { border: 1px solid #e2e8f0; background: #f5f7f9; font-weight: 600; padding: 7px 12px; border-radius: 9px; cursor: pointer; font: inherit; color: #0f1720; }
#loads .pro-tag { font-size: 10.5px; font-weight: 800; padding: 2px 7px; border-radius: 99px; background: #1d4ed8; color: #fff; }
#loads .note { color: #9aa6b2; font-size: 11px; margin-top: 8px; }
#loads .notice { margin: 8px 0; padding: 7px 10px; border-radius: 8px; background: #eef2ff; color: #1e3a8a; font-weight: 600; }
/* карточка груза */
#loads .dhd { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
#loads .dhd .back { width: auto; margin: 0; padding: 4px 10px; }
#loads .dhd .ttl { font-weight: 800; }
#loads .drow { display: flex; gap: 10px; padding: 5px 0; border-bottom: 1px dashed #eef1f4; }
#loads .drow .k { color: #6b7785; min-width: 72px; flex-shrink: 0; }
#loads .drow .v { font-weight: 600; word-break: break-word; }
#loads .drow .v a { color: #1d4ed8; text-decoration: none; }
#loads .comments, #loads .flags { font-weight: 400; white-space: pre-wrap; color: #334155; }
#loads .flags { color: #991b1b; margin-top: 6px; }
#loads .fleet-match { margin-top: 10px; border-top: 1px solid #eef1f4; padding-top: 8px; }
#loads .fleet-h { font-weight: 700; color: #1e3a8a; margin-bottom: 4px; }
#loads .fleet-row { padding: 3px 0; font-size: 12.5px; }
#loads .fleet-row.ll-ok { color: #166534; } #loads .fleet-row.ll-no { color: #94a3b8; }
#loads .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
#loads .btn { width: auto; margin: 0; border: 1px solid #e2e8f0; background: #f5f7f9; color: #0f1720; padding: 8px 12px; border-radius: 9px; cursor: pointer; font: 600 13px inherit; text-decoration: none; }
#loads .btn:hover { background: #eef1f4; }
#loads .btn.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
#loads .review { margin-top: 10px; }
#loads .review summary { cursor: pointer; color: #1e3a8a; font-weight: 700; }
#loads .ll-rep-opt { display: block; width: 100%; text-align: left; margin-top: 4px; }
```

- [ ] **Step 4: Прогон**

Run: `npm test && npm run package:ext`
Expected: тесты PASS; в выводе пакета есть `panel/render.js`, `sidepanel.js`, `background.js`, `view-model.js`, нет `popup.html`.

- [ ] **Step 5: Живая проверка на DAT (с пользователем — его сессия DAT)**

Загрузить `extension/` распакованным (или `dist/extension`), перезагрузить вкладки DAT. Чек-лист — каждый пункт отметить результатом:
1. Иконка → боковая панель; на DAT-вкладке Loads показывает шапку/цепочки/Hot loads; FAB на странице исчезает, пока панель открыта.
2. **Жест:** панель закрыта → клик FAB открывает панель. Если нет — тост «Click the LoadLens icon…» (фолбэк; записать результат в спеку, раздел «Риск»).
3. Клик `ⓘ details` в строке → панель (открывается/переключается на Loads) с карточкой; Back → список; Email/Call/Copy работают.
4. Две DAT-вкладки: переключение меняет выдачу в панели; не-DAT вкладка → заглушка; DAT-вкладка, открытая до обновления расширения → «Reload the DAT tab».
5. Live-плечо цепочки → прокрутка к строке с подсветкой; плечо вне DOM → «Load is not in the visible results».
6. Cost/mi/Start: печатать в поле, пока DAT шумит мутациями, — ввод не стирается.
7. Driver/Sort/Auto-refresh из панели применяются во вкладке; авто-пилот в ФОНОВОЙ вкладке продолжает тикать.
8. CSV (Pro) скачивается; Free → notice.
9. 🙈 Hide on page → бейджи и FAB пропадают; 👁 Show on page → возвращаются.
10. Отзыв о брокере из карточки → notice «Thanks — review saved.», чип 👥 в строке обновился.

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel.js extension/sidepanel.html extension/sidepanel.css
git commit -m "feat(sidepanel): вкладка Loads — порт к активной вкладке борда, команды, карточка груза"
```

---

### Task 6: Документация + версия 0.9.0

**Files:**
- Modify: `CLAUDE.md` (дерево `extension/`, пункты конвенций про панель/попап), `extension/manifest.json` (`version`), `docs/superpowers/specs/2026-09-24-side-panel-design.md` (итог риска жеста)

- [ ] **Step 1: CLAUDE.md**

В дереве `extension/`:
- `popup.*` → `sidepanel.html/css/js  боковая панель (chrome.sidePanel): вкладка Loads (снапшот активной вкладки борда по порту ll-panel) + Settings (popup.js — бывший попап)`;
- добавить строки: `background.js  SW: setPanelBehavior + open-panel (FAB/бейджи → sidePanel.open)`, `view-model.js (LLVIEW)  чистая сборка снапшота панели из состояния content.js`, `panel/render.js (LLPANEL)  снапшот → HTML вкладки Loads`;
- `visibility.js (LLVIS)` → `чистый badgesVisible/fabVisible: hintsOff(per-tab) + ll_hide_badges + panelOpen`;
- `content.js` → `... ; панель — только снапшот в порт ll-panel (LLVIEW), свой DOM — бейджи, FAB, меню отзыва`.
В конвенциях: везде, где «попап» означает UI настроек → «вкладка Settings боковой панели»; «шапка панели» → «вкладка Loads». Добавить пункт:
```
- **Боковая панель (с 2026-09-24).** UI — `chrome.sidePanel` (Chrome 116+), не попап и не DOM страницы.
  `content.js` — «мозг»: на каждый render строит `LLVIEW.build` (только данные) и шлёт в порт `ll-panel`,
  который открывает панель к АКТИВНОЙ вкладке борда (фоновые вкладки не платят за снапшоты; без порта
  цепочки/Hot loads не считаются, скоринг/алерты — всегда). Панель рисует `LLPANEL` и шлёт команды
  (`setDriver/setSort/scrollToRow/openDetail/...`). Дедуп снапшота по JSON с обеих сторон — DAT шумит
  мутациями. `sidePanel.open` — только по жесту: FAB/бейдж зовут `open-panel` синхронно из клика;
  <итог живой проверки жеста из Task 5>. Спека — `docs/superpowers/specs/2026-09-24-side-panel-design.md`.
```
(вставить фактический итог пункта 2 чек-листа Task 5 вместо `<…>`).

- [ ] **Step 2: Итог риска в спеке**

В спеке, раздел «Риск», дописать строку `**Итог (дата):** …` — работает ли жест из content через `runtime.sendMessage`.

- [ ] **Step 3: Версия**

`extension/manifest.json`: `"version": "0.9.0"`.

Run: `npm test && npm run package:ext`
Expected: PASS; `dist/loadlens-extension-0.9.0.zip`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md extension/manifest.json docs/superpowers/specs/2026-09-24-side-panel-design.md
git commit -m "chore(release): 0.9.0 — боковая панель вместо попапа и плавающей панели"
```

Публикацию в Chrome Web Store (`npm run publish:ext -- --publish`) — только по явному решению пользователя.
