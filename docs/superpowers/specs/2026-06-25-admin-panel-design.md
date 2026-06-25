# Дизайн: минимальная админ-панель LoadLens

Date: 2026-06-25
Status: approved

## Цель

Минимальная админ-панель для управления пользователями LoadLens: список юзеров,
смена плана free/pro, базовые метрики платформы, блокировка пользователей.
Стиль — как у существующей кодовой базы: vanilla-страница (как `backend/public/index.html`)
+ NestJS-эндпоинты в стиле остальных модулей. Без фреймворков и сборки на фронте.

## Решения (из брейншторма)

- **Функционал**: список пользователей, смена плана free/pro, метрики платформы, блокировка.
- **Доступ**: JWT + админ-роль у пользователя (обычный логин email/пароль).
- **Назначение роли**: `ADMIN_EMAIL` в env (список через запятую).
- **Старый `x-admin-key`** (`AdminGuard` + `ADMIN_KEY`): **удаляется** — остаётся одна схема (JWT-роль).

## 1. Модель данных — 2 новых поля в `User`

`backend/src/users/user.model.ts`:
- `role: 'user' | 'admin'` — `DataType.TEXT`, `allowNull:false`, `defaultValue:'user'`
  (ENUM не берём: идемпотентный `ALTER` для ENUM в Postgres неудобен; значение валидируем в коде).
- `blocked: boolean` — `DataType.BOOLEAN`, `allowNull:false`, `defaultValue:false`.

В `backend/src/main.ts` (synchronize не меняет существующие таблицы) — идемпотентные ALTER
рядом с telegram-колонками:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false;
```

## 2. Бутстрап админа (`ADMIN_EMAIL`)

- `ADMIN_EMAIL` — список email через запятую. Хелпер `adminEmails()` нормализует (trim+lowercase, фильтр пустых).
- На старте приложения (в `main.ts`, после ALTER): `UPDATE users SET role='admin' WHERE email IN (...)`
  — идемпотентно; если список пуст, ничего не делаем.
- В `auth.service.login()`: если `email ∈ ADMIN_EMAIL` и `user.role !== 'admin'` — апгрейдим роль
  и сохраняем (покрывает «зарегистрировался уже после старта приложения»).

## 3. Блокировка (enforcement)

- В `auth.service.login()` и `auth.service.refresh()`: если `user.blocked` →
  `ForbiddenException('аккаунт заблокирован')`.
- Существующий access-токен (15 мин) доживает максимум 15 мин — для MVP приемлемо;
  БД на каждом запросе в `JwtAuthGuard` не грузим.

## 4. Бэкенд: guard + контроллер

### `AdminRoleGuard` (`backend/src/auth/admin-role.guard.ts`)
- Ставится **после** `JwtAuthGuard` (тот уже положил `req.user.userId`).
- Грузит `User.findByPk(userId)`, требует `role === 'admin'`, иначе `ForbiddenException`.
- Spec по аналогу `admin.guard.spec.ts`.

### `admin.controller.ts` + `admin.service.ts` (новый `admin.module.ts` или в составе auth)
Все эндпоинты под `@UseGuards(JwtAuthGuard, AdminRoleGuard)`:

- `GET /admin/users?q=` → массив:
  `{ email, plan, role, blocked, telegramLinked: boolean, alertsEnabled, createdAt }`.
  Поиск по подстроке email (ILIKE / fallback). **Без** `passwordHash`. Сортировка по `createdAt DESC`.
- `GET /admin/stats` → `{ users, proUsers, blockedUsers, loads, lanes, markets, medianRpm }`.
  `users/proUsers/blockedUsers` — `COUNT` по `users`; `loads/lanes/markets/medianRpm` —
  переиспользуем `LanesService.overview()`.
- `PATCH /admin/users/:email/plan` body `{ plan: 'free'|'pro' }` — **переносим** существующую
  логику со старого `x-admin-key`-гарда на JWT-admin. Возвращает `{ email, plan }`.
- `PATCH /admin/users/:email/block` body `{ blocked: boolean }` — ставит `blocked`.
  Возвращает `{ email, blocked }`. (Опц. защита: нельзя заблокировать самого себя / админа — добавим
  проверку «нельзя блокировать пользователя с role==='admin'».)

### Удаление старого
- Удалить `backend/src/auth/admin.controller.ts` (старый, x-admin-key) и `admin.guard.ts` + `admin.guard.spec.ts`.
- Убрать `ADMIN_KEY` из проверок; обновить регистрацию контроллеров/провайдеров в модуле.
- Обновить `CLAUDE.md` (раздел про `PATCH /admin/users/:email/plan` и env) — поменять `ADMIN_KEY` → `ADMIN_EMAIL`.

## 5. Фронтенд: `backend/public/admin.html`

Одностраничная vanilla-страница (inline-стиль как `index.html`), отдаётся существующим
`ServeStaticModule` по `/admin.html`. Без сборки.

- **Экран логина**: email + пароль → `POST /api/v1/auth/login`. `accessToken`/`refreshToken` в `localStorage`.
  Не-админ → admin-вызовы дают 403 → показываем «нет прав администратора», кнопка «выйти».
- **После логина**:
  - Ряд карточек-метрик (`GET /admin/stats`): пользователей / из них Pro / заблокировано /
    грузов(7д) / lane / рынков / медиана RPM.
  - Поле поиска по email → `GET /admin/users?q=`.
  - Таблица юзеров: email, бейдж роли, план + кнопка-переключатель `free⇄pro`,
    статус active/blocked + кнопка block/unblock, telegram (✓/—), дата.
- **Авторизация запросов**: `Authorization: Bearer <accessToken>`. На `401` — одна попытка
  `POST /api/v1/auth/refresh` с `refreshToken`; при неуспехе — чистим токены, обратно на логин.
- Кнопка «выйти» (чистит `localStorage`).

## 6. Тесты

- `admin-role.guard.spec.ts` — пропускает admin, 403 для user/без юзера.
- `admin.service.spec.ts` (или контроллер) — список (без passwordHash, поиск по email),
  смена плана, блокировка, нельзя заблокировать админа.
- `auth.service.spec.ts` — login апгрейдит роль при email ∈ ADMIN_EMAIL; `blocked` юзер → 403 на login и refresh.

## 7. Деплой / env

- Новая env-переменная `ADMIN_EMAIL` (список через запятую). Прописать в Coolify-env.
- `ADMIN_KEY` — удалить из env и из CLAUDE.md.
- Колонки добавляются идемпотентным ALTER на старте — отдельных миграций нет (MVP, `synchronize:true`).

## Вне scope (YAGNI)

- Пагинация списка юзеров (пока мало пользователей; поиск по email достаточно).
- Редактирование профиля водителей/грузов из админки.
- Аудит-лог действий админа.
- Хард-делит юзера из админки (есть `DELETE /users/me` для самого юзера; блокировка покрывает модерацию).
