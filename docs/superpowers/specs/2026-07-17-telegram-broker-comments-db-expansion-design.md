# Telegram: brokerName + comments · Крауд-БД: полный набор полей парсера

Дата: 2026-07-17. Статус: одобрено пользователем (брейншторм в сессии).

## Цель

1. В Telegram-алерты добавить **имя брокера** и **комментарий груза** (на скрине DAT комментарий
   часто содержит email брокера и ключевые детали типа «60.25ft long»).
2. Расширить сохраняемое в крауд-БД (`loads`) **до полного набора полей**, которые уже извлекает
   `DAT_GQL.mapResult` — **включая контакты брокера** (contactEmail/contactPhone/comments).

## Решение по PII (осознанный сдвиг конвенции)

Пользователь явно выбрал вариант «вообще всё, включая контакты»:

- **Хранение**: крауд-БД принимает contactEmail/contactPhone/preferredContactMethod/comments как есть.
  Прежняя конвенция «крауд-база без PII» отменяется для хранения.
- **Раздача**: читающие эндпоинты (`GET /loads`, `/loads/near`, partnerSearch, lanes) НЕ меняются —
  контакты/comments наружу другим пользователям не отдаются (это была бы редистрибуция Product Data —
  отдельное решение, если понадобится).
- `LLAPI.sanitizeLoad` перестаёт быть PII-фильтром: теперь это whitelist+нормализация (обрезка длин,
  флаттенинг availability, приведение id к строкам). PII_RE-фильтр brokerName убирается.

## Блок 1 — Telegram

- `extension/alerts.js` `toPayload`: + `brokerName` (slice 120, без \n), + `comments` (slice 300, \n → пробел).
  `keyFor` (дедуп) не меняется.
- `backend/src/telegram/dto/notify.dto.ts`: опциональные `brokerName` (≤120, без \n) и `comments` (≤300, без \n).
- `formatAlertMessage`: строка брокера `Broker <Name> · MC<mc> · credit <cs>` (имя опционально,
  строка показывается если есть name ИЛИ mc); ниже — `💬 <comments>` (если есть), затем контакты.

## Блок 2 — Крауд-БД (подход: явные typed-колонки, без JSONB)

`POST /loads` открыт без авторизации → строгая whitelist-валидация каждого поля в DTO — это и защита
от мусора. JSONB отвергнут.

Новые поля (extension → DTO → колонка snake_case):

| Группа | Поля |
|---|---|
| Гео | originCity, originState, destCity, destState |
| Груз | lengthFt, equipmentCode (сырой код DAT), fullPartial, tripMethod, destDeadheadMiles, rateBasis |
| Broker-trust | creditScore (INT), daysToPay (FLOAT), creditAsOf, brokerCity, brokerState |
| Флаги (BOOLEAN) | isFactorable, isAssurable, isNegotiable, hasTiaMembership, fromPrivateNetwork, isObfuscated, bookNow |
| Booking | bookingMethod, bookingUrl (≤500), bidCount (INT) |
| Даты (TEXT, ISO) | servicedWhen, postingExpiresWhen, presentationDate, pickupEarliest, pickupLatest (флаттен availability) |
| Идентификаторы (TEXT) | dotNumber, carrierMc, freightForwarderMc, combinedOfficeId, headquartersId, posterUserId |
| Рынок | estimatedRatePerMile (FLOAT) |
| PII (по решению) | comments (≤500), contactEmail, contactPhone, preferredContactMethod |

- Даты храним TEXT (ISO-строки сортируются лексикографически; MVP без TIMESTAMPTZ).
- Идентификаторы приводим к строке на клиенте (`String()`), в БД TEXT — устойчиво к number/string в схеме DAT.
- `redactionReasons`/`unmetPreferences` (массивы) НЕ сохраняем — нужен JSONB, ценности мало.

Правки: `extension/api.js` (SAFE_FIELDS + нормализация), `backend/src/loads/dto/ingest.dto.ts`,
`load.model.ts` (колонки), `main.ts` (идемпотентные `ALTER TABLE loads ADD COLUMN IF NOT EXISTS`,
т.к. synchronize:true не меняет существующие таблицы), `loads.service.ts` (маппинг ingest +
updateOnDuplicate). `CrowdLoad`/`PartnerLoad` (read-формы) — без изменений.

## Тесты

- `extension/alerts.test.js`: toPayload пробрасывает brokerName/comments (старый тест «brokerName
  undefined» переворачивается).
- `telegram.service.spec.ts`: formatAlertMessage с именем брокера и comments.
- `loads.service.spec.ts`: ingest сохраняет новые поля; upsert их обновляет.
- Тест sanitizeLoad: контакты/comments проходят, длины ограничены, id — строки.

## Вне скоупа

- Отдача новых полей через GET-эндпоинты.
- Truckstop (DOM-адаптер полей этих не даёт — поля просто останутся null).
- shared/ не меняется → sync:shared не нужен (но `npm test` его гоняет — безвредно).
