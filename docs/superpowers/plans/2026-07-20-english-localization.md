# English Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести весь user-facing текст LoadLens (UI расширения + `message` в 4xx backend + ответы Telegram-бота) на английский, закрепив результат автоматической проверкой в `npm test`.

**Architecture:** Прямая замена строковых литералов, без i18n-слоя (решение спеки: RU-локаль поддерживать не для кого). Комментарии в коде, `docs/`, `CLAUDE.md` и названия тест-кейсов остаются русскими. Полноту гарантирует не вычитка, а скрипт `scripts/check-lang.js`: он срезает комментарии и падает, если в файлах в объёме осталась кириллица. Скрипт пишется первым, включается в `npm test` последним — до этого каждая задача проверяет свой файл точечно.

**Tech Stack:** ванильный JS (расширение MV3, без сборки), NestJS/TypeScript (backend), `node --test` (тесты).

## Global Constraints

- **Без i18n-слоя.** Никаких `chrome.i18n`, `_locales/`, словарей, ключей. Только литералы.
- **Комментарии не переводим.** Русские комментарии в коде остаются как есть — в объёме только то, что видит пользователь.
- **Названия тест-кейсов не переводим.** `test("keyFor: семантический ключ...")` остаётся русским.
- **Меняется только текст.** Никаких правок логики, структуры, имён переменных, CSS-классов, `id`, `data-`атрибутов. Диффы задач 2–9 обязаны состоять только из строковых литералов.
- **Эмодзи сохраняются.** В `🛡 надёжный` → `🛡 trusted` меняется текстовая часть, эмодзи и пробел — нет.
- **User-facing строка не живёт на одной строке с комментарием** — иначе эвристика срезания комментариев в `check:lang` скроет её от проверки.
- **Терминология — строго по глоссарию** спеки `docs/superpowers/specs/2026-07-20-english-localization-design.md`. Ключевое: прицеп → **equipment** (не *trailer*), парк → **fleet**, цепочка → **get-out chain**, плечо → **leg**, рынок → **market**.
- **Вне объёма:** `backend/public/index.html`, `backend/public/admin.html`, `package.json`, комментарии, `docs/`, листинг Chrome Web Store.

---

## File Structure

**Создаются:**
- `scripts/check-lang.js` — детектор непереведённых строк. Экспортирует `stripComments`, `findCyrillic`, `scan`; при запуске как main печатает отчёт и выходит с кодом 1 при находках.
- `scripts/check-lang.test.js` — юнит-тесты детектора.

**Модифицируются (только строковые литералы):**
- `extension/manifest.json` — `name`, `description`
- `extension/popup.html` — шапка, подзаголовок, `⚙ Настройки`
- `extension/api.js` — тексты ошибок
- `extension/inject.js` — debug-логи
- `extension/popup.js` — настройки, аккаунт, парк, Telegram-секция
- `extension/content.js` — чипы/бейджи/карточка детали (задача 7), панель/цепочки/логи (задача 8)
- `backend/src/**/*.ts` — `message` в исключениях + тексты бота
- `package.json` — блок `scripts` (задачи 1 и 10)

---

### Task 1: Детектор непереведённых строк

**Files:**
- Create: `scripts/check-lang.js`
- Test: `scripts/check-lang.test.js`
- Modify: `package.json` (блок `scripts`)

**Interfaces:**
- Consumes: ничего
- Produces:
  - `stripComments(src: string): string` — убирает `/* */` и `//` комментарии
  - `findCyrillic(src: string): Array<{line: number, text: string}>` — 1-индексированные номера строк
  - `scan(files: string[]): Array<{file: string, line: number, text: string}>`
  - `SCOPE: string[]` — список путей/глобов в объёме
  - CLI: `node scripts/check-lang.js [files...]`, exit 1 при находках

- [ ] **Step 1: Написать падающий тест**

