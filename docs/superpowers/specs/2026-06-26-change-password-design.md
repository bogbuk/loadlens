# Дизайн: эндпоинт смены пароля (самообслуживание)

Date: 2026-06-26
Status: approved

## Цель

Дать залогиненному пользователю сменить свой пароль через API. Только бэкенд-эндпоинт,
без UI. Самообслуживание (текущий пароль + новый), без админ-сброса чужих паролей.

## Эндпоинт

`PATCH /api/v1/users/me/password` — под `JwtAuthGuard` (уже висит на `UsersController`).

Body (`ChangePasswordDto`, `backend/src/users/dto/change-password.dto.ts`):
- `currentPassword: string` — `@IsString @MinLength(8) @MaxLength(128)`
- `newPassword: string` — `@IsString @MinLength(8) @MaxLength(128)`

(совпадает с правилами пароля в `CredentialsDto`).

Ответ: `{ ok: true }`.

## Логика — новый `UsersService`

Сейчас `UsersController` сам дёргает модель (`deleteMe`). bcrypt живёт в `AuthService`
(другой модуль) — переиспользовать его нельзя без цикла (`AuthModule` уже импортит `UsersModule`).
Поэтому заводим маленький `UsersService` (`backend/src/users/users.service.ts`), переносим в него
`deleteMe` и добавляем `changePassword`. Контроллер становится тонким делегатом (как
`AdminController`→`AdminService`). `UsersService` инжектит модель `User` (уже в `UsersModule` через
`forFeature`), импорт `bcryptjs` как в `auth.service`.

`changePassword(userId, currentPassword, newPassword)`:
1. `findByPk(userId)` → нет → `UnauthorizedException('пользователь не найден')` (под guard не случится).
2. `bcrypt.compare(currentPassword, passwordHash)` ложь → `BadRequestException('неверный текущий пароль')`.
3. `newPassword === currentPassword` → `BadRequestException('новый пароль совпадает со старым')`.
4. `passwordHash = bcrypt.hash(newPassword, 10)` → `user.save()`.
5. Возврат `{ ok: true }`.

`deleteMe(userId)`: `this.userModel.destroy({ where: { id: userId } })` → `{ ok: true }`
(перенос из контроллера без изменения поведения).

`UsersModule`: добавить `UsersService` в `providers`.

## Безопасность / границы

- PII: пароль/хеш наружу не отдаются (ответ — только `{ ok: true }`).
- JWT stateless: уже выданный access-токен (≤15 мин) после смены остаётся валидным —
  ревокации нет (YAGNI для MVP). Refresh-токены тоже не инвалидируются.
- Email-нормализация не нужна (работаем по `userId` из токена).

## Тесты (`backend/src/users/users.service.spec.ts`)

Мок `userModel` как в `auth.service.spec.ts` (объекты с `save: jest.fn`, `findByPk`, `destroy`).
- `changePassword`: неверный текущий пароль → `BadRequestException`.
- `changePassword`: новый совпадает со старым → `BadRequestException`.
- `changePassword`: успех → `passwordHash` изменился (не равен старому, не равен сырому паролю),
  возврат `{ ok: true }`, `save` вызван.
- `deleteMe`: вызывает `destroy` с `where: { id: userId }`, возвращает `{ ok: true }`.

## Вне scope (YAGNI)

- UI (форма в admin.html / popup).
- Админ-сброс чужого пароля (`PATCH /admin/users/:email/password`).
- Ревокация/версионирование токенов после смены пароля.
