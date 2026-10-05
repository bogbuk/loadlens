# Paddle: чеклист запуска live

Дата: 2026-10-03. Состояние: оплата в проде в режиме `BILLING_MODE=test` (sandbox, кнопку видят только админы),
sandbox-прогон и защита от двойной покупки пройдены 01.10. Спека — `../specs/2026-10-01-paddle-billing-design.md`.
Порядок ниже = порядок выполнения. «Ты» — основатель в дашборде Paddle, «Claude» — код/env.

## 1. Решения (ты)
- [x] **Цена с налогом или без** (05.10: с налогом, `location` как есть) (`tax_mode` цен). Сейчас `location`-режим: для EU/UK/MD $29 включает НДС (нетто $24.17), для US налог добавляется сверху.
      Рекомендация: оставить как есть. Основной рынок — US, там $29 так и остаётся $29 + sales tax; одна цифра на лендинге,
      а потеря на редких EU-клиентах меньше, чем путаница «$29 + VAT».
- [ ] Подтвердить каталог: LoadLens Pro, $29/мес и $290/год, без Paddle-триала (триал наш, 14 дней через `TRIAL_DAYS`).

## 2. Аккаунт Paddle, live-дашборд (ты)
- [ ] **Верификация аккаунта / андеррайтинг.** Paddle проверяет сайт: публичные цены с суммами, Terms, Refund policy, Privacy — на лендинге
      уже есть (`/`, `/terms.html`, `/refund.html`, `/privacy.html`, все упоминают Paddle как Merchant of Record). Подать и ждать одобрения.
- [ ] **Одобрение домена** `loadlens.krait.studio`: Checkout → Checkout settings → Request website approval. Без него live-чекаут не откроется.
- [ ] **Default payment link** = `https://loadlens.krait.studio/checkout.html` (в sandbox забыли один раз → 400 на создании транзакции).
- [ ] **Имя продавца**: исправить опечатку «rait StudioK» → «Krait Studio». Оно печатается в чекауте и в чеках покупателю.
- [ ] **Выплаты**: счёт в MD-банке (выделенный, под режим antreprenor independent) или Payoneer; налоговая форма внутри Paddle.
- [x] **Live-каталог** (05.10, через API): продукт `pro_01m45z0t1q34s62z9nzj287hd5` (saas), Monthly $29 `pri_01m45z0tahr05886phsa888r7z`,
      Yearly $290 `pri_01m45z0tjjy116eerfhsqb89cn`, quantity 1..1, `tax_mode=location`, без trial. id — в `.local_dev.env` (`PADDLE_LIVE_*`).
- [ ] **Вебхук (Notification destination)**: URL `https://loadlens.krait.studio/api/v1/billing/paddle/webhook`, события `subscription.*`
      (created, activated, trialing, updated, past_due, paused, resumed, canceled). Скопировать secret.
- [ ] **Client-side token** для live (Developer tools → Authentication) и **API key** live с правами на customers, transactions, subscriptions.

## 3. Env в Coolify (Claude, значения даёшь ты, в чат не вставлять — через файл)
- [ ] `BILLING_MODE=live`, `PADDLE_ENV=production`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_ID` (месяц),
      `PADDLE_PRICE_ID_YEARLY`, `PADDLE_WEBHOOK_SECRET`. `app env sync` → push в main (новый деплой подхватывает env).
      Защита: `live` без `PADDLE_ENV=production` = оплата скрыта, не баг.

## 4. Код и тексты (Claude, можно делать до одобрения, деплой — вместе с п.3)
- [ ] Лендинг, карточка Pro: «Contact us for Pro» (mailto) → «Start 14-day free trial» на установку расширения; «After the trial, write to us
      to keep Pro» → «After the trial, upgrade inside the extension, $29/mo». RU/RO через `landing/i18n.json` + `npm run build:landing`.
- [ ] Расширение: заметка «Email us to keep Pro» в `popup.js` остаётся только когда `user.billing=false`; при live она исчезает сама.
      Проверить, что в 0.9.5 так и есть (кнопки Upgrade/Manage с 0.9.4).
- [ ] 0.9.5 опубликован в Chrome Web Store (на ревью с 02.10). Старые версии покажут mailto, не блокер.
- [ ] Письма бота о конце триала: текст ведёт на Settings → Upgrade, а не «напишите нам» (проверить `trial.module`).

## 5. Боевой прогон (ты платишь, Claude смотрит логи)
- [ ] Не-админский тест-аккаунт → Upgrade → реальная карта → вебхук → `plan=pro`, `admin/stats subscribers=1`; чек на почту с верным именем продавца.
- [ ] Manage subscription открывает портал Paddle; отмена → вебхук `canceled` → `plan=free`.
- [ ] Возврат тестовой покупки через дашборд Paddle (комиссия Paddle при возврате не возвращается — одна покупка, не больше).
- [ ] `DELETE /users/me` при живой подписке: подписка отменяется, аккаунт удаляется.
- [ ] Логи бэкенда без ошибок вебхука; Paddle → Notifications → delivery без ретраев.

## 6. После запуска (ты)
- [ ] Регистрация «antreprenor independent» (Закон 228/2025, 15%) с первой реальной подпиской; уточнить CAEM 62.01/62.02 у бухгалтера.
- [ ] Выделенный счёт для выплат Paddle указан в режиме.
- [ ] Через неделю: сверка подписок Paddle ↔ `users.plan` (скрипт по `GET /subscriptions`), отзывы первых платящих.
