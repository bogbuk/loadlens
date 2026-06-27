# Дизайн: сброс пароля («Забыл пароль») через Telegram

Date: 2026-06-27
Status: approved

## Цель

Дать пользователю, забывшему пароль, восстановить доступ. Доставка кода сброса — через
существующего Telegram-бота (без внешнего email-провайдера). Работает для тех, кто привязал
Telegram; для остальных — тихий no-op (канала нет, email-провайдер — позже).

## Поток

1. В попапе на экране логина — ссылка **«Забыл пароль?»**.
2. Юзер вводит email → `POST /auth/forgot`.
3. Если у юзера привязан Telegram и бот сконфигурён — бот DM-ит короткий **код** (TTL 30 мин).
4. Юзер вводит код + новый пароль → `POST /auth/reset` → пароль сменён.

## 1. Модель `User` (+2 колонки)

Идемпотентный ALTER в `backend/src/main.ts` (рядом с прочими):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires BIGINT;
```
Модель: `passwordResetTokenHash: string|null` (`field: 'password_reset_token_hash'`),
`passwordResetExpires: number|null` (`DataType.BIGINT`, `field: 'password_reset_expires'`).
Хеш — **sha256 кода** (плейн не храним: токен сброса = доступ к аккаунту).

## 2. Бэкенд (`AuthService` + `AuthController`)

Эндпоинты под `/auth` (Throttle 5/60s уже навешен на auth-роуты — добавить тот же `@Throttle`).

### `POST /auth/forgot` body `{ email }` (DTO `ForgotDto`: `@IsEmail @MaxLength(254)`, нормализация trim+lowercase как в `CredentialsDto`)
- Нормализуем email, `findOne({ where: { email } })`.
- Если `user && user.telegramChatId && botConfigured`:
  - код = 8 символов из безопасного алфавита `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (без 0/O/1/I), crypto-random (`randomInt` на каждый символ);
  - `user.passwordResetTokenHash = sha256(code)`, `user.passwordResetExpires = Date.now() + 30*60*1000`, `save()`;
  - `telegram.sendMessageTo(user.telegramChatId, 'Код сброса пароля LoadLens: <code>\nДействует 30 минут. Если вы не запрашивали сброс — игнорируйте.')`.
- **Всегда** возврат `{ ok: true }` (никакого enumeration — не палим существование/привязку/конфиг).
- `botConfigured` определяем по `process.env.TELEGRAM_BOT_TOKEN`.

### `POST /auth/reset` body `{ token, newPassword }` (DTO `ResetPasswordDto`: `token` `@IsString @MaxLength(64)`, `newPassword` `@IsString @MinLength(8) @MaxLength(128)`)
- `hash = sha256(token.trim())`.
- `findOne({ where: { passwordResetTokenHash: hash } })`; если нет или `passwordResetExpires == null` или `passwordResetExpires < Date.now()` → `BadRequestException('недействительный или истёкший код')`.
- `user.passwordHash = bcrypt.hash(newPassword, 10)`, `user.passwordResetTokenHash = null`, `user.passwordResetExpires = null`, `save()` (код одноразовый — чистится при успехе).
- Возврат `{ ok: true }`. (Логиниться юзер будет отдельно новым паролем.)

Хелпер `sha256(s)` — `crypto.createHash('sha256').update(s).digest('hex')`. Код генерации
вынести в чистую функцию `genResetCode(): string` (тестируемо: длина 8, только из алфавита).

## 3. Telegram-связка (без цикла зависимостей)

- `TelegramService`: добавить публичную `async sendMessageTo(chatId: string, text: string): Promise<boolean>`
  — тонкая обёртка над `protected send(...)` (тестовый seam сохраняется).
- `TelegramModule`: добавить `TelegramService` в `exports`.
- `AuthModule`: добавить `TelegramModule` в `imports`; `AuthService` инжектит `TelegramService`.
- Цикла нет: `TelegramModule` не импортит `AuthModule` (берёт `User` напрямую через `forFeature`,
  `JwtAuthGuard`/`ProGuard` — как провайдеры). Проверено.
- Без `TELEGRAM_BOT_TOKEN` `send` возвращает false → forgot тихо без доставки (generic 200 сохраняется).

## 4. Попап (`api.js` + `popup.js`)

- `api.js`: `forgotPassword(email)` → `POST {BASE}/auth/forgot {email}` (без авторизации, как login/register
  через `auth(path)`-хелпер); `resetPassword(token, newPassword)` → `POST {BASE}/auth/reset`. Оба
  бросают серверное сообщение при `!ok`, иначе `{ ok: true }`. Добавить в экспорт `LLAPI`.
- `popup.js`: в `accForm` добавить ссылку **«Забыл пароль?»** → `resetForm()`:
  шаг 1 — поле email + «Отправить код» (`forgotPassword`) → подсказка «Если аккаунт привязан к
  Telegram, код отправлен в бот»; шаг 2 — поля код + новый пароль (мин. 8) + «Сбросить»
  (`resetPassword`) → успех: возврат на `accForm("Пароль сброшен, войдите.")`. Клиентская проверка
  пароля ≥ 8. Переиспользуем классы `.acc`/`.err`/`.btns`.

## Безопасность

- Enumeration: `forgot` всегда `{ ok: true }`, одинаковый ответ для любого email.
- Перебор кода: 8 симв. из 31-символьного алфавита (~31^8 ≈ 8.5e11) + TTL 30 мин + одноразовость +
  Throttle 5/60s на auth-роутах. Достаточно для MVP.
- В БД — sha256, не плейн. Reset-поля наружу не отдаются.
- Blocked-юзер может сбросить пароль, но залогиниться всё равно не сможет (blocked-гейт в login) — ок.

## Тесты

`backend/src/auth/auth.service.spec.ts` (мок `userModel` + мок `telegram` с `sendMessageTo: jest.fn`):
- `genResetCode`: длина 8, только символы алфавита (несколько вызовов).
- `forgot`: привязанный Telegram → пишет hash+expiry, зовёт `sendMessageTo`, возврат `{ok:true}`.
- `forgot`: нет юзера / нет chatId → `sendMessageTo` НЕ зван, всё равно `{ok:true}`.
- `reset`: валидный код (hash совпал, не истёк) → `passwordHash` сменён, reset-поля очищены, `{ok:true}`.
- `reset`: неизвестный код → `BadRequestException`.
- `reset`: истёкший код (`expires < now`) → `BadRequestException`.

`api.js`/`popup.js` — I/O-glue, юнит-тестами не покрываются (конвенция репозитория); ручная проверка
на загруженном расширении + curl-проверка эндпоинтов на проде (бот настроен).

## Деплой / env

Новых env нет (бот уже настроен: `TELEGRAM_BOT_TOKEN`). Колонки — идемпотентный ALTER на старте.

## Границы (YAGNI)

- Только Telegram-доставка (email-провайдер — отдельная будущая задача).
- Без «магической ссылки» (код вводится вручную — у нас нет веб-страницы сброса; попап — клиент).
- Без админ-сброса чужого пароля (отдельная фича, если понадобится).
- Bump расширения + CHANGELOG — в рамках реализации (user-facing изменение попапа).