Создать `scripts/check-lang.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { stripComments, findCyrillic } = require("./check-lang.js");

test("stripComments: убирает построчный комментарий", () => {
  assert.strictEqual(stripComments("const a = 1; // русский коммент").trim(), "const a = 1;");
});

test("stripComments: убирает блочный комментарий, в т.ч. многострочный", () => {
  assert.strictEqual(stripComments("/* русский\n   блок */const a = 1;"), "const a = 1;");
});

test("stripComments: не режет :// внутри URL", () => {
  const src = 'const u = "https://example.com/путь";';
  assert.ok(stripComments(src).includes("путь"));
});

test("findCyrillic: находит строку и отдаёт 1-индексированный номер", () => {
  const hits = findCyrillic('const a = 1;\nconst b = "привет";\n');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 2);
});

test("findCyrillic: чистый английский даёт пустой результат", () => {
  assert.deepStrictEqual(findCyrillic('const a = "hello";'), []);
});

test("findCyrillic: кириллица только в комментарии не считается находкой", () => {
  assert.deepStrictEqual(findCyrillic(stripComments('const a = 1; // коммент')), []);
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `node --test scripts/check-lang.test.js`
Expected: FAIL — `Cannot find module './check-lang.js'`

- [ ] **Step 3: Написать скрипт**

Создать `scripts/check-lang.js`:

```js
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
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `node --test scripts/check-lang.test.js`
Expected: PASS, 6 тестов

- [ ] **Step 5: Добавить npm-скрипты (пока НЕ в `npm test`)**

В `package.json`, блок `scripts` — добавить две строки, `test` пока не трогать:

```json
    "check:lang": "node scripts/check-lang.js",
    "test:scripts": "node --test scripts/*.test.js",
```

- [ ] **Step 6: Зафиксировать стартовое состояние**

Run: `npm run check:lang`
Expected: FAIL, exit 1, ~252 находки. Это ожидаемо — базовая линия перед переводом. Записать число из первой строки вывода, оно должно монотонно падать до нуля к задаче 9.

- [ ] **Step 7: Коммит**

```bash
git add scripts/check-lang.js scripts/check-lang.test.js package.json
git commit -m "chore(i18n): детектор непереведённых user-facing строк (check:lang)"
```

---

### Task 2: Витрина — manifest и шапка попапа

**Files:**
- Modify: `extension/manifest.json:3,5`
- Modify: `extension/popup.html:42-44`

**Interfaces:**
- Consumes: `npm run check:lang <file>` из Task 1
- Produces: ничего для последующих задач

Первым делом — это то, что видно в Chrome Web Store и `chrome://extensions` до установки.

- [ ] **Step 1: Перевести `manifest.json`**

```json
  "name": "LoadLens — load scoring for DAT One / Truckstop",
  "description": "Shows how profitable each load is ($/mile after deadhead, fuel and lane market rates).",
```

- [ ] **Step 2: Перевести `popup.html`**

| было | стало |
|---|---|
| `Скоринг грузов · DAT One / Truckstop` | `Load scoring · DAT One / Truckstop` |
| `Аккаунт…` | `Account…` |
| `⚙ Настройки` | `⚙ Settings` |

- [ ] **Step 3: Проверить**

Run: `npm run check:lang extension/manifest.json extension/popup.html`
Expected: `check:lang — чисто, кириллицы в user-facing коде нет`

- [ ] **Step 4: Коммит**

```bash
git add extension/manifest.json extension/popup.html
git commit -m "i18n(extension): manifest и шапка попапа на английском"
```

---

### Task 3: Тексты ошибок API-клиента

**Files:**
- Modify: `extension/api.js` (строки 170, 225, 235, 237, 242, 244, 249, 250, 261, 263, 268, 270, 275, 276, 290, 302, 313, 324)

**Interfaces:**
- Consumes: `npm run check:lang <file>`
- Produces: тексты ошибок, которые попап показывает как есть

Три уникальные строки, повторяющиеся 18 раз. Заменить все вхождения.

- [ ] **Step 1: Заменить строки**

| было | стало |
|---|---|
| `` `ошибка ${res.status}` `` | `` `error ${res.status}` `` |
| `"сетевая ошибка"` | `"network error"` |
| `"нужен вход в аккаунт"` | `"sign in required"` |

- [ ] **Step 2: Проверить перевод**

Run: `npm run check:lang extension/api.js`
Expected: чисто

- [ ] **Step 3: Прогнать тесты расширения**

Run: `npm run test:ext`
Expected: PASS. `extension/api.test.js` проверяет только `sanitizeLoad` и на текстах ошибок не завязан — падений быть не должно.

- [ ] **Step 4: Коммит**

```bash
git add extension/api.js
git commit -m "i18n(extension): тексты ошибок API-клиента на английском"
```

