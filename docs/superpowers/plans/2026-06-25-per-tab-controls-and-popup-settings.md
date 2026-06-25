# Per-tab контролы + сворачивание настроек попапа — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать авто-пилот и наши подсказки управляемыми отдельно по вкладкам, а блок настроек в попапе свернуть под аккаунт.

**Architecture:** Per-tab состояние храним в `sessionStorage` (привязан к вкладке+origin, переживает reload). Чистую per-tab логику выносим в новый IIFE-модуль `extension/tabstate.js` (`LLTAB`) — единственная тестируемая единица; `content.js`/`popup.js` правки проверяются `npm test` (регресс существующих) + ручной проверкой в живой сессии DAT (DOM/chrome API под node:test без jsdom не тестируются).

**Tech Stack:** Vanilla JS, Chrome MV3 content script + popup, `node:test` (без jsdom).

## Global Constraints

- **Не трогать** `shared/`, `vendor/`, бэкенд, скоринг, Telegram-алерты, DOM-селекторы DAT.
- Интервал авто-рефреша **≥60с** (ToS, имитация человека) — существующий `Math.max(60000, …)` сохранить.
- Модули расширения — IIFE с `module.exports` + `globalThis.<NAME>` (паттерн `LLAPI`/`LLDRV`/`LLALERT`).
- Per-tab ключи `sessionStorage`: `ll_tab_autorefresh` (`"1"`/`"0"`), `ll_tab_hints_off` (`"1"`/`"0"`).
- Существующий `sessionStorage.ll_autopilot_reload` не переименовывать и не ломать.
- Коммиты на русском, без упоминаний AI/Claude.

---

### Task 1: `tabstate.js` — чистый per-tab модуль `LLTAB` + тесты + манифест

**Files:**
- Create: `extension/tabstate.js`
- Test: `extension/tabstate.test.js`
- Modify: `extension/manifest.json` (добавить `tabstate.js` в `content_scripts[0].js` перед `content.js`)

**Interfaces:**
- Produces:
  - `LLTAB.getAutorefresh(ss) -> boolean` — `true`, если `ss.getItem("ll_tab_autorefresh") === "1"`.
  - `LLTAB.setAutorefresh(ss, on) -> void` — пишет `"1"`/`"0"`.
  - `LLTAB.getHintsOff(ss) -> boolean` — `true`, если `ss.getItem("ll_tab_hints_off") === "1"`.
  - `LLTAB.setHintsOff(ss, off) -> void` — пишет `"1"`/`"0"`.
  - Все функции толерантны к исключениям/`null` storage (возвращают дефолт `false`).

- [ ] **Step 1: Написать падающий тест**

Создать `extension/tabstate.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const LLTAB = require("./tabstate.js");

// фейковый sessionStorage-подобный объект
function fakeSS(init) {
  const store = { ...(init || {}) };
  return { store, getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
}

test("getAutorefresh: '1' → true, иначе false", () => {
  assert.strictEqual(LLTAB.getAutorefresh(fakeSS({ ll_tab_autorefresh: "1" })), true);
  assert.strictEqual(LLTAB.getAutorefresh(fakeSS({ ll_tab_autorefresh: "0" })), false);
  assert.strictEqual(LLTAB.getAutorefresh(fakeSS()), false);
});

test("setAutorefresh: пишет '1'/'0'", () => {
  const ss = fakeSS();
  LLTAB.setAutorefresh(ss, true);
  assert.strictEqual(ss.store.ll_tab_autorefresh, "1");
  LLTAB.setAutorefresh(ss, false);
  assert.strictEqual(ss.store.ll_tab_autorefresh, "0");
});

test("getHintsOff: '1' → true, дефолт false", () => {
  assert.strictEqual(LLTAB.getHintsOff(fakeSS({ ll_tab_hints_off: "1" })), true);
  assert.strictEqual(LLTAB.getHintsOff(fakeSS()), false);
});

test("setHintsOff: пишет '1'/'0'", () => {
  const ss = fakeSS();
  LLTAB.setHintsOff(ss, true);
  assert.strictEqual(ss.store.ll_tab_hints_off, "1");
  LLTAB.setHintsOff(ss, false);
  assert.strictEqual(ss.store.ll_tab_hints_off, "0");
});

test("толерантность: null storage и бросающий getItem → дефолт false", () => {
  assert.strictEqual(LLTAB.getAutorefresh(null), false);
  assert.strictEqual(LLTAB.getHintsOff({ getItem: () => { throw new Error("blocked"); } }), false);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test extension/tabstate.test.js`
