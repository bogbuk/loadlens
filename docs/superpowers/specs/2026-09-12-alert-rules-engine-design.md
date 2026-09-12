# Дизайн: движок правил Telegram-алертов

Date: 2026-09-12
Status: approved

## Мотивация

Запрос owner-operator'а (один трак, без диспетчера): оставить дома компьютер/Raspberry Pi с
залогиненным DAT One и LoadLens, а в дороге получать в Telegram только те грузы, которые подходят под
его критерии: ставка, deadhead, назначение, прицеп, брокер и **слова в комментариях брокера**
(bonded, in-bond, TWIC, airport, expedited…).

Сейчас алерты уходят только на «green + фильтр прицепа» (`content.render` → `LLALERT.push`). Для его
кейса это не подходит: bonded-груз нужен независимо от скоринга, а поток обычных green-грузов — нет.

Watchdog (бот пишет, если расширение перестало видеть данные DAT) — отдельная спека, следующая.

## Решения (из брейнсторма)

- **Правила — единственный триггер, когда заданы.** Нет включённых правил → прежнее поведение
  (green + `ll_equip_filter`). Есть хотя бы одно → в Telegram уходят только совпадения. Скоринг
  становится одним из условий правила (`score`).
- **Правила живут в расширении** (`chrome.storage.local.ll_alert_rules`), редактор в попапе. Оценка
  локальная, релей получает только совпавшие грузы. Команды бота для правки с телефона — не сейчас;
  если после первой недели попросят — отдельная спека (правила тогда синкаются на бэкенд).
- **Origin в правиле не нужен**: его задаёт сам поиск DAT. Destination — по штатам.
- **Чистый модуль** `extension/alert-rules.js` (`LLRULES`) по образцу `LLEQUIP`: без DOM, без сети,
  тестируется на фикстуре. При переезде оценки на сервер переносится в `shared/` без правок.

## Модель данных

`chrome.storage.local.ll_alert_rules`:

```js
{
  version: 1,
  rules: [{
    id: "r_1726123456789",   // "r_" + Date.now(), для UI
    name: "Bonded / TWIC",   // ≤60 символов
    enabled: true,
    keywordsAny: ["bonded", "in-bond", "twic", "airport"], // пусто → условие выключено
    keywordsNone: ["team", "hazmat"],
    minRate: null,           // $ всего
    minRpm: null,            // $/mi, trueRpm = rate / (loadedMiles + deadhead)
    maxDeadhead: 150,        // мили
    minMiles: null, maxMiles: null,   // loadedMiles
    equipment: null,         // string[]|null; null → как глобальный ll_equip_filter
    destStates: ["TX", "OK"],// null|[] → любой; матч по хвосту destMarket "_TX"
    brokersAllow: [],        // MC, только цифры (normalizeMc); пусто → любой
    brokersBlock: [],
    minCredit: null,         // creditScore
    score: "any"             // "any" | "green" | "green_amber"
  }]
}
```

Семантика:
- Внутри правила — **AND** по всем заданным условиям. `null` / пустой список = условие выключено.
- Между правилами — **OR**. Груз, попавший под несколько правил, уходит один раз (дедуп по
  семантическому ключу груза не меняется); в сообщении — имя первого совпавшего правила.
- Правило без единого условия матчит всё, что прошло equipment-фильтр. Допустимо; в редакторе
  подсказка «rule without conditions = every load».
- Ключевые слова сравниваются после нормализации обеих сторон: lower-case, убраны дефисы, пробелы
  и точки. Так `in-bond` ловит `inbond`, `IN BOND`, `In-Bond`. Подстрока, не слово целиком.
- Лимиты `normalize`: ≤20 правил, ≤30 слов в каждом списке, слово ≤40 символов, MC ≤24 цифр.

## Компоненты

### `extension/alert-rules.js` — `LLRULES` (новый, чистый)

- `normalize(raw) → {version:1, rules:[]}` — приводит storage к канону: не объект/не массив/старый
  формат → пустой список; отбрасывает правила без `id`; нормализует слова, MC, штаты (upper-case,
  2 буквы), числа (`Number`, `<0` → null), `score` вне множества → `"any"`; применяет лимиты.
- `active(cfg) → Rule[]` — только `enabled`.
- `normKeyword(s)` — экспортируется для тестов.
- `matches(rule, load, ctx) → boolean` — `ctx = { equipFilter, badgeFor }`.
  - equipment: `rule.equipment` если задан, иначе `ctx.equipFilter`; сравнение через `LLEQUIP.matches`.
  - keywordsAny: нет `comments` → false. keywordsNone при пустых comments → проходит.
  - deadhead: `deadheadMiles == null` → считаем 0 (груз проходит `maxDeadhead`). Иначе половина
    выдачи без DH-миль молча выпадет.
  - minRpm: та же формула, что в скоринге: `rate / (loadedMiles + (deadheadMiles || 0))`.
  - destStates: `destMarket.split("_").pop()` ∈ списка.
  - brokersBlock проверяется раньше brokersAllow; MC груза нормализуется к цифрам.
  - score: `"any"` → не вызываем `badgeFor` вовсе (лениво); `"green"` → level === "green";
    `"green_amber"` → level ∈ {green, amber}.