---

### Task 4: Debug-логи перехватчика

**Files:**
- Modify: `extension/inject.js:14,22,60`

**Interfaces:**
- Consumes: `npm run check:lang <file>`
- Produces: ничего

Видны в консоли при `LL_DEBUG` — клиент может открыть DevTools при разборе проблемы.

- [ ] **Step 1: Заменить строки**

| было | стало |
|---|---|
| `"FindLoads перехвачен → постим content.js:"` | `"FindLoads intercepted → posting to content.js:"` |
| `"graphql-ответ без freightSearchV4.findLoads (другая operation):"` | `"graphql response without freightSearchV4.findLoads (different operation):"` |
| `"перехватчик fetch/XHR установлен (MAIN-world). Включён LL_DEBUG."` | `"fetch/XHR interceptor installed (MAIN world). LL_DEBUG is on."` |

- [ ] **Step 2: Проверить**

Run: `npm run check:lang extension/inject.js`
Expected: чисто

- [ ] **Step 3: Коммит**

```bash
git add extension/inject.js
git commit -m "i18n(extension): debug-логи перехватчика на английском"
```

---

### Task 5: Попап — настройки

**Files:**
- Modify: `extension/popup.js:32-63,76,119-120`

**Interfaces:**
- Consumes: `npm run check:lang <file>`
- Produces: ничего

- [ ] **Step 1: Заменить строки секции настроек**

| было | стало |
|---|---|
| `Параметры водителя` | `Driver settings` |
| `Drive left, ч` | `Drive left, h` |
| `Duty left, ч` | `Duty left, h` |
| `Cycle left, ч` | `Cycle left, h` |
| `Целевые ставки по дистанции` | `Target rates by distance` |
| `Тип трейлера (фильтр)` | `Equipment filter` |
| `Все` | `All` |
| `Сброс` | `Clear` |
| `Авто-пилот таба DAT` | `DAT tab auto-pilot` |
| `Интервал, сек (≥60)` | `Interval, sec (≥60)` |
| `Авто-скролл (подтянуть все страницы)` | `Auto-scroll (pull all pages)` |
| `Сортировка` | `Sort` |
| `— не менять —` | `— keep current —` |
| `Направление` | `Direction` |
| `Отображение на странице` | `On-page display` |
| `Скрыть панель на странице` | `Hide panel on page` |
| `Скрыть бейджи в таблице` | `Hide badges in table` |
| `Сохранить` | `Save` |
| `Сохранено ✓` | `Saved ✓` |
| `Только: ` | `Only: ` |
| `Показываются все прицепы` | `All equipment types shown` |

- [ ] **Step 2: Заменить три подсказки (`div.note`)**

```
Целевая $/mi — порог «выгодно» (green): груз green, если его gross $/mile ≥ цели своего бакета. Cost/mile — нижняя граница убытка (red).
→
Target $/mi is the "profitable" (green) threshold: a load is green when its gross $/mile is at or above the target for its distance bucket. Cost/mile is the break-even line below which a load is a loss (red).
```

```
«Отображение на странице» применяется сразу ко всем вкладкам DAT/Truckstop (без кнопки «Сохранить»).
→
"On-page display" applies instantly to all DAT/Truckstop tabs — no need to press Save.
```

```
Авто-пилот включается отдельно на каждой вкладке выдачи DAT (тумблер «Авто-рефреш» в шапке панели). Здесь — общий интервал (60–120 с с джиттером), удерживаемая сортировка и авто-скролл (доскролл выдачи, чтобы DAT подгрузил все страницы; панель копит их по searchId).
→
Auto-pilot is switched on per DAT results tab (the "Auto-refresh" toggle in the panel header). Set here: the shared interval (60–120s with jitter), the sort order to hold, and auto-scroll (scrolls the results so DAT loads every page; the panel accumulates them by searchId).
```

- [ ] **Step 3: Проверить, что осталась только секция аккаунта**

Run: `npm run check:lang extension/popup.js`
Expected: FAIL — находки только со строк 142+ (аккаунт, парк, Telegram). Строк из диапазона 32–120 в выводе быть не должно.

- [ ] **Step 4: Коммит**

```bash
git add extension/popup.js
git commit -m "i18n(extension): секция настроек попапа на английском"
```

---

### Task 6: Попап — аккаунт, парк, Telegram

