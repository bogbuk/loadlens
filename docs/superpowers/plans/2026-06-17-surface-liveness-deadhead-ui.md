# Показ liveness / originDeadheadMi в панели — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать диспетчеру серверную свежесть плеча (`liveness`) цветной меткой на forecast-плечах и пометить плечи, взятые из соседнего рынка (`originDeadheadMi > 0`), тегом `↪ +Nmi сосед`.

**Architecture:** Чистые inline-хелперы в `extension/content.js` (рядом с `freshnessText`/`strengthBar`) + точечные врезки в `legRow` + один CSS-класс в `extension/styles.css`. Бэкенд и форма ответа `/loads/near` не меняются — поля `liveness`/`originDeadheadMi` уже приходят и лежат на объекте пула (`ctx.poolById.get(leg.loadId)`).

**Tech Stack:** zero-dep браузерный JS (`extension/content.js`), CSS. У `content.js` нет юнит-харнесса — проверка `node --check` + ручной smoke (как для существующих `freshnessText`/`strengthBar`).

---

## File Structure

- `extension/content.js` — два новых inline-хелпера (`livenessLabel`, `neighborTag`) + правки `legRow` (forecast-ветка: метка свежести; обе ветки: тег соседа в `.leg-route`).
- `extension/styles.css` — один класс `.leg-nb`.

Обе функции — чистые, по одной ответственности, ставятся рядом с однотипными хелперами (`freshnessText` @ content.js:646, `strengthBar` @ :656). Текущий `legRow` — content.js:570-599.

---

## Task 1: liveness — цветная метка свежести на forecast-плечах

**Files:**
- Modify: `extension/content.js` (новый хелпер у :654; forecast-ветка `legRow` :590, :596)

- [ ] **Step 1: Добавить чистый хелпер `livenessLabel`**

В `extension/content.js`, сразу ПОСЛЕ функции `freshnessText` (заканчивается на `}` строки 654) и перед `strengthBar`, вставить:
```js
  // Серверная свежесть (0..1) → цветная точка + слово. Бакеты как в спеке.
  function livenessLabel(liveness) {
    if (liveness > 0.66) return { dot: "🟢", word: "свежо" };
    if (liveness >= 0.33) return { dot: "🟡", word: "стынет" };
    return { dot: "🔴", word: "могло уйти" };
  }
```

- [ ] **Step 2: Использовать метку в forecast-ветке `legRow`**

В `legRow`, forecast-ветка. Заменить строку (content.js:590):
```js
    const fresh = freshnessText(full.lastSeen);
```
на:
```js
    // серверная свежесть, если груз аннотирован /loads/near; иначе fallback на относительное время
    const fresh = (full.liveness != null)
      ? `${livenessLabel(full.liveness).dot} ${livenessLabel(full.liveness).word} · ${freshnessText(full.lastSeen)}`
      : freshnessText(full.lastSeen);
```
Строку рендера `.leg-idx` (content.js:596, `<span class="leg-idx">${esc(fresh)}</span>`) НЕ менять — `fresh` по-прежнему уходит через `esc`, эмодзи сохраняются.

- [ ] **Step 3: Проверка синтаксиса**

Run: `node --check extension/content.js`
Expected: без вывода (OK).

- [ ] **Step 4: Коммит**

```bash
git add extension/content.js
git commit -m "feat(content): метка серверной свежести (liveness) на forecast-плечах"
```

---

## Task 2: originDeadheadMi — тег соседнего рынка + CSS

**Files:**
- Modify: `extension/content.js` (новый хелпер `neighborTag`; обе ветки `legRow` — строки `.leg-route` :582 и :597)
- Modify: `extension/styles.css` (новый класс `.leg-nb` после :143)

- [ ] **Step 1: Добавить чистый хелпер `neighborTag`**

В `extension/content.js`, сразу ПОСЛЕ хелпера `livenessLabel` (из Task 1), вставить:
```js
  // Плечо взято из соседнего рынка (радиус) — тег с крюком. Пусто при точном рынке (0/нет поля).
  function neighborTag(full) {
    const dh = full && full.originDeadheadMi;
    return dh > 0 ? ` <span class="leg-nb">↪ +${Math.round(dh)}mi сосед</span>` : "";
  }
```

- [ ] **Step 2: Врезать тег в `.leg-route` обеих веток**

В `legRow`, live-ветка — заменить (content.js:582):
```js
        `<div class="leg-route">${route}</div>` +
```
на:
```js
        `<div class="leg-route">${route}${neighborTag(full)}</div>` +
```
И в forecast-ветке — заменить (content.js:597):
```js
      `<div class="leg-route">${route}</div>` +
```
на:
```js
      `<div class="leg-route">${route}${neighborTag(full)}</div>` +
```
(`full` уже определён в начале `legRow` как `ctx.poolById.get(leg.loadId) || {}` — в обеих ветках в области видимости.)

- [ ] **Step 3: Добавить CSS-класс**

В `extension/styles.css`, после строки `#ll-panel .leg .lchip.book { ... }` (:143), добавить:
```css
#ll-panel .leg .leg-nb { margin-left: 6px; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: #eef1f4; color: #64748b; white-space: nowrap; }
```

- [ ] **Step 4: Проверка синтаксиса**

Run: `node --check extension/content.js`
Expected: без вывода (OK).

- [ ] **Step 5: Коммит**

```bash
git add extension/content.js extension/styles.css
git commit -m "feat(content): тег соседнего рынка (originDeadheadMi) на плечах цепочки"
```

---

## Финальная проверка

- [ ] **Регрессия тестов** (не должны затрагиваться, но подтверждаем целостность vendor-модулей)

Run: `npm test`
Expected: shared + extension зелёные (как до правок — content.js не покрыт юнитами, но `sync:shared`/тесты не должны сломаться).

- [ ] **Ручной smoke в панели**

`chrome://extensions` → перезагрузить распакованное `extension/` → открыть DAT One с грузами →
раскрыть Get-out цепочку. Ожидаемо: forecast-плечо показывает `🟢/🟡/🔴 <слово> · <время>`;
плечо, взятое из соседнего рынка, имеет тег `↪ +Nmi сосед` рядом с маршрутом; плечо из точного
рынка — без тега. Свернуть панель / спрятать вкладку — поведение делта-poll не изменилось.

---

## Self-Review (выполнено при написании плана)

- **Покрытие спеки:** liveness-метка + бакеты + fallback → Task 1; тег соседа только при >0 на обоих
  типах плеч → Task 2; CSS-класс → Task 2; scope (только forecast для liveness) → Task 1 (правка только
  в forecast-ветке). ✔
- **Плейсхолдеров нет** — весь код приведён дословно. ✔
- **Согласованность имён:** `livenessLabel(liveness) → {dot, word}` и `neighborTag(full) → string`
  используются ровно так, как определены; поля `full.liveness` / `full.originDeadheadMi` совпадают с
  именами из бэкенд-ответа `/loads/near` (`CrowdLoadNear`). ✔
- **Граничные случаи** (нет `liveness` → fallback; `originDeadheadMi` 0/нет → пустой тег; `full` пуст
  → тег пуст) покрыты в коде хелперов. ✔