Expected: FAIL — `Cannot find module './tabstate.js'`

- [ ] **Step 3: Написать минимальную реализацию**

Создать `extension/tabstate.js`:

```js
/* LoadLens per-tab состояние. Хранит флаги в sessionStorage (привязан к вкладке+origin,
   переживает location.reload()). Чистый модуль: storage инъектится — тестируется без браузера. */
const LLTAB = (() => {
  "use strict";
  const K_AR = "ll_tab_autorefresh";
  const K_HINTS = "ll_tab_hints_off";

  function readFlag(ss, key) {
    try { return !!ss && ss.getItem(key) === "1"; } catch (_) { return false; }
  }
  function writeFlag(ss, key, val) {
    try { if (ss) ss.setItem(key, val ? "1" : "0"); } catch (_) { /* приватный режим/квота */ }
  }

  return {
    getAutorefresh: (ss) => readFlag(ss, K_AR),
    setAutorefresh: (ss, on) => writeFlag(ss, K_AR, on),
    getHintsOff: (ss) => readFlag(ss, K_HINTS),
    setHintsOff: (ss, off) => writeFlag(ss, K_HINTS, off),
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLTAB; }
if (typeof globalThis !== "undefined") globalThis.LLTAB = LLTAB;
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test extension/tabstate.test.js`
Expected: PASS (5 тестов)

- [ ] **Step 5: Подключить модуль в манифесте**

В `extension/manifest.json`, в `content_scripts[0].js`, добавить `"tabstate.js"` **сразу перед** `"content.js"`:

```json
        "drivers.js",
        "alerts.js",
        "csv.js",
        "tabstate.js",
        "content.js"
```

- [ ] **Step 6: Полный прогон тестов — регресс зелёный**

Run: `npm test`
Expected: PASS (все shared + extension тесты, включая новые 5)

- [ ] **Step 7: Commit**

```bash
git add extension/tabstate.js extension/tabstate.test.js extension/manifest.json
git commit -m "feat(extension): LLTAB — per-tab флаги в sessionStorage (авто-пилот/подсказки)"
```

---

### Task 2: `content.js` — авто-пилот per-tab

**Files:**
- Modify: `extension/content.js` (boot ~806, panel-handler ~533, onChanged ~830-834, удалить `persistAuto` ~780-783)

**Interfaces:**
- Consumes: `LLTAB.getAutorefresh(sessionStorage)`, `LLTAB.setAutorefresh(sessionStorage, on)` (Task 1).
- Produces: ничего для следующих задач (внутренние правки).

- [ ] **Step 1: Boot — источник `autoRefresh.on` теперь per-tab**

В `extension/content.js` заменить строку ~806:

```js
      if (ll_autorefresh && typeof ll_autorefresh === "object") autoRefresh = { on: !!ll_autorefresh.on, intervalMs: ll_autorefresh.intervalMs || 60000 };
```

на:

```js
      // intervalMs — глобальный параметр из попапа; on — per-tab (sessionStorage), дефолт выкл.
      autoRefresh = {
        on: (typeof LLTAB !== "undefined") && LLTAB.getAutorefresh(sessionStorage),
        intervalMs: (ll_autorefresh && ll_autorefresh.intervalMs) || 60000,
      };
```

- [ ] **Step 2: Чекбокс в шапке панели — пишет per-tab + перепланирует**

Заменить строки ~532-533:

```js
    const ar = bd.querySelector("#ll-ar");
    if (ar) ar.onchange = () => persistAuto({ on: ar.checked });
```

на:

```js
    const ar = bd.querySelector("#ll-ar");
    if (ar) ar.onchange = () => {
      autoRefresh.on = ar.checked;
      if (typeof LLTAB !== "undefined") LLTAB.setAutorefresh(sessionStorage, ar.checked);
      scheduleAuto();
    };
```

- [ ] **Step 3: Удалить `persistAuto` (больше не пишем `on` в global)**

Удалить функцию `persistAuto` целиком (строки ~779-783):

```js
  // персист настроек авто-пилота: пишем в storage → onChanged применяет (scheduleAuto/applySortPref/render)
  async function persistAuto(patch) {
    autoRefresh = { ...autoRefresh, ...patch };
    try { await chrome.storage.local.set({ ll_autorefresh: autoRefresh }); } catch (_) { scheduleAuto(); schedule(); }
  }
```