**Files:**
- Modify: `extension/popup.js:142-354`

**Interfaces:**
- Consumes: `npm run check:lang <file>`
- Produces: ничего

- [ ] **Step 1: Заменить строки аккаунта и сброса пароля**

| было | стало |
|---|---|
| `Сменить пароль` | `Change password` |
| `Выйти` | `Sign out` |
| `Удалить аккаунт` | `Delete account` |
| `Аккаунт удалён.` | `Account deleted.` |
| `Аккаунт` | `Account` |
| `пароль (мин. 8)` | `password (min. 8)` |
| `Войти` | `Sign in` |
| `Регистрация` | `Sign up` |
| `Забыл пароль?` | `Forgot password?` |
| `Сброс пароля` | `Password reset` |
| `Отправить код` | `Send code` |
| `Назад` | `Back` |
| `введите email` | `enter your email` |
| `Введите код` | `Enter code` |
| `код из Telegram` | `code from Telegram` |
| `новый пароль (мин. 8)` | `new password (min. 8)` |
| `Сбросить` | `Reset` |
| `введите код` | `enter the code` |
| `минимум 8 символов` | `minimum 8 characters` |
| `Пароль сброшен, войдите.` | `Password reset — please sign in.` |
| `текущий пароль` | `current password` |
| `Пароль изменён, войдите снова.` | `Password changed — please sign in again.` |

Длинные строки:

```
Удалить аккаунт безвозвратно? Профиль и все водители будут удалены. Активную подписку DAT/Truckstop это не отменяет.
→
Delete your account permanently? Your profile and all drivers will be removed. This does not cancel your DAT/Truckstop subscription.
```

```
Pro: полные 3-плечевые get-out цепочки + CSV-экспорт грузов.
→
Pro: full 3-leg get-out chains + CSV load export.
```

```
Если аккаунт привязан к Telegram, код придёт в бот.
→
If your account is linked to Telegram, the code will arrive in the bot.
```

- [ ] **Step 2: Заменить строки парка**

| было | стало |
|---|---|
| `Парк водителей` | `Fleet` |
| `Войдите в аккаунт, чтобы вести своих водителей.` | `Sign in to manage your drivers.` |
| `Парк водителей и матчинг «все водители сразу» доступны в Pro.` | `Fleet and match-all-drivers are Pro features.` |
| `Пока нет водителей. Добавьте первого.` | `No drivers yet — add your first one.` |
| `+ Добавить водителя` | `+ Add driver` |
| `Удалить` (title кнопки ✕) | `Delete` |
| `общий` (placeholder cost/mile) | `default` |
| `Имя водителя:` (prompt) | `Driver name:` |

- [ ] **Step 3: Заменить строки Telegram-секции**

| было | стало |
|---|---|
| `Telegram-уведомления` | `Telegram alerts` |
| `Алерты о выгодных грузах по вашему фильтру — в Pro.` | `Alerts for profitable loads matching your filter are a Pro feature.` |
| `Не удалось получить статус.` | `Could not load status.` |
| `Бот ещё не настроен на сервере.` | `The bot is not configured on the server.` |
| `Подключить Telegram` | `Connect Telegram` |
| `Бот не настроен на сервере.` | `The bot is not configured on the server.` |
| `Статус` | `Status` |
| `привязан ✓` | `linked ✓` |
| `Слать алерты` | `Send alerts` |
| `Отвязать Telegram` | `Disconnect Telegram` |

```
Подключите Telegram, чтобы получать выгодные грузы (green + ваш фильтр прицепа) личным сообщением.
→
Connect Telegram to receive profitable loads (green + your equipment filter) as a direct message.
```

```
1 груз = 1 сообщение, дубли отсекаются. Только пока открыта вкладка DAT.
→
One load = one message, duplicates filtered out. Works only while a DAT tab is open.
```

```
Отвязать Telegram? Алерты перестанут приходить.
→
Disconnect Telegram? Alerts will stop.
```

- [ ] **Step 4: Проверить**

Run: `npm run check:lang extension/popup.js`
Expected: чисто

- [ ] **Step 5: Коммит**

```bash
git add extension/popup.js
git commit -m "i18n(extension): аккаунт, парк и Telegram-секция попапа на английском"
```

---

### Task 7: Панель — чипы, бейджи, карточка детали