- `select(rules, loads, ctx) → [{load, rule}]` — для каждого груза первое совпавшее правило.

### `extension/content.js`

Блок «greens → LLALERT.push» в `render` заменяется:

```js
const badgeFor = (l) => LLSCORE.profitBadge(l, { costPerMile, dieselPrice,
  laneMedian: laneCache.get(laneKeyOf(l)), targetRpm: targetFor(l) });
const active = LLRULES.active(alertRules);
const hits = active.length
  ? LLRULES.select(active, loads, { equipFilter, badgeFor })
  : loads.filter(passEquip).map((l) => ({ load: l, rule: null }))
         .filter((d) => badgeFor(d.load).level === "green");
if (typeof LLALERT !== "undefined") LLALERT.push(hits).catch(() => {});
```

`alertRules` читается в `boot` вместе с остальными ключами и обновляется через
`chrome.storage.onChanged` (как `ll_equip_filter`). Панель «Выгодные сейчас» и бейджи не меняются:
правила — про алерты, не про отображение. `manifest.json`: `alert-rules.js` подключается после
`equip-filter.js` и до `content.js`.

### `extension/alerts.js` — `LLALERT`

`push(hits)` принимает `[{load, rule}]` (обратная совместимость: элемент без `load` считается
грузом). `toPayload(load, rule)` добавляет `ruleName` (обрезка до 60, без переводов строк), если
`rule` задан. `keyFor` не меняется.

### `backend/src/telegram`

- `NotifyItemDto`: `@IsOptional() @IsString() @MaxLength(60) @Matches(/^[^\n\r]{1,60}$/) ruleName?`.
- `formatAlertMessage`: при `ruleName` первой строкой `🎯 <ruleName>`, дальше как сейчас.
- Дедуп, TTL, soft-cap, `alert_sends` — без изменений. Это единственное изменение релея.

### `extension/popup.*`

В секции «Telegram-уведомления» под тумблером `alerts_enabled` — блок **Alert rules**:
- Список карточек: имя, тумблер enabled, Edit, Delete. Кнопка **Add rule**.
- Редактор правила (inline-форма в той же секции): name; keywords any / none (через запятую);
  min rate; min $/mi; max deadhead; min/max miles; equipment — те же чипы, что глобальный фильтр,
  плюс переключатель «same as global filter»; destination states (`TX, OK`); brokers allow /
  block (MC через запятую); min credit; score (select: any / green / green+amber).
- Save → `LLRULES.normalize` всего массива → `chrome.storage.local.set({ ll_alert_rules })`.
- Видимость: Pro с привязанным Telegram. Иначе honest-тизер «Alert rules work with Telegram
  alerts (Pro)», без формы.
- Пустой список → подсказка «No rules: every profitable (green) load is sent».

## Поток данных

```
popup → chrome.storage.ll_alert_rules
      → content.js (boot / onChanged) → render():
          LLRULES.select(active, loads, {equipFilter, badgeFor}) → [{load, rule}]
      → LLALERT.push → LLAPI.notifyAlerts(items c ruleName)
      → POST /telegram/notify → дедуп/cap → Telegram DM «🎯 <rule> …»
```

## ToS / PII

Ничего нового: оценка правил локальная, на сервер уходят только совпавшие грузы тем же payload'ом,
что и сейчас (контакт/комментарий — уже осознанное решение от 2026-07-17). Своих запросов к DAT
не добавляется. `ruleName` — пользовательская строка, не PII.

## Тесты

- `extension/__tests__/alert-rules.test.js` (новый): нормализация ключевых слов (`in-bond` ≡
  `inbond` ≡ `IN BOND`); `normalize` на мусорном storage → пустой список; AND внутри правила и OR
  между; null-условия выключены; правило без условий матчит всё прошедшее equipment;
  `deadheadMiles: null` проходит `maxDeadhead`; `minRpm` учитывает deadhead; `destStates`;
  `brokersBlock` побеждает `brokersAllow`; `score` через инжектированный `badgeFor`, при `"any"`
  `badgeFor` не вызывается; `select` отдаёт первое совпавшее правило; лимиты обрезаются.
- `extension/__tests__/alerts.test.js`: `toPayload(load, rule)` пробрасывает `ruleName`; без rule —
  поля нет; `push` принимает `{load, rule}` и голый груз.
- `backend/src/telegram/telegram.service.spec.ts`: `formatAlertMessage` с `ruleName` ставит
  `🎯` первой строкой; без — сообщение как раньше.
- `npm test` в корне (sync:shared + shared + extension) и `npm test` в backend зелёные.

## Вне скоупа

- Watchdog / heartbeat (следующая спека).
- Команды Telegram-бота для правки правил.
- Серверное хранение/оценка правил.
- Правила для панели «Выгодные сейчас» (только алерты).
- Origin-условие (задаётся поиском DAT).