(Оставить `persistSort` рядом — он про сортировку, его не трогаем.)

- [ ] **Step 4: `onChanged` для `ll_autorefresh` — обновлять только интервал**

Заменить строки ~830-834:

```js
        if (ch.ll_autorefresh) {
          const v = ch.ll_autorefresh.newValue;
          autoRefresh = (v && typeof v === "object") ? { on: !!v.on, intervalMs: v.intervalMs || 60000 } : { on: false, intervalMs: 60000 };
          scheduleAuto();
        }
```

на:

```js
        if (ch.ll_autorefresh) {
          const v = ch.ll_autorefresh.newValue;
          autoRefresh.intervalMs = (v && v.intervalMs) || 60000; // on — per-tab, из попапа не меняем
          scheduleAuto();
        }
```

- [ ] **Step 5: Регресс-тесты зелёные**

Run: `npm test`
Expected: PASS (поведение чистых модулей не менялось; `persistAuto` нигде больше не вызывается — проверить `grep`)

Run: `grep -n "persistAuto" extension/content.js`
Expected: пусто (ни одной ссылки)

- [ ] **Step 6: Ручная проверка в живой сессии DAT**

1. `chrome://extensions` → перезагрузить распакованное расширение.
2. Открыть выдачу DAT в **двух** вкладках.
3. В шапке панели вкладки A включить «Авто-рефреш» → в вкладке B чекбокс остаётся **выключенным**.
4. Подождать интервал — обновляется только вкладка A.
5. В вкладке A сделать reload (или дождаться reload-фолбэка) → авто-рефреш остаётся включённым (per-tab флаг пережил reload).

- [ ] **Step 7: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): авто-пилот per-tab — on в sessionStorage, попап не глобалит"
```

---

### Task 3: `content.js` + `styles.css` — тумблер «Подсказки» per-tab

**Files:**
- Modify: `extension/content.js` (объявление состояния ~14, `showFab` ~444, `buildPanel` ~452-455, `render` ~479-487, boot)
- Modify: `extension/styles.css` (`.hd-actions`)

**Interfaces:**
- Consumes: `LLTAB.getHintsOff(sessionStorage)`, `LLTAB.setHintsOff(sessionStorage, off)` (Task 1).
- Produces: ничего для следующих задач.

- [ ] **Step 1: Объявить состояние `hintsOff`**

После строки ~14 (`let panelCollapsed = false;`) добавить:

```js
  let hintsOff = false; // per-tab: скрыть наши подсказки (бейджи + панель) на этой вкладке
```

- [ ] **Step 2: Boot — читать `hintsOff` из per-tab**

В `boot()`, рядом с чтением авто-пилота (после блока `try { … ll_autorefresh … }`), добавить:

```js
    try { if (typeof LLTAB !== "undefined") hintsOff = LLTAB.getHintsOff(sessionStorage); } catch (_) { /* нет sessionStorage */ }
```

- [ ] **Step 3: Кнопка-тумблер в шапке панели**

Заменить строки ~452-455 в `buildPanel`:

```js
      p.innerHTML = '<div class="hd"><span class="logo">Load<b>Lens</b></span>' +
        '<button data-act="collapse" title="Свернуть">–</button></div><div class="bd"></div>';
      document.body.appendChild(p);
      p.querySelector('[data-act="collapse"]').onclick = () => { panelCollapsed = true; render(); };
```

на:

```js
      p.innerHTML = '<div class="hd"><span class="logo">Load<b>Lens</b></span>' +
        '<span class="hd-actions">' +
        '<button data-act="hints" title="Скрыть подсказки LoadLens на этой вкладке">🙈</button>' +
        '<button data-act="collapse" title="Свернуть">–</button></span></div><div class="bd"></div>';
      document.body.appendChild(p);
      p.querySelector('[data-act="collapse"]').onclick = () => { panelCollapsed = true; render(); };
      p.querySelector('[data-act="hints"]').onclick = () => {
        hintsOff = true;
        if (typeof LLTAB !== "undefined") LLTAB.setHintsOff(sessionStorage, true);
        render();
      };