**Files:**
- Modify: `extension/content.js:54-400`

**Interfaces:**
- Consumes: `npm run check:lang <file>`
- Produces: ничего

Диапазон 54–400 — построчные чипы, меню отзыва о брокере и карточка детали груза. Строки панели и цепочек (460+) переводит Task 8; диапазоны не пересекаются, замены 1:1 не сдвигают нумерацию.

- [ ] **Step 1: Заменить чипы и бейджи (строки 54–246)**

| было | стало |
|---|---|
| `"источник=GraphQL-перехват,"` | `"source=GraphQL intercept,"` |
| `"источник=DOM-адаптер,"` | `"source=DOM adapter,"` |
| `"грузов"` (в логах) | `"loads"` |
| `"агрегат после sanitizeLoad"` | `"aggregate after sanitizeLoad"` |
| `🚩 риск` | `🚩 risk` |
| `🚩 проверь` | `🚩 check` |
| `👤 нет (0/${m.total})` | `👤 none (0/${m.total})` |
| ` · прицеп≠` | ` · equip≠` |
| `ⓘ детали` | `ⓘ details` |
| `🛡 надёжный` | `🛡 trusted` |
| `брокер ок` | `broker ok` |
| `⚠ риск` | `⚠ risk` |
| `👥 +отзыв` | `👥 +review` |
| `${rep.flaked}× флейк` | `${rep.flaked}× flaked` |
| `👥 ${rep.paid + rep.noIssue}/${rep.n} ок` | `👥 ${rep.paid + rep.noIssue}/${rep.n} ok` |
| `👥 ${rep.n} отзыв.` | `👥 ${rep.n} reviews` |
| `👥 смешанно (${rep.n})` | `👥 mixed (${rep.n})` |
| `Crowdsourced репутация брокера. Нажми, чтобы оставить отзыв.` | `Crowdsourced broker reputation. Click to leave a review.` |

- [ ] **Step 2: Заменить меню отзыва (строки 253–273)**

| было | стало |
|---|---|
| `✅ Заплатил` | `✅ Paid` |
| `👍 Без проблем` | `👍 No issues` |
| `🐢 Платит медленно` | `🐢 Slow pay` |
| `🚫 Слил/отменил` | `🚫 Flaked / canceled` |
| `Отзыв о брокере ` | `Broker review ` |
| `Отправка…` | `Sending…` |

- [ ] **Step 3: Заменить карточку детали (строки 319–392)**

| было | стало |
|---|---|
| `Ставка` | `Rate` |
| `` рынок $${laneMedian.toFixed(2)} `` | `` market $${laneMedian.toFixed(2)} `` |
| `Мили` | `Miles` |
| `груж` | `loaded` |
| `Вес` | `Weight` |
| `Когда` | `Available` |
| `Оценка` | `Score` |
| `риск` / `проверь` (внутри строки Оценки) | `risk` / `check` |
| `Брокер` | `Broker` |
| `Телефон` | `Phone` |
| `Заметки` | `Notes` |
| `Кому подходит (${m.feasibleCount}/${m.total})` | `Fits drivers (${m.feasibleCount}/${m.total})` |
| `Открыть ↗` | `Open ↗` |
| `Копировать` | `Copy` |
| `Скопировано ✓` | `Copied ✓` |
| `Отзыв о брокере` (кнопка) | `Broker review` |
| `— нет ставки` | `— no rate` |
| `▲ выгодно` | `▲ profitable` |
| `≈ в плюс` | `≈ marginal` |
| `▼ убыток` | `▼ loss` |

- [ ] **Step 4: Проверить, что переведён именно этот диапазон**

