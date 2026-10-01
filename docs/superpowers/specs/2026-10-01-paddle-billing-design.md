# Самостоятельная оплата Pro через Paddle — дизайн

Дата: 2026-10-01. Статус: одобрен в чате, ждёт ревью спеки.
Контекст: Stripe в Молдове не работает; ресерч — `docs/research/2026-10-01-payments-moldova.md`. Решения
основателя: Paddle (Merchant of Record) как физлицо-резидент MD; Pro **$24/мес**, только месячный тариф;
возврат 14 дней с первой оплаты; облачный браузер не продаём. Лендинг под модерацию Paddle (цена, `/terms.html`,
`/refund.html`, раздел Payments в privacy) — уже в проде (9c53d19).

## Цель и критерий успеха

Пользователь сам покупает Pro из расширения, Pro включается автоматически в течение секунд после оплаты и
выключается в конце оплаченного периода после отмены — без участия админа.

**Жёсткое требование:** до запуска в live **никто, кроме админов, не видит кнопку оплаты** — ни в текущей,
ни в будущих опубликованных версиях расширения, ни на лендинге.

## Вне объёма (YAGNI)

- Годовой тариф, купоны, несколько цен, оплата за места (seats).
- Продажа облачного браузера (остаётся по приглашению, `cloud_enabled` руками).
- Триал на стороне Paddle — триал остаётся нашим (`ensureTrial`, 14 дней без карты).
- Кнопка оплаты на лендинге — добавляется отдельным шагом в момент запуска live.
- Своя страница истории платежей/чеков — это даёт Customer Portal Paddle.

## 1. Переключатель `BILLING_MODE`

Чистая функция `billingVisible(mode, user)` в `backend/src/billing/billing.ts`:

| `BILLING_MODE` | кто видит/может купить | ключи Paddle |
|---|---|---|
| `off` / пусто / неизвестное значение (дефолт) | никто; эндпоинты `/billing/*` (кроме вебхука) → 503 | — |
| `test` | только `role === 'admin'` | sandbox (`PADDLE_ENV=sandbox`) |
| `live` | все залогиненные, не заблокированные | production |

- Неизвестное значение трактуется как `off` (опечатка в env не должна открыть оплату).
- Фича требует и режима, и полного набора ключей: без `PADDLE_API_KEY`/`PADDLE_PRICE_ID`/`PADDLE_CLIENT_TOKEN`
  `billingVisible` = false при любом режиме (как фича-флаги Telegram/EIA).
- `publicUser` добавляет `billing: boolean` (= `billingVisible`) и `subscription: { status, renewsAt } | null`.
- Расширение рисует кнопку Upgrade/Manage **только при `user.billing === true`**; иначе — текущие mailto-ссылки.
  Старые версии расширения поле игнорируют → ничего не меняется.
- Вебхук работает при любом режиме, кроме `off` (в `off` отвечает 503 — Paddle повторит позже).

## 2. Покупка (checkout)

1. В Settings (`popup.js`, `planNote`) кнопка **Upgrade to Pro — $24/mo** → `LLAPI.billingCheckout()` →
   `POST /api/v1/billing/checkout` (JwtAuthGuard).
2. Бэкенд (`BillingService.createCheckout`): гейт `billingVisible`; если у пользователя уже есть активная подписка
   (`subscription_status` ∈ active/past_due) → 409 «already subscribed». Иначе `POST {paddle}/transactions`:
   `items: [{ price_id: PADDLE_PRICE_ID, quantity: 1 }]`, `custom_data: { userId }`, `customer` по email
   (существующий `paddle_customer_id` или создание/поиск по email). Ответ — `{ url: transaction.checkout.url }`.
   `custom_data` ставит сервер → подменить получателя Pro нельзя.
3. `checkout.url` ведёт на **default payment link** аккаунта Paddle = `https://loadlens.krait.studio/checkout.html`
   с `?_ptxn=txn_…`. Расширение открывает его во вкладке (`chrome.tabs.create`).
