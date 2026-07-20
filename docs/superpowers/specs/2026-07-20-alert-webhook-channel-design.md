# Webhook-канал алертов — design

Date: 2026-07-20
Status: approved, deferred (реализация после английской локализации)

## Мотивация

Запрос потенциального платящего пользователя (US-диспетчер): *«i want webhook notifications when
load pops up for DAT»*. Сейчас единственный канал алертов — Telegram DM, что отсекает всех, у кого
рабочий контур — Slack, Discord, Zapier, Make, n8n или собственный сервер.

Дизайн согласован 2026-07-20, реализация отложена: сначала выкатывается английская локализация
(`2026-07-20-english-localization-design.md`), она занимает часы против нескольких дней здесь.

## Архитектура

### Расщепление релея и канала

Сейчас `TelegramService.notify()` делает три вещи сразу: гейт (привязан ли Telegram) → дедуп/cap →
отправка. Добавить второй канал без расщепления нельзя — пришлось бы дублировать дедуп.

Новый модуль `backend/src/alerts/`:

- **`AlertsService`** — владеет политикой доставки, не знает про транспорты. Принимает `items`,
  применяет дедуп (`alert_sends`, ключ `userId+dedupKey`, TTL 6ч) и soft-cap (10 за 10 мин),
  веером отдаёт каждый прошедший груз в активные каналы пользователя.
- **`TelegramChannel`** — тонкая обёртка над существующими `TelegramService.sendMessageTo` +
  `formatAlertMessage`. Логика Telegram (link / status / unlink / вебхук `/start`) остаётся в
  `telegram/` без изменений.
- **`WebhookChannel`** — новый: валидация URL, сборка payload, HMAC-подпись, POST, ретрай,
  счётчик отказов.

### Семантика доставки

Неочевидные решения, зафиксированы явно:

- **Дедуп — на пользователя, а не на канал.** Одна запись `alert_sends` означает «этот груз уже
  показан этому диспетчеру». Иначе при включении webhook человек получит в Slack шестичасовую пачку
  старья, уже пришедшего в Telegram.
- **Запись дедупа ставится, если хотя бы один канал доставил.** Упал Telegram, ушёл webhook → груз
  считается доставленным. Оба упали → записи нет, повтор на следующем тике.
- **Cap считает грузы, а не отправки.** 10 грузов за 10 минут — это 10 сообщений в Telegram и 10
  POST'ов на webhook, а не 5 + 5.

### Эндпоинты

Все под `JwtAuthGuard` + `ProGuard` (как текущие Telegram-алерты).

| метод | путь | назначение |
|---|---|---|
| `POST` | `/alerts/notify` | релей от расширения; переезд с `/telegram/notify`, старый путь остаётся алиасом — у пользователей стоят старые сборки расширения |
| `GET` | `/alerts/channels` | сводный статус: `{telegram:{configured,linked,enabled}, webhook:{enabled,url,format,includeContacts,failing}}` |
| `PUT` | `/alerts/webhook` | сохранить URL / формат / тумблеры; возвращает сгенерированный signing secret |
| `DELETE` | `/alerts/webhook` | отключить канал |
| `POST` | `/alerts/webhook/test` | отправить тестовый груз-пример — без него пользователь не поймёт, верно ли настроил |

## Хранение

Новые колонки в `users`, добавляются идемпотентным `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в
`main.ts` (конвенция проекта: `synchronize: true` не меняет существующие таблицы).

`webhook_url`, `webhook_secret`, `webhook_format` (`generic` | `slack` | `discord`),
`webhook_enabled`, `webhook_include_contacts` (default `false`), `webhook_fail_count`,
`webhook_disabled_at`.

## Безопасность доставки

### SSRF-гард

Обязателен: мы ходим HTTP-запросом на URL, который диктует пользователь.

- Только `https://`, только порт 443.
- Резолвим DNS **и при сохранении, и перед каждой отправкой** — иначе DNS rebinding обходит
  проверку. Reject для loopback, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local
  `169.254.0.0/16` (это же метадата-эндпоинт облака), `::1` и ULA.