Run: `npm run check:lang extension/content.js`
Expected: FAIL — в выводе не должно быть ни одной строки с номером < 460. Остаток (панель, цепочки, логи) — задача 8.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test`
Expected: PASS (17 shared + 10 extension). Ни один тест не ассертит UI-строки `content.js`.

- [ ] **Step 6: Коммит**

```bash
git add extension/content.js
git commit -m "i18n(extension): чипы, меню отзыва и карточка детали на английском"
```

---

### Task 8: Панель — сводка, Get-out цепочки, логи

**Files:**
- Modify: `extension/content.js:463-920`

**Interfaces:**
- Consumes: `npm run check:lang <file>`
- Produces: ничего

- [ ] **Step 1: Заменить шапку и сводку панели (строки 463–540)**

| было | стало |
|---|---|
| `Скрыть подсказки LoadLens на этой вкладке` | `Hide LoadLens hints on this tab` |
| `Свернуть` | `Collapse` |
| `Водитель` | `Driver` |
| `Грузов в выдаче` | `Loads in results` |
| `Фильтр прицепа` | `Equipment filter` |
| `Рынок старта` | `Origin market` |
| `Дизель` | `Diesel` |
| `/гал` | `/gal` |
| `Старт: ` | `Origin: ` |
| `Авто-пилот: фоновый таб сам кликает Search DAT и удерживает сортировку` | `Auto-pilot: the background tab clicks DAT's Search itself and holds the sort order` |
| `Авто-рефреш` | `Auto-refresh` |
| `Сорт: ` | `Sort: ` |
| `Направление сортировки` | `Sort direction` |
| `Get-out цепочки` | `Get-out chains` |
| `Выгодные сейчас` | `Hot loads` |
| `Экспорт видимых грузов в CSV` | `Export visible loads to CSV` |

```
Цепочки появятся, когда видно достаточно грузов из рынка старта.
→
Chains appear once enough loads from the origin market are visible.
```

```
Скоринг учитывает deadhead, топливо и медиану рынка по lane. Ставка с борда — запрос брокера. HOS-бейдж — выполнимость по часам водителя.
→
Scoring accounts for deadhead, fuel and the lane market median. The board rate is the broker's asking price. The HOS badge shows whether the driver can legally run it.
```

- [ ] **Step 2: Заменить экспорт и цепочки (строки 582–738)**

| было | стало |
|---|---|
| `груз вне видимой выдачи` | `load not in visible results` |
| `Нет грузов для экспорта.` | `No loads to export.` |
| `~${h.days}д · $${h.perDay}/д` | `~${h.days}d · $${h.perDay}/day` |
| `плечо ${i + 1}` | `leg ${i + 1}` |
| `● СЕЙЧАС В ВЫДАЧЕ ↗` | `● LIVE IN RESULTS ↗` |
| `◔ ПРОГНОЗ ПО РЫНКУ` | `◔ MARKET FORECAST` |
| `$${median.toFixed(2)}/mi медиана lane` | `$${median.toFixed(2)}/mi lane median` |
| ` · ~${density} груз. из рынка` | ` · ~${density} loads from market` |
| ` · финиш ` | ` · finish ` |
| `🛡 надёжный` / `ок` / `⚠ риск` (строка 685) | `🛡 trusted` / `ok` / `⚠ risk` |
| `торг` | `negotiable` |
| `факторинг` | `factoring` |
| `🛡 ок` | `🛡 ok` |
| `⚠ риск` (строка 704) | `⚠ risk` |
| `rep.n + " отзыв."` | `rep.n + " reviews"` |
| `смешанно` | `mixed` |
| `сегодня` | `today` |
| `прогноз` | `forecast` |
| `видели сегодня` | `seen today` |
| `видели вчера` | `seen yesterday` |
| `видели ${days} дн назад` | `seen ${days}d ago` |
| `свежо` | `fresh` |
| `стынет` | `cooling` |
| `могло уйти` | `may be gone` |
| `↪ +${Math.round(dh)}mi сосед` | `↪ +${Math.round(dh)}mi nearby` |

```
Экспорт CSV доступен в Pro. Войдите в аккаунт в попапе LoadLens (иконка расширения).
→
CSV export is a Pro feature. Sign in from the LoadLens popup (the extension icon).
```

- [ ] **Step 3: Заменить логи авто-пилота (строки 785–920)**

| было | стало |
|---|---|
| `"авто-рефреш ошибка"` | `"auto-refresh error"` |
| `"авто-рефреш: клик Search"` | `"auto-refresh: clicked Search"` |
| `"авто-рефреш: Search неактивна → reload страницы"` | `"auto-refresh: Search disabled → page reload"` |
| `"авто-скролл: контейнер не найден"` | `"auto-scroll: container not found"` |
| `"авто-скролл готово:"` | `"auto-scroll done:"` |
| `"сорт DAT:"` | `"DAT sort:"` |
| `"промах"` | `"miss"` |
| `"приём dat-findloads → parse:"` | `"received dat-findloads → parse:"` |
| `"грузов, searchId"` | `"loads, searchId"` |
| `"(пусто — схема DAT могла измениться)"` | `"(empty — the DAT schema may have changed)"` |
| `"приём dat-findloads, но DAT_GQL не загружен"` | `"received dat-findloads, but DAT_GQL is not loaded"` |