```

- [ ] **Step 4: `render` — при `hintsOff` не рисовать бейджи и свернуть в FAB**

Заменить строки ~479-487:

```js
    clearBadges();
    // построчные бейджи: матчим видимые DOM-строки с грузами (DAT — по resultId, TS — parseRow)
    (adapter.anchor ? adapter.anchor(loads) : []).forEach((p) => badgeRow(p.anchor || p.row, p.load));

    if (panelCollapsed) {
      const p = document.getElementById("ll-panel"); if (p) p.remove();
      showFab();
      return;
    }
```

на:

```js
    clearBadges();
    // построчные бейджи: матчим видимые DOM-строки с грузами (DAT — по resultId, TS — parseRow).
    // При hintsOff бейджи не рисуем (подсказки скрыты на этой вкладке).
    if (!hintsOff) {
      (adapter.anchor ? adapter.anchor(loads) : []).forEach((p) => badgeRow(p.anchor || p.row, p.load));
    }

    if (panelCollapsed || hintsOff) {
      const p = document.getElementById("ll-panel"); if (p) p.remove();
      showFab();
      return;
    }
```

- [ ] **Step 5: FAB восстанавливает и панель, и подсказки**

Заменить строку ~444:

```js
      f.onclick = () => { panelCollapsed = false; f.remove(); render(); };
```

на:

```js
      f.onclick = () => {
        panelCollapsed = false;
        hintsOff = false;
        if (typeof LLTAB !== "undefined") LLTAB.setHintsOff(sessionStorage, false);
        f.remove();
        render();
      };
```

- [ ] **Step 6: Стиль контейнера кнопок шапки**

В `extension/styles.css`, после строки с `#ll-panel .hd button { … }` (~107), добавить:

```css
#ll-panel .hd .hd-actions { display: flex; gap: 6px; align-items: center; }
```

- [ ] **Step 7: Регресс-тесты зелёные**

Run: `npm test`
Expected: PASS (чистые модули не затронуты)

- [ ] **Step 8: Ручная проверка в живой сессии DAT**

1. Перезагрузить расширение, открыть выдачу DAT.
2. Нажать «🙈» в шапке панели → построчные бейджи исчезают, панель сворачивается в FAB «🚚 LoadLens».
3. Авто-рефреш (если включён) **продолжает** работать при скрытых подсказках.
4. Reload вкладки → подсказки остаются скрытыми (per-tab флаг пережил reload).
5. Клик по FAB → бейджи и панель возвращаются.
6. Во второй вкладке DAT подсказки **видны** (флаг per-tab).

- [ ] **Step 9: Commit**

```bash
git add extension/content.js extension/styles.css
git commit -m "feat(extension): per-tab тумблер «Подсказки» — прячет бейджи+панель, переживает reload"
```

---

### Task 4: `popup` — аккаунт первым, настройки в `<details>`, убрать чекбокс авто-рефреша

**Files:**
- Modify: `extension/popup.html` (порядок блоков ~32-35, обёртка `#settings` в `<details>`, стиль `summary`)
- Modify: `extension/popup.js` (`renderSettings` ~42-44, `save` ~81-84)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `chrome.storage.local.ll_autorefresh = { intervalMs }` (без поля `on`) — согласовано с Task 2 boot/onChanged, которые читают только `intervalMs`.

- [ ] **Step 1: `popup.html` — аккаунт первым, настройки в сворачиваемом блоке**

Заменить строки ~32-35:

```html
  <div class="bd" id="settings"></div>
  <div class="bd" id="account"><div class="empty">Аккаунт…</div></div>
  <div class="bd" id="fleet"></div>
  <div class="bd" id="telegram"></div>
```

на:

```html
  <div class="bd" id="account"><div class="empty">Аккаунт…</div></div>
  <details class="bd settings-wrap"><summary>⚙ Настройки</summary>
    <div id="settings"></div>
  </details>
  <div class="bd" id="fleet"></div>
  <div class="bd" id="telegram"></div>
```

- [ ] **Step 2: `popup.html` — стиль `summary`**

В `<style>` (после `.note { … }`, ~27) добавить:

```css
  .settings-wrap { padding-top: 6px; }
  .settings-wrap > summary { cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; color:#1e3a8a; font-weight:700; list-style: revert; padding: 4px 0; }
```

- [ ] **Step 3: `popup.js` — убрать строку-чекбокс «Авто-рефреш выдачи»**

В `renderSettings` заменить строки ~42-44:

