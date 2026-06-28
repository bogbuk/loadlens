# Дизайн: инвалидация сессий через tokenVersion

Date: 2026-06-28
Status: approved

## Цель

Смена пароля (`changePassword`), сброс пароля (`reset`) и блокировка (`block`) должны
**немедленно** убивать все ранее выпущенные JWT-сессии пользователя. Сейчас access-токен
(15 мин) и refresh (7 дн) переживают эти операции — реальная дыра: при угоне доступа смена
пароля не выкидывает злоумышленника.

## Механизм

Колонка `User.tokenVersion` (INTEGER, default 0). При выпуске токенов в claims (access **и**
refresh) кладём `tv = user.tokenVersion`. Операция, которая должна «выкинуть всех», инкрементит
`tokenVersion`; проверка `tv` при каждом запросе и при refresh отсекает старые токены.

**Решения (подтверждены):**
- **A:** смена своего пароля инвалидирует и текущую сессию (после смены — перелогин). Не переиздаём
  токены вызывающему.
- **B:** блокировка становится немедленной — `JwtAuthGuard` отдаёт 403 заблокированному на каждом
  запросе (раньше только login/refresh, ≤15 мин).

## 1. Модель `User`

Колонка `tokenVersion: number` (`DataType.INTEGER`, `allowNull:false`, `defaultValue:0`,
`field: 'token_version'`). Идемпотентный ALTER в `backend/src/main.ts`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
```

## 2. Выпуск токенов с `tv`

`AuthService.tokens` меняет сигнатуру с `tokens(userId: string)` на `tokens(user: User)` и кладёт
`tv` в оба токена:
```typescript
private async tokens(user: User) {
  const payload = { sub: user.id, tv: user.tokenVersion };
  return {
    accessToken: await this.jwt.signAsync({ ...payload, type: 'access' }, { expiresIn: ACCESS_TTL }),
    refreshToken: await this.jwt.signAsync({ ...payload, type: 'refresh' }, { expiresIn: REFRESH_TTL }),
  };
}
```
Вызовы `this.tokens(user.id)` → `this.tokens(user)` в `register`/`login`/`refresh` (везде объект
`user` уже на руках).

## 3. `JwtAuthGuard` — проверка tv + blocked (stateful)

`backend/src/auth/jwt-auth.guard.ts` инжектит `User` (`@InjectModel(User)`). После verify:
- payload теперь `{ sub, type, tv }`.
- грузим `user = findByPk(payload.sub)`; нет → `UnauthorizedException`.
- `(payload.tv ?? 0) !== user.tokenVersion` → `UnauthorizedException('сессия недействительна')`.
- `user.blocked` → `ForbiddenException('аккаунт заблокирован')`.
- `req.user = { userId: user.id }`.

Это +1 чтение БД на каждый авторизованный запрос (для текущего масштаба приемлемо; guard становится
stateful — осознанно). Все 4 модуля, провайдящие `JwtAuthGuard` (auth/users/drivers/telegram), уже
имеют `User` в инжекторе — DI резолвится.

`AdminRoleGuard` не трогаем (он и так грузит User после JwtAuthGuard; tv/blocked уже проверены guard'ом
до него).

## 4. `refresh` — сверка tv

В `AuthService.refresh` после `findByPk` (и проверки `blocked`, которая уже есть) добавить:
```typescript
if ((payload.tv ?? 0) !== user.tokenVersion)
  throw new UnauthorizedException('сессия недействительна');
```
(тип payload в refresh расширяется до `{ sub, type, tv }`.)

## 5. Бамп `tokenVersion`

- `UsersService.changePassword`: перед/при сохранении `user.tokenVersion = (user.tokenVersion ?? 0) + 1`.
- `AuthService.reset`: то же — `user.tokenVersion = (user.tokenVersion ?? 0) + 1` (рядом с очисткой reset-полей).
- Блокировка (`AdminService.setBlocked`) `tokenVersion` НЕ бампит — для blocked немедленность даёт сам
  guard (пункт 3); анблок не должен «случайно» инвалидировать ничего.

## 6. Фронт (попап)

`extension/popup.js`: после успешной `LLAPI.changePassword(...)` текущая сессия мертва → вместо
«Пароль изменён» в той же форме делаем `await LLAPI.logout()` и `accForm("Пароль изменён, войдите снова.")`.
(`reset` уже ведёт на `accForm`.) Bump `manifest.json` + CHANGELOG.

## Совместимость

- Старые токены без `tv` → `payload.tv ?? 0 = 0 = default tokenVersion` → остаются валидны: форс-логаута
  на деплое нет (кроме тех, у кого tokenVersion уже > 0, чего пока нет).

## Тесты

- `jwt-auth.guard.spec.ts` (новый или расширить): mock `userModel` + `JwtService`.
  - валидный токен, tv совпадает, не blocked → `true`;
  - `tv` не совпадает → `UnauthorizedException`;
  - `blocked` → `ForbiddenException`;
  - юзера нет → `UnauthorizedException`;
  - токен без `tv` при `tokenVersion=0` → проходит (обратная совместимость).
- `auth.service.spec.ts`: refresh со старым `tv` → `UnauthorizedException`; `reset` инкрементит
  `tokenVersion`; login выдаёт токен с текущим `tv` (можно проверить декодом).
- `users.service.spec.ts`: `changePassword` инкрементит `tokenVersion`.

## Границы (YAGNI)

- Без «список активных сессий / выйти на конкретном устройстве» (только глобальная инвалидация).
- Без Redis/денежной деноминации — `tokenVersion` в той же строке users.
- Блокировку через tokenVersion не дублируем (guard покрывает).