4. `backend/public/checkout.html` — статическая страница: `noindex`, не в sitemap, без ссылок на неё; грузит
   `https://cdn.paddle.com/paddle/v2/paddle.js`, `Paddle.Environment.set('sandbox')` при sandbox,
   `Paddle.Initialize({ token })` — Paddle.js сам открывает overlay по `_ptxn`. Токен и окружение страница
   берёт из `GET /api/v1/billing/client-config` (публичный, отдаёт `{ env, clientToken }` только при режиме ≠ off;
   client-side token Paddle публичен по своей природе). Событие `checkout.completed` → экран «Pro is on — you can
   close this tab». Без `_ptxn` — короткий текст со ссылкой на главную. Metrika на странице не ставим.
5. Скрипт Paddle в расширение **не грузим** (MV3 запрещает удалённый код) — поэтому checkout на сайте.

## 3. Вебхук

`POST /api/v1/billing/paddle/webhook` (без JWT).

- **Подпись**: заголовок `Paddle-Signature: ts=…;h1=…`; `h1 = HMAC-SHA256(PADDLE_WEBHOOK_SECRET, ts + ':' + rawBody)`,
  сравнение `timingSafeEqual`; `ts` старше 5 минут → отказ (replay). Нет/неверная подпись → 401.
  Для этого `main.ts` сохраняет сырое тело: `json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf } })`.
- **События**: `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.canceled`,
  `subscription.past_due`, `subscription.paused`, `subscription.resumed`. Остальные → 200 и игнор.
- **Поиск пользователя**: `data.custom_data.userId`, фолбэк — по `paddle_subscription_id`, затем по
  `paddle_customer_id`. Не нашли (удалён) → 200 и `log.warn` (повтор бесполезен).
- **Порядок/идемпотентность**: `occurred_at` события сравнивается с `users.paddle_event_at`; старее или равно → 200,
  без изменений. Paddle не гарантирует порядок доставки.
- **Маппинг** — чистая `applySubscriptionEvent(user, event) → patch` в `billing.ts`:

  | `data.status` | `plan` | примечание |
  |---|---|---|
  | `active`, `trialing` | `pro` | `trialing` не используем, но не ломаемся |
  | `past_due` | `pro` | Paddle ещё повторяет списание (dunning) |
  | `paused`, `canceled` | `free` | `canceled` приходит в конце оплаченного периода; `proUntil` не трогаем |

  Patch всегда пишет `paddle_subscription_id`, `paddle_customer_id`, `subscription_status`,
  `subscription_renews_at` (= `data.next_billed_at`, ms или null), `subscription_ends_at` (= `scheduled_change.effective_at` при `action: cancel`), `paddle_event_at`. При `pro` проставляет
  `trial_started_at`, если он пуст (как `setPlan`: оплата = триал использован).
- **Конфликт с ручным Pro**: если админ выдал постоянный Pro и пользователь при этом купил подписку, то `canceled`
  переведёт его во free. Принято: ручной Pro до запуска — у единиц, админка позволяет вернуть.
- Ответ на успешную обработку — 200 быстро; ошибки БД → 500 (Paddle повторит).

## 4. Управление подпиской и удаление аккаунта

- `POST /api/v1/billing/portal` (Jwt, гейт `billingVisible`) → `POST {paddle}/customers/{id}/portal-sessions`
  (с `subscription_ids`) → `{ url }`; расширение открывает вкладку. В Settings у подписчика вместо Upgrade —
  **Manage subscription** + «renews on <дата>» / «ends on <дата>» (если в `scheduled_change` стоит отмена).
- **`DELETE /users/me`**: если `subscription_status` ∈ active/past_due/paused — сначала
  `POST {paddle}/subscriptions/{id}/cancel` с `effective_from: 'immediately'`; ошибка Paddle → 502 и аккаунт **не**
  удаляется (иначе удалённый пользователь продолжал бы платить). Деньги за текущий период — по Refund Policy
  через поддержку.

## 5. Данные