```js
    '<h4>Авто-пилот таба DAT</h4>' +
    `<div class="row"><span class="k">Авто-рефреш выдачи</span><input id="s-ar-on" type="checkbox"${ar.on ? " checked" : ""}></div>` +
    `<div class="row"><span class="k">Интервал, сек (≥60)</span><input id="s-ar-int" type="number" min="60" step="10" value="${Math.round((ar.intervalMs || 60000) / 1000)}"></div>` +
```

на:

```js
    '<h4>Авто-пилот таба DAT</h4>' +
    `<div class="row"><span class="k">Интервал, сек (≥60)</span><input id="s-ar-int" type="number" min="60" step="10" value="${Math.round((ar.intervalMs || 60000) / 1000)}"></div>` +
```

- [ ] **Step 4: `popup.js` — `save` пишет `ll_autorefresh` без `on`**

Заменить строки ~81-84:

```js
  await chrome.storage.local.set({
    ll_autorefresh: { on: document.getElementById("s-ar-on").checked, intervalMs: intSec * 1000 },
    ll_sort: sortField ? { field: sortField, dir: document.getElementById("s-sort-d").value === "asc" ? "asc" : "desc" } : { field: null },
  });
```

на:

```js
  await chrome.storage.local.set({
    // on — per-tab (sessionStorage в content.js), попап хранит только интервал-параметр
    ll_autorefresh: { intervalMs: intSec * 1000 },
    ll_sort: sortField ? { field: sortField, dir: document.getElementById("s-sort-d").value === "asc" ? "asc" : "desc" } : { field: null },
  });
```

- [ ] **Step 5: Обновить пояснительный текст авто-пилота**

В `renderSettings` заменить строку ~54 (`<div class="note">Авто-пилот: …`):

```js
    '<div class="note">Авто-пилот: открой выдачу DAT в отдельном табе — он сам кликает Search раз в 60–120 с (джиттер) и держит выбранную сортировку, пока ты работаешь в другом табе. Кликает родную кнопку DAT в твоей сессии; по умолчанию выключен.</div>';
```

на:

```js
    '<div class="note">Авто-пилот включается отдельно на каждой вкладке выдачи DAT (тумблер «Авто-рефреш» в шапке панели). Здесь — общий интервал (60–120 с с джиттером) и удерживаемая сортировка.</div>';
```

- [ ] **Step 6: Регресс-тесты зелёные + проверка отсутствия ссылок на `s-ar-on`**

Run: `npm test`
Expected: PASS

Run: `grep -n "s-ar-on" extension/popup.js`
Expected: пусто

- [ ] **Step 7: Ручная проверка попапа**

1. Перезагрузить расширение, открыть попап.
2. **Аккаунт** — первый блок; ниже свёрнутый `⚙ Настройки`.
3. Раскрыть «Настройки» → есть Параметры водителя / целевые ставки / фильтр / Интервал / Сортировка; **чекбокса «Авто-рефреш выдачи» нет**.
4. Изменить интервал, Сохранить → в открытой вкладке DAT интервал применяется (onChanged), per-tab вкл/выкл не сбрасывается.

- [ ] **Step 8: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(popup): аккаунт первым, настройки в сворачиваемом блоке; убран глобальный чекбокс авто-рефреша"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (попап под аккаунт) → Task 4. ✓
- Spec §2 (авто-пилот per-tab) → Task 1 (LLTAB) + Task 2 (content) + Task 4 (попап убирает `on`). ✓
- Spec §3 (отключение подсказок per-tab) → Task 1 (LLTAB) + Task 3 (content/styles). ✓
- Spec «механика sessionStorage» → Task 1. ✓
- Spec «оставить кнопку –» → Task 3 сохраняет `panelCollapsed`/«–», добавляет отдельный «🙈». ✓
- Spec «авто-пилот крутится при скрытых подсказках» → Task 3 Step 4 (greens/таймер до early-return не затронуты). ✓

**Placeholder scan:** код приведён полностью в каждом шаге; плейсхолдеров нет. ✓

**Type consistency:** `LLTAB.getAutorefresh/setAutorefresh/getHintsOff/setHintsOff` — имена идентичны в Task 1 (определение), Task 2 и Task 3 (использование). `ll_autorefresh` после Task 4 = `{ intervalMs }`, читается в Task 2 как `v.intervalMs` / `ll_autorefresh.intervalMs`. ✓