- [ ] **Step 4: Проверить**

Run: `npm run check:lang extension/content.js`
Expected: чисто

- [ ] **Step 5: Прогнать тесты**

Run: `npm test`
Expected: PASS (17 shared + 10 extension)

- [ ] **Step 6: Коммит**

```bash
git add extension/content.js
git commit -m "i18n(extension): панель, get-out цепочки и логи авто-пилота на английском"
```

---

### Task 9: Backend — тексты ошибок и бота

**Files:**
- Modify: `backend/src/main.ts:12`, `backend/src/loads/loads.controller.ts:27,44,57`, `backend/src/geo/geo.controller.ts:14`, `backend/src/common/premium-read.guard.ts:42`, `backend/src/drivers/pro.guard.ts:14`, `backend/src/drivers/drivers.service.ts:24,31`, `backend/src/auth/auth.service.ts:36,46,47,59,60,62,63,64,70,86,90,100`, `backend/src/auth/jwt-auth.guard.ts:16,19,20,23,24,25`, `backend/src/auth/admin.service.ts:55,64,65`, `backend/src/users/users.service.ts:13,15,17`, `backend/src/telegram/telegram.service.ts:145,146`

**Interfaces:**
- Consumes: `npm run check:lang backend/src`
- Produces: тексты `message` в 4xx, которые попап расширения показывает пользователю как есть

- [ ] **Step 1: Заменить сообщения исключений**

| было | стало |
|---|---|
| `JWT_SECRET обязателен в проде` | `JWT_SECRET is required in production` |
| `origin обязателен` | `origin is required` |
| `market обязателен` | `market is required` |
| `from и to обязательны` | `from and to are required` |
| `Premium-доступ к чтению требует Pro-аккаунт или API-ключ` | `Premium read access requires a Pro account or an API key` |
| `Парк водителей доступен в Pro` | `Fleet is a Pro feature` |
| `водитель не найден` | `driver not found` |
| `email уже зарегистрирован` | `email is already registered` |
| `неверный email или пароль` | `invalid email or password` |
| `аккаунт заблокирован` | `account is blocked` |
| `невалидный refresh-токен` | `invalid refresh token` |
| `ожидался refresh-токен` | `expected a refresh token` |
| `пользователь не найден` | `user not found` |
| `сессия недействительна` | `session is no longer valid` |
| `недействительный или истёкший код` | `invalid or expired code` |
| `нет Bearer-токена` | `missing Bearer token` |
| `невалидный токен` | `invalid token` |
| `ожидался access-токен` | `expected an access token` |
| `нельзя заблокировать администратора` | `cannot block an administrator` |
| `неверный текущий пароль` | `current password is incorrect` |
| `новый пароль совпадает со старым` | `new password matches the old one` |

- [ ] **Step 2: Заменить текст кода сброса пароля (`auth.service.ts:86`)**

```
`Код сброса пароля LoadLens: ${code}\nДействует 30 минут. Если вы не запрашивали сброс — игнорируйте.`
→
`LoadLens password reset code: ${code}\nValid for 30 minutes. If you didn't request it, ignore this message.`
```

- [ ] **Step 3: Заменить лог-предупреждение (`auth.service.ts:90`)**

```
`не удалось отправить код сброса в Telegram: ${(e as Error)?.message ?? e}`
→
`failed to send reset code via Telegram: ${(e as Error)?.message ?? e}`
```

- [ ] **Step 4: Заменить ответы бота (`telegram.service.ts:145-146`)**

```
'✅ LoadLens привязан. Буду слать выгодные грузы по вашему фильтру.'
→
'✅ LoadLens is linked. I'll send you profitable loads matching your filter.'
```

```
'⚠️ Ссылка устарела. Откройте «Подключить Telegram» в расширении заново.'
→
'⚠️ This link has expired. Open "Connect Telegram" in the extension again.'
```

Строка с апострофом в `I'll` внутри одинарных кавычек — использовать двойные кавычки для литерала, чтобы не экранировать.

