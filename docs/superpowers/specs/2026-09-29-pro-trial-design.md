# Pro trial: 14 дней Pro бесплатно

Date: 2026-09-29
Status: approved (дизайн), ждёт ревью спеки

## Цель

Открытое тестирование: каждый аккаунт один раз получает 14 дней Pro без карты, чтобы попробовать
парк, Telegram-алерты, цепочки Get-out и крауд-данные. Stripe нет, поэтому продление — письмо на
`hello@krait.studio` и ручное `→ pro` в админке. Главный результат беты — отзывы и список тех, кто
хочет остаться на Pro.

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Кому | Новым аккаунтам при регистрации + существующим Free при следующем обращении к auth. Один триал на аккаунт |
| Механика | Дата окончания `pro_until`, эффективный план вычисляется (`isPro`). План в БД по расписанию НЕ переключаем |
| Длительность | ENV `TRIAL_DAYS`, дефолт 14; `0` = новые триалы не выдаются (начатые дорабатывают) |
| Облако | Не входит в триал (как и раньше, `cloud_enabled` включает админ) |
| Напоминания | Telegram-DM за 2 дня до конца и в день окончания (с вопросами для фидбэка), по одному разу |
| Лендинг | Упоминание триала на EN/RU/RO |

Отвергнуто: ставить `plan='pro'` и откатывать кроном — упавший крон делает триал вечным, а ручной
Pro админа неотличим от триального. Промокоды — лишний шаг для пользователя, контроль объёма даёт
`TRIAL_DAYS=0`.

Принятый риск беты: email не подтверждается, новый адрес = новый триал. Видно в админке; кран —
`TRIAL_DAYS=0`.

## 1. Данные

