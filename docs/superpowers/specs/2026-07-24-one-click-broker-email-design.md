# One-click письмо брокеру + контр-оффер — дизайн

Date: 2026-07-24
Status: approved

## Зачем

Ресёрч потребностей пользователей (Fable-оркестрированный, 4 исследователя + синтез, 2026-07-24)
выделил сквозную потребность №1: **скорость действия — от «увидел груз» до «связался с брокером» за
секунды**. Первое письмо обычно выигрывает груз.

Сегодня LoadLens останавливается на инсайте: контакты брокера распарсены, медиана lane и break-even
посчитаны, — но диспетчер вручную пишет письмо и сам придумывает контр-цену. При этом one-click email
— **table stakes у всех конкурентов**: LoadConnect ведёт им каждый тариф (Starter $18 — «Unlimited
emails, Multiple email templates»), LoadHunter — авто-емейлинг, Numeo Spot даёт 20 писем/день даже на
бесплатном тарифе. Отсутствие фичи блокирует переключение на LoadLens.

Вторая половина ценности — **контр-оффер**: у большинства грузов 10–30 % переговорного зазора, а
постированная ставка — стартовая позиция брокера. Медиана lane, deadhead и break-even уже посчитаны;
превратить их в конкретную сумму запроса — это +$50–200 на груз, самая осязаемая ROI-претензия
продукта.

Дизайн частично проработан в брейншторме 2026-06-18 (отложен пользователем перед записью спеки);
принятые тогда решения здесь сохранены, парсер контактов с тех пор уже расширен.

## Решения

| Решение | Выбор | Почему |
|---|---|---|
| Pro-гейт на отправку | **нет** (v1 доступно всем, включая аноним) | Это acquisition-крюк; гейтить фичу, ради которой переключаются — резать вершину воронки. Подтверждено пользователем 2026-07-24. |
| Канал отправки | **Gmail compose URL (primary) + «Copy email» (фолбэк)** | Целевая аудитория сидит в Gmail web; prefill-URL не режет длинный body и не зависит от default mail-handler ОС. `mailto:` у многих открывает пустоту. |
| Авто-отправка | **нет**, только prefill — юзер сам жмёт Send | Отсутствие content-script в Gmail, новых host-permissions и DOM-скрейпинга. Авто-outreach — отдельное решение. |
| Шаблон | один, редактируемый, локально в `chrome.storage` (`ll_mail_template`) | YAGNI: множественные шаблоны/подписи/CC — после спроса. |
| Бэкенд | **не трогаем**, деплой не нужен | Вся фича — на данных, уже имеющихся у клиента. |

## ToS / PII

Чисто по построению: **запросов к DAT не добавляется вообще**. Пользователь отправляет письмо из
своего почтового клиента на контакт, который видит в своей залогиненной сессии. Контакты брокера
наружу через наш API не уходят — фича целиком клиентская.

## Компоненты

### 1. `shared/email-template.js` — новый канон (`LLMAIL`)

Чистый zero-dep модуль (браузер + Node + тесты), как `LLEQUIP`/`LLVIS`. Синк в `extension/vendor/`
через `npm run sync:shared`.

- `DEFAULT_TEMPLATE` — текст письма с плейсхолдерами:
  `{{origin}} {{dest}} {{equipment}} {{rate}} {{rateBasis}} {{loadedMiles}} {{deadheadMiles}}`
  `{{trueRpm}} {{brokerName}} {{brokerMc}} {{driverName}} {{counterOffer}} {{pickupDate}}`
- `fillTemplate(tpl, load, driver, extras)` — подстановка. Неизвестные плейсхолдеры и пустые поля
  дают аккуратный фолбэк (`—`), **никогда** не `undefined`/`null` в тексте.
- `subjectFor(load)` → `Load inquiry: CHICAGO_IL → ATLANTA_GA (Vans)`.
- `gmailComposeUrl(to, subject, body)` → `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`
  (все части через `encodeURIComponent`).