- [ ] **Step 5: Проверить**

Run: `npm run check:lang backend/src`
Expected: чисто

- [ ] **Step 6: Собрать и прогнать backend-тесты**

```bash
cd backend && npm run build && npm test
```
Expected: сборка без ошибок, тесты PASS. Спеки проверяют поведение, а не тексты сообщений.

- [ ] **Step 7: Коммит**

```bash
git add backend/src
git commit -m "i18n(backend): сообщения ошибок и тексты Telegram-бота на английском"
```

---

### Task 10: Замкнуть проверку и верифицировать

**Files:**
- Modify: `package.json` (блок `scripts`)
- Create: `tasks/0009-english-localization.md`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: `npm test`, падающий при появлении русского user-facing текста

- [ ] **Step 1: Убедиться, что объём закрыт полностью**

Run: `npm run check:lang`
Expected: `check:lang — чисто, кириллицы в user-facing коде нет`, exit 0

Если есть находки — доперевести их в файле-источнике и повторить, прежде чем идти дальше.

- [ ] **Step 2: Включить проверку в `npm test`**

В `package.json` заменить строку `test`:

```json
    "test": "npm run sync:shared && npm run check:lang && npm run test:scripts && npm run test:shared && npm run test:ext"
```

- [ ] **Step 3: Прогнать полный набор**

Run: `npm test`
Expected: PASS — `check:lang` чисто, 6 тестов скрипта, 17 shared, 10 extension.

- [ ] **Step 4: Проверить, что защита от регрессии работает**

```bash
printf '\nconst _llTmp = "русский текст";\n' >> extension/api.js
npm test
```
Expected: FAIL с указанием `extension/api.js:<line>`. Затем откатить:

```bash
git checkout extension/api.js
npm test
```
Expected: PASS

- [ ] **Step 5: Ручная проверка UI**

Загрузить распакованное расширение (`chrome://extensions` → Загрузить распакованное → `extension/`), открыть выдачу DAT One и пройти:

1. Попап: все секции — настройки, целевые ставки, equipment-чипы, авто-пилот, отображение, аккаунт, парк, Telegram.
2. Панель на странице: шапка, свитчер водителя, сводка, Get-out цепочки, Hot loads, футер.
3. Построчные бейджи: чип выгодности, HOS, broker-trust, crowd-репутация, `ⓘ details`.
4. Карточка детали груза + меню отзыва о брокере.

Искать: остатки русского и **обрезанный текст** — английские строки в среднем на 10–15% длиннее, узкие места это чипы в полосе под строкой груза и лейблы `.row` в попапе. При переполнении сокращать формулировку, а не править CSS.

- [ ] **Step 6: Завести файл задачи**

Создать `tasks/0009-english-localization.md`:

```markdown
# Task: перевод user-facing текста на английский
Date: 2026-07-20
Status: done

## Checklist
- [x] детектор check:lang + юнит-тесты
- [x] manifest + popup.html
- [x] api.js, inject.js
- [x] popup.js (настройки, аккаунт, парк, Telegram)
- [x] content.js (чипы, карточка детали, панель, цепочки, логи)
- [x] backend: сообщения ошибок + тексты бота
- [x] check:lang включён в npm test
### Verification
- [x] npm test
- [x] backend build + test
- [x] ручная проверка UI на живой выдаче DAT
- [x] commit & push
```

- [ ] **Step 7: Коммит и пуш**

```bash
git add package.json tasks/0009-english-localization.md
git commit -m "chore(i18n): check:lang в npm test + файл задачи"
git push origin main
```

Пуш в `main` запускает автодеплой backend в Coolify — английские тексты ошибок и бота уедут в прод.

- [ ] **Step 8: Напомнить владельцу про листинг Chrome Web Store**

Описание и скриншоты в Chrome Web Store живут вне репозитория. `manifest.json` переведён, но карточка в Store обновляется вручную в Developer Dashboard — иначе клиент увидит русское описание при установке.

---

## Что вне этого плана

- **Webhook-канал алертов** — второй запрос того же клиента, дизайн готов: `docs/superpowers/specs/2026-07-20-alert-webhook-channel-design.md`.
- **Дашборд `backend/public/index.html` и `admin.html`** — 33 строки; дашборду нужен не перевод, а переписанный под маркетинг лендинг.