Новые колонки `users` (идемпотентный `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `main.ts`, как
`password_reset_expires`; время — BIGINT epoch ms, как там же):

| Колонка | Тип | Смысл |
|---|---|---|
| `pro_until` | BIGINT NULL | до какого момента аккаунт — Pro независимо от `plan` |
| `trial_started_at` | BIGINT NULL | триал уже выдан (не NULL → повторно не выдаём) |
| `trial_notice` | SMALLINT NOT NULL DEFAULT 0 | 0 — ничего не слали, 1 — напоминание отправлено, 2 — сообщение об окончании отправлено |

Поля в `user.model.ts`: `proUntil`, `trialStartedAt`, `trialNotice`.

## 2. Чистые функции — `backend/src/users/plan.ts`

Без зависимостей от Nest/Sequelize, тестируются без моков (как `auth/device-limit.ts`,
`cloud/cloud-watchdog.ts`).

- `isPro(user, now): boolean` — `user.plan === 'pro' || (user.proUntil != null && user.proUntil > now)`.
  Блокировку НЕ учитывает: её проверяют гарды отдельно, как сейчас.
- `trialEndsAt(user): number | null` — `proUntil`, если `trialStartedAt != null` и `plan !== 'pro'`;
  иначе `null` (у постоянного Pro триала «нет»).
- `grantTrial(user, now, trialDays): { proUntil, trialStartedAt } | null` — патч, если
  `trialDays > 0 && trialStartedAt == null && plan === 'free' && !blocked`; иначе `null`.
  `proUntil = now + trialDays·86 400 000`.
- `trialDays(env): number` — `parseInt(TRIAL_DAYS)`, пусто/мусор → 14, отрицательное → 0.
- `decideTrialNotices(rows, now): { userId, kind: 'reminder' | 'ended' }[]`, для строк с
  `plan='free'`, `trialStartedAt != null`, `telegramChatId != null`:
  - `proUntil <= now`, `proUntil > now − 7 дней`, `trialNotice < 2` → `ended`
    (напоминание, если не успели, пропускаем — сразу `ended`);
  - `now < proUntil <= now + 48 ч`, `trialNotice < 1` → `reminder`;
  - остальное — ничего. Окно 7 дней: привязал бота через месяц после конца — старую новость не шлём.

## 3. Где выдаётся триал

`AuthService` вызывает `ensureTrial(user)` (применяет `grantTrial`, сохраняет, если патч не `null`) в
`register`, `login`, `refresh` и `me`. Все четыре возвращают `publicUser`, так что триал виден в том же
ответе. Существующий Free получает триал без действий: расширение зовёт `me` при открытии Settings.

## 4. Замена проверок Pro

Каждое `plan === 'pro'` на бэкенде → `isPro(user, Date.now())`:

- `common/premium-read.guard.ts` (Pro-JWT ветка);
- `drivers/pro.guard.ts` (парк, `PATCH telegram/alerts`, `POST telegram/notify`);
- `auth/device-limit.ts` / `auth/devices.service.ts` — лимит 3 устройств для эффективного Pro;
- `auth/admin.service.ts` — статистика и список пользователей (см. §7).

После правки `grep "plan === 'pro'\|plan !== 'pro'" backend/src` (без spec) находит только `plan.ts`.

## 5. API

`publicUser` (`register`/`login`/`refresh`/`me`):

```
{ email, plan: isPro ? 'pro' : 'free', trialEndsAt: number | null, cloudEnabled }
```

`plan` — эффективный: старые версии расширения во время триала видят Pro без правок.
`trialEndsAt` отдаётся и после окончания (в прошлом) — по нему расширение пишет «trial has ended».

## 6. Напоминания в Telegram

`backend/src/trial/` — `TrialModule` с `TrialNoticesService`: `@Cron('0 * * * *')` → `runNotices(now)`:
выбрать кандидатов (SQL-фильтр по §2), `decideTrialNotices`, для каждого
`TelegramService.sendMessageTo`; `trial_notice` поднимаем ТОЛЬКО при `true` (нет токена бота или
ошибка → повтор через час). Ошибки ловятся и логируются, как в `cloud.service.watchdogTick`.
Модуль импортирует `TelegramModule` и модель `User` (см. память про DI гардов/модулей).

Тексты (EN, как весь бот):

- reminder: `Your LoadLens Pro trial ends in 2 days (<date>). Want to keep Pro? Write to hello@krait.studio and we'll switch your account.`
- ended: `Your LoadLens Pro trial has ended. Fleet, alerts and crowd data are now off.` + пустая строка +
  `Help us make LoadLens better, reply to hello@krait.studio: 1) What was most useful? 2) What was missing? 3) What would you pay per month for Pro?`

## 7. Админка

- `admin.service` список: поле `trialEndsAt` (через `trialEndsAt(user)`); статистика: `trialUsers` —
  `plan='free' AND pro_until > now`; `proUsers` — как и раньше, только постоянный Pro.
- `setPlan('pro')` — `plan='pro'` (`pro_until` не трогаем, он уже не важен).
  `setPlan('free')` — `plan='free'`, `pro_until=NULL` (обрывает активный триал; `trial_started_at`
  остаётся, повторно не выдастся).
- `admin.html`: у пользователя на триале бейдж `trial → 13 Oct` (прошедший — `trial ended`), плитка
  «На триале» в статистике.

## 8. Расширение

- `api.js`: `trialEndsAt` сохраняется в `ll_auth` рядом с `plan`. Кэш плана считается свежим, только
  если `now − planTs < 24ч` И НЕ (`trialEndsAt != null && planTs < trialEndsAt <= now`) — в момент
  окончания триала `getMe` сам сходит на сервер.
- `popup.js` (Settings):
  - триал активен: бейдж `PRO TRIAL`, строка `Pro trial: N days left.` + ссылка `Keep Pro`
    (`LLCONTACT.mailto('pro', email)`); `N = ceil((trialEndsAt − now)/сутки)`, «1 day» в единственном;
  - триал закончился (`plan='free'`, `trialEndsAt` в прошлом): бейдж `FREE`, строка
    `Your Pro trial has ended.` + `Email us to keep Pro`;
  - `acctKey` включает `trialEndsAt`, чтобы Settings перерисовывался при выдаче триала.
- `content.js` (CSV) не меняется — проверяет `me.plan`, который уже эффективный.

## 9. Лендинг (`backend/public/index.html`, EN/RU/RO)

- Карточка Pro: подзаголовок `Try Pro free for 14 days. Everything in Free, plus:`; кнопка остаётся
  `Contact us for Pro`, заметка — `After the trial, write to us to keep Pro.`
- Под главной кнопкой: `Free plan, no card. Sign up in the extension and get 14 days of Pro.`
- Ключи RU/RO — в словарь, `scripts/landing-i18n.test.js` ловит пропуски.

## 10. Документация и релиз

- `.env.example` + CLAUDE.md (раздел env): `TRIAL_DAYS`.
- CLAUDE.md, конвенции: пункт «Pro trial» — `isPro` единственная проверка Pro, `pro_until`,
  напоминания, `TRIAL_DAYS`.
- `docs/user-guide.md` §12: строка про триал; заодно исправить §10 (агрегат отзывов о брокерах видит
  только Pro — `GET brokers/:mc/reputation` за Premium-гардом).
- CHANGELOG `[Unreleased]`.
- Порядок: бэкенд (push в `main` → автодеплой) работает и со старым расширением; UI триала едет
  в следующей подаваемой в CWS версии (0.9.3 ещё не подан — решить при релизе, пересобрать ли его).

## 11. Тесты

- `users/plan.spec.ts`: `isPro` (постоянный, активный триал, истёкший, граница `== now`),
  `trialEndsAt`, `grantTrial` (новый, уже был, Pro, blocked, `trialDays=0`), `trialDays` (пусто,
  мусор, `0`, `-3`), `decideTrialNotices` (напоминание, пропуск сразу в `ended`, окно 7 дней,
  без повторов, без чата, постоянный Pro).
- `auth.service.spec.ts`: register выдаёт триал; login существующего Free — выдаёт один раз;
  `TRIAL_DAYS=0` — не выдаёт; `publicUser` — эффективный `plan` и `trialEndsAt`.
- `premium-read.guard.spec.ts`, новый `drivers/pro.guard.spec.ts`: триал пускает, истёкший — 403.
- `admin.service.spec.ts`: `setPlan('free')` обрывает триал; `trialUsers` в статистике.
- `trial-notices.service.spec.ts`: `sendMessageTo` `false` → `trial_notice` не растёт; `true` → растёт.
- `extension/api.test.js`: кэш протухает на `trialEndsAt`; `trialEndsAt` сохраняется.
- `e2e:popup`: сценарий Settings с активным и закончившимся триалом.