### 2. `shared/scoring.js` → `counterOffer(load, ctx)`

Чистая функция. `ctx = { laneMedian, costPerMile }`.

```
total         = (loadedMiles || 0) + (deadheadMiles || 0)
если !rate или total <= 0        -> { ask: null, script: null }
marketRate    = laneMedian != null ? laneMedian * total : null
breakevenRate = costPerMile * total
minAsk        = rate * 1.10                  // всегда просим минимум на 10% выше постинга
raw           = max(minAsk, breakevenRate * 1.15, marketRate ?? 0)
если marketRate != null:
  raw = min(raw, max(marketRate * 1.15, minAsk))   // потолок «не проси абсурд», но не ниже minAsk
ask           = округление вверх до $25 от raw
```

Возвращает `{ ask, script }`, где `script` — одна строка для телефона и письма:

> `Offered $1,850 — I can do $2,150 (market ≈ $2.45/mi, +150mi deadhead).`

Части в скобках условные: нет медианы — нет «market ≈»; нет deadhead — нет хвоста. Если `ask === null`
— строка контр-оффера в письме не рендерится вовсе, письмо уходит без запроса цены.

### 3. `content.js` → `openLoadDetail` (ряд `actions`, ~стр. 365–386)

Кнопки контакта **умные, по `load.preferredContactMethod`**:

- есть `contactEmail` → **`✉️ Email broker`** (`btn primary`) — `window.open(gmailComposeUrl(...))`.
- `preferredContactMethod === 'PRIMARY_PHONE'`/нет email → ведущей становится **`📞 Call`** (`tel:`),
  email-кнопка не рисуется без адреса.
- **`📋 Copy email`** — кладёт в буфер `subject + "\n\n" + body` (для не-Gmail).
- Существующая `Copy` (copy load info) сохраняется; в её текст добавляются `market $X/mi` и
  строка контр-оффера, чтобы блок годился для вставки в TMS/сообщение водителю.

Медиана берётся из уже имеющегося `laneCache` (та же, что в `profitBadge`), `costPerMile` — из
текущего контекста водителя, `driverName` — из активного водителя (`activeDriver`), в аноним-режиме
плейсхолдер пустой.

### 4. `popup.js` — секция «Email»

Textarea с шаблоном + кнопка **Reset to default** + короткая подсказка со списком плейсхолдеров.
Хранение `chrome.storage.ll_mail_template`; `content.js` читает его с фолбэком на `DEFAULT_TEMPLATE`.

## Тесты

- `shared/email-template.test.js` — `fillTemplate` (полный груз / пустые поля / неизвестный
  плейсхолдер), `subjectFor`, `gmailComposeUrl` (URL-кодирование спецсимволов и переводов строк).
- `shared/scoring.test.js` (дополнение) — `counterOffer`: с медианой и без, срабатывание floor
  (break-even) и cap (market·1.15), гарантия `ask > rate`, округление до $25, `null`-данные.
- Существующий раннер (`npm test`) подхватывает оба файла; после правки `shared/` — `npm run sync:shared`.

## Риски

- **Gmail-only в v1** — пользователи Outlook/Yahoo получают только «Copy email». Принято осознанно;
  выбор провайдера в popup — если появится спрос.
- **Контр-оффер может быть слишком агрессивным** на тонких данных (мало отчётов в медиане). Смягчено
  потолком `market·1.15` и тем, что цифра — предложение в редактируемом письме, а не авто-отправка.
- **Длина body** — Gmail compose URL терпит длинный текст; шаблон по умолчанию держим коротким
  (5–7 строк), чтобы письмо читалось с телефона брокера.

## Вне скоупа

Авто-отправка и AI-переговоры (путь LoadHunter/Numeo AI Hub), множественные шаблоны/подписи/CC,
несколько почтовых аккаунтов, история отправленных писем, Pro-гейт и дневные лимиты.