- Редиректы не следуем (`redirect: 'manual'`) — иначе 301 на `localhost` сводит гард на нет.
- Таймаут 5с, один ретрай при таймауте или 5xx; 4xx не ретраим.

### Подпись

`X-LoadLens-Signature: sha256=<hex>` — HMAC-SHA256 от сырого тела; плюс `X-LoadLens-Timestamp`.
Секрет генерится при сохранении и показывается в попапе один раз. Для форматов `slack`/`discord`
подпись тоже отправляется — она им не мешает.

### Авто-отключение

20 подряд неуспешных доставок → `webhook_enabled = false`, в `GET /alerts/channels` выставляется
`failing`, попап показывает «Webhook disabled after repeated failures». Успешная доставка сбрасывает
счётчик. Без этого мёртвый Zapier-хук вечно жрёт по два запроса с ретраем на каждый груз.

## Payload

### `generic`

```json
{
  "event": "load.matched",
  "sentAt": "2026-07-20T14:02:11Z",
  "load": {
    "originMarket": "CHICAGO_IL",
    "destMarket": "DALLAS_TX",
    "equipment": "V",
    "rate": 2400,
    "loadedMiles": 968,
    "deadheadMiles": 42,
    "ratePerMile": 2.38,
    "pickupDate": "2026-07-22",
    "broker": { "name": "...", "mc": "123456", "creditScore": 92 }
  }
}
```

### `slack` / `discord`

`{"text": <...>}` и `{"content": <...>}` соответственно, где значение — тот же готовый текст, что
уходит в Telegram. Переиспользуем `formatAlertMessage`, второй форматтер не пишем.

Формат по умолчанию определяется по хосту URL (`hooks.slack.com` → `slack`,
`discord.com/api/webhooks` → `discord`), с ручным override в попапе. Причина поддержать пресеты:
это самые частые «вебхуки» у диспетчеров, и они позволяют вставить Incoming Webhook URL напрямую,
без прослойки Zapier.

## PII

Telegram-алерт сейчас содержит контакт брокера и `comments` — обосновано тем, что это личный DM
самому пользователю, который и так видит эти поля в своей сессии DAT.

Webhook — другой случай: URL произвольный, тело уходит в Zapier / чужой Slack-workspace / сторонний
сервер и оседает в их логах.

**Решение:** полный payload, но контакты — за явным тумблером `webhook_include_contacts`,
по умолчанию выключенным.

**Важно:** тумблер гейтит не только `contactEmail` / `contactPhone`, но и **`comments`** — поле
комментария груза на DAT регулярно содержит email и телефон («call/email me at…»). Иначе выключенный
тумблер даёт ложное чувство, что PII не уходит.

Подпись под чекбоксом: *«Include broker contact details and load comments. These are sent to your
endpoint and may be stored by that third-party service.»*

Вариант «полный payload по умолчанию» отвергнут: не хочется переделывать под претензией о
редистрибуции Product Data. Вариант «вообще без PII» отвергнут: для основного сценария
(«алерт в Slack → сразу звоню брокеру») контакт критичен.

## Изменения в расширении

- `extension/alerts.js`: `refreshStatus` переезжает с `telegramStatus()` на `GET /alerts/channels`;
  гейт `push()` меняется с «Telegram привязан и включён» на «активен хотя бы один канал».
- `extension/api.js`: `notifyAlerts` → `POST /alerts/notify`.
- `extension/popup.js`: секция «Telegram-уведомления» обобщается до «Notifications» — Telegram и
  Webhook как два подраздела; для webhook — поле URL, селектор формата, тумблер контактов, кнопка
  Test, показ signing secret.

## Тестирование

Чистые юниты, без сети:

- сборка payload для каждого формата (`generic` / `slack` / `discord`);
- PII-гейтинг (`includeContacts` = false вырезает `contactEmail`, `contactPhone`, `comments` — и из
  JSON, и из текста для slack/discord);
- валидация URL / SSRF-гард (таблица кейсов: приватные диапазоны, loopback, link-local, http, порт);
- HMAC-подпись — стабильность для известного входа;
- fan-out `AlertsService`: дедуп на пользователя, «хотя бы один канал доставил», cap считает грузы.

Интеграционно — `POST /alerts/webhook/test` против локального заглушечного сервера.