Новые колонки `users` (идемпотентный `ALTER TABLE … ADD COLUMN IF NOT EXISTS` в `main.ts` + поля модели):
`paddle_customer_id TEXT`, `paddle_subscription_id TEXT`, `subscription_status TEXT`,
`subscription_renews_at BIGINT`, `subscription_ends_at BIGINT` (дата запланированной отмены из `scheduled_change`), `paddle_event_at BIGINT`. Индекс по `paddle_subscription_id`.
Админка (`/admin.html`, `users/stats`) показывает статус подписки в строке пользователя; число подписчиков в сводке.

## 6. Модуль и конфиг

`backend/src/billing/`: `billing.ts` (чистые: `billingMode`, `billingVisible`, `verifySignature`,
`applySubscriptionEvent`), `paddle.client.ts` (fetch к `https://api.paddle.com` или `https://sandbox-api.paddle.com`
по `PADDLE_ENV`, Bearer `PADDLE_API_KEY`), `billing.service.ts`, `billing.controller.ts`, `billing.module.ts`.
Без SDK Paddle — три вызова API, fetch достаточно (как EIA/OSRM).

Env (в Coolify; значения в чат/репо не попадают): `BILLING_MODE`, `PADDLE_ENV`, `PADDLE_API_KEY`,
`PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_ID`, `PADDLE_WEBHOOK_SECRET`. `.env.example` — имена с пустыми значениями.

## 7. Расширение

- `extension/plan-view.js` (`LLPLANVIEW.view`) получает поля `billing`/`subscription` и отдаёт действие:
  `upgrade` | `manage` | `contact` (текущее поведение). Чистая функция — юнит-тесты.
- `popup.js` `planNote`: при `upgrade` — кнопка Upgrade, при `manage` — Manage + дата; при `contact` — без изменений.
- `api.js`: `billingCheckout()`, `billingPortal()`.
- После возврата во вкладку Settings перечитывает `me` (уже делает при открытии) — план обновится сам.
- Версия расширения: 0.9.4 (в CWS подаётся отдельно, кнопка всё равно скрыта флагом).

## 8. Ошибки

| ситуация | поведение |
|---|---|
| режим off / нет ключей | `/billing/checkout|portal|client-config` → 503; кнопки нет |
| Paddle API недоступен при checkout/portal | 502, расширение показывает «Payment service is unavailable, try later or email us» |
| уже подписан | 409 → расширение показывает Manage |
| вебхук с плохой подписью | 401, ничего не меняем |
| вебхук о неизвестном пользователе | 200 + warn |
| удаление аккаунта, отмена в Paddle упала | 502, аккаунт цел, сообщение «try again» |

## 9. Тестирование

- Юнит (`billing.spec.ts`): `billingMode` (off/test/live/опечатка), `billingVisible` (админ/не админ, нет ключей,
  blocked), `verifySignature` (верная, неверная, протухший ts, битый заголовок), `applySubscriptionEvent`
  (все статусы, старое событие игнорируется, trial_started_at проставляется).
- Сервис/контроллер с моком `PaddleClient`: checkout (гейт, 409, custom_data), вебхук (поиск пользователя
  по трём ключам), `deleteMe` отменяет подписку и не удаляет при ошибке Paddle.
- Расширение: `plan-view.test.js` — три действия.
- Живой прогон: прод с `BILLING_MODE=test` + sandbox-ключи, админский аккаунт, тестовая карта Paddle →
  Pro включился → Manage → отмена → `canceled` (sandbox позволяет отменить немедленно) → free. Обычный аккаунт
  в это время кнопку не видит (проверить).

## 10. Запуск live (отдельный шаг, не в этой задаче)

Аккаунт Paddle одобрен → production-ключи и цена в Coolify, `PADDLE_ENV=production`, `BILLING_MODE=live`;
кнопка на лендинге вместо «Contact us for Pro»; тексты «write to us to keep Pro» → «Upgrade»; регистрация
antreprenor independent и выделенный счёт для выплат.
