# Session Invalidation (tokenVersion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Смена пароля, сброс пароля и блокировка немедленно инвалидируют все ранее выпущенные JWT-сессии пользователя.

**Architecture:** Колонка `User.tokenVersion`; токены несут `tv`. `JwtAuthGuard` на каждом запросе грузит User и сверяет `tv` + проверяет `blocked` (становится stateful). `refresh` тоже сверяет `tv`. `changePassword`/`reset` инкрементят `tokenVersion`, что убивает все сессии (включая текущую). Блокировка немедленна за счёт проверки в guard.

**Tech Stack:** NestJS 10, Sequelize (Postgres, `synchronize:true`), `@nestjs/jwt`, bcryptjs, Jest; расширение — vanilla JS, `node --test`.

## Global Constraints

- Новые колонки — только идемпотентный `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `main.ts`.
- Обратная совместимость: токен без `tv` трактуется как `tv = 0` (= дефолту `tokenVersion`), чтобы не было форс-логаута на деплое.
- Бэкенд под `/api/v1`; DTO/guard-сообщения и комментарии — на русском.
- Блокировка через `tokenVersion` НЕ дублируется (guard покрывает); `setBlocked` остаётся как есть.
- Коммиты — БЕЗ упоминаний AI/Claude.
- Бэкенд-тесты: `cd backend && npm test`. Extension-тесты: `npm test` (корень).

---

### Task 1: Колонка `tokenVersion` + `tv` в токенах + сверка `tv` в refresh

**Files:**
- Modify: `backend/src/users/user.model.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Produces: `User.tokenVersion: number` (default 0).
- Produces: токены (access+refresh) содержат claim `tv`.
- Produces: `refresh` бросает `UnauthorizedException` при несовпадении `tv`.

- [ ] **Step 1: Добавить колонку в модель**

Modify `backend/src/users/user.model.ts` — добавить после `passwordResetExpires`:
```typescript
  // Версия сессий: инкремент инвалидирует все ранее выпущенные токены (смена/сброс пароля).
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'token_version' })
  tokenVersion: number;
```

- [ ] **Step 2: Идемпотентный ALTER в `main.ts`**

Modify `backend/src/main.ts` — после ALTER для `password_reset_*` добавить:
```typescript
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0');
```

- [ ] **Step 3: Написать падающие тесты (tv в токене + refresh-сверка)**

Modify `backend/src/auth/auth.service.spec.ts`:

(a) В `beforeEach` в `create`-моке добавить `tokenVersion: 0` в создаваемый объект — найти строку:
```typescript
          telegramChatId: null, passwordResetTokenHash: null, passwordResetExpires: null,
```
и заменить на:
```typescript
          telegramChatId: null, passwordResetTokenHash: null, passwordResetExpires: null, tokenVersion: 0,
```

(b) Добавить тесты в конец `describe('AuthService', ...)`:
```typescript
  it('login: access-токен несёт tv текущей версии', async () => {
    await service.register('a@b.md', 'password1');
    const { accessToken } = await service.login('a@b.md', 'password1');
    expect(jwt.verify(accessToken)).toMatchObject({ type: 'access', tv: 0 });
  });

  it('refresh: устаревший tv → UnauthorizedException', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1');
    users['a@b.md'].tokenVersion = 1;          // версия выросла после выпуска токена
    await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: совпадающий tv → новая пара токенов', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1');
    const res = await service.refresh(refreshToken);
    expect(res.accessToken).toBeTruthy();
  });
```

- [ ] **Step 4: Запустить — убедиться, что падает**

Run: `cd backend && npx jest auth.service`
Expected: FAIL — `tv` отсутствует в токене / refresh не отклоняет устаревший tv.

- [ ] **Step 5: Реализовать в `auth.service.ts`**

(a) Заменить метод `tokens`:
```typescript
  private async tokens(user: User) {
    const base = { sub: user.id, tv: user.tokenVersion };
    return {
      accessToken: await this.jwt.signAsync({ ...base, type: 'access' }, { expiresIn: ACCESS_TTL }),
      refreshToken: await this.jwt.signAsync({ ...base, type: 'refresh' }, { expiresIn: REFRESH_TTL }),
    };
  }
```

(b) Заменить три вызова `this.tokens(user.id)` на `this.tokens(user)` (в `register`, `login`, `refresh` — строки с `return { ...(await this.tokens(user.id)), user: this.publicUser(user) };`).

(c) В `refresh` расширить тип payload и добавить сверку `tv` после проверки `blocked`:
```typescript
  async refresh(refreshToken: string) {
    let payload: { sub: string; type: string; tv?: number };
    try { payload = await this.jwt.verifyAsync(refreshToken); }
    catch { throw new UnauthorizedException('невалидный refresh-токен'); }
    if (payload.type !== 'refresh') throw new UnauthorizedException('ожидался refresh-токен');
    const user = await this.userModel.findByPk(payload.sub);
    if (!user) throw new UnauthorizedException('пользователь не найден');
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException('сессия недействительна');
    return { ...(await this.tokens(user)), user: this.publicUser(user) };
  }
```

- [ ] **Step 6: Запустить — зелёный + сборка**

Run: `cd backend && npx jest auth.service && npm run build && npm test`
Expected: PASS (включая 3 новых); build OK; полный набор зелёный.

- [ ] **Step 7: Commit**

```bash
git add backend/src/users/user.model.ts backend/src/main.ts backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): tokenVersion в User + tv в JWT + сверка tv в refresh"
```

---

### Task 2: `JwtAuthGuard` — сверка `tv` + немедленная блокировка

**Files:**
- Modify: `backend/src/auth/jwt-auth.guard.ts`
- Test: `backend/src/auth/jwt-auth.guard.spec.ts`

**Interfaces:**
- Consumes: `User.tokenVersion`, `User.blocked`; claim `tv` в access-токене (Task 1).
- Produces: `JwtAuthGuard` грузит User и отклоняет: нет юзера/несовпадение tv → 401; blocked → 403.

- [ ] **Step 1: Написать падающий тест**

Create `backend/src/auth/jwt-auth.guard.spec.ts`:
```typescript
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

const jwt = new JwtService({ secret: 'test-secret' });
const ctx = (token?: string): any => ({
  switchToHttp: () => ({ getRequest: () => ({ headers: token ? { authorization: 'Bearer ' + token } : {} }) }),
});
const make = (user: any) =>
  new JwtAuthGuard(jwt, { findByPk: jest.fn(() => Promise.resolve(user)) } as any);

describe('JwtAuthGuard', () => {
  it('валидный access, tv совпадает, не blocked → true', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 2 });
    await expect(make({ id: 'u1', tokenVersion: 2, blocked: false }).canActivate(ctx(t))).resolves.toBe(true);
  });

  it('tv не совпадает → 401', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 1 });
    await expect(make({ id: 'u1', tokenVersion: 2, blocked: false }).canActivate(ctx(t))).rejects.toThrow(UnauthorizedException);
  });

  it('blocked → 403', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 0 });
    await expect(make({ id: 'u1', tokenVersion: 0, blocked: true }).canActivate(ctx(t))).rejects.toThrow(ForbiddenException);
  });

  it('юзера нет → 401', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 0 });
    await expect(make(null).canActivate(ctx(t))).rejects.toThrow(UnauthorizedException);
  });

  it('токен без tv при tokenVersion=0 → проходит (обратная совместимость)', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access' });
    await expect(make({ id: 'u1', tokenVersion: 0, blocked: false }).canActivate(ctx(t))).resolves.toBe(true);
  });

  it('refresh-токен не принимается → 401', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'refresh', tv: 0 });
    await expect(make({ id: 'u1', tokenVersion: 0, blocked: false }).canActivate(ctx(t))).rejects.toThrow(UnauthorizedException);
  });

  it('нет Bearer-токена → 401', async () => {
    await expect(make({ id: 'u1', tokenVersion: 0 }).canActivate(ctx(undefined))).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest jwt-auth.guard`
Expected: FAIL — конструктор guard принимает 1 аргумент / нет проверок tv/blocked.

- [ ] **Step 3: Реализовать guard**

Replace `backend/src/auth/jwt-auth.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/user.model';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('нет Bearer-токена');
    let payload: { sub: string; type: string; tv?: number };
    try { payload = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('невалидный токен'); }
    if (payload.type !== 'access') throw new UnauthorizedException('ожидался access-токен');
    // Stateful: грузим User для сверки версии сессии и статуса блокировки.
    const user = await this.userModel.findByPk(payload.sub);
    if (!user) throw new UnauthorizedException('пользователь не найден');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException('сессия недействительна');
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
    req.user = { userId: user.id };
    return true;
  }
}
```

- [ ] **Step 4: Запустить — зелёный + сборка**

Run: `cd backend && npx jest jwt-auth.guard && npm run build && npm test`
Expected: PASS (7 тестов guard); build OK (DI резолвится — все модули с JwtAuthGuard имеют User); полный набор зелёный.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/jwt-auth.guard.ts backend/src/auth/jwt-auth.guard.spec.ts
git commit -m "feat(auth): JwtAuthGuard сверяет tv и отклоняет blocked (немедленная инвалидация)"
```

---

### Task 3: Инкремент `tokenVersion` при смене и сбросе пароля

**Files:**
- Modify: `backend/src/users/users.service.ts`
- Test: `backend/src/users/users.service.spec.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `User.tokenVersion` (Task 1).
- Produces: `changePassword` и `reset` увеличивают `tokenVersion` на 1.

- [ ] **Step 1: Тест на бамп в `changePassword`**

Modify `backend/src/users/users.service.spec.ts`:

(a) В `beforeEach` объект `user` дополнить `tokenVersion: 0` — найти:
```typescript
    user = {
      id: 'u1',
      passwordHash: await bcrypt.hash('old-password', 10),
      save: jest.fn(function (this: any) { return Promise.resolve(this); }),
    };
```
заменить на:
```typescript
    user = {
      id: 'u1',
      passwordHash: await bcrypt.hash('old-password', 10),
      tokenVersion: 0,
      save: jest.fn(function (this: any) { return Promise.resolve(this); }),
    };
```

(b) Добавить тест (в `describe('UsersService', ...)`):
```typescript
  it('changePassword: инкрементит tokenVersion (инвалидация сессий)', async () => {
    await service.changePassword('u1', 'old-password', 'new-password');
    expect(user.tokenVersion).toBe(1);
  });
```

- [ ] **Step 2: Тест на бамп в `reset`**

Modify `backend/src/auth/auth.service.spec.ts` — в тест `reset: валидный код → меняет пароль, чистит reset-поля` добавить ассерт. Найти тело этого теста и после строки, проверяющей очистку `passwordResetExpires`, добавить:
```typescript
    expect(users['a@b.md'].tokenVersion).toBe(1);
```
(объект уже имеет `tokenVersion: 0` из create-мока, см. Task 1 Step 3a.)

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `cd backend && npx jest users.service auth.service`
Expected: FAIL — `tokenVersion` остаётся 0.

- [ ] **Step 4: Реализовать инкремент**

(a) Modify `backend/src/users/users.service.ts` — в `changePassword`, перед `await user.save();`, добавить:
```typescript
    user.tokenVersion = (user.tokenVersion ?? 0) + 1; // инвалидируем все сессии (включая текущую)
```

(b) Modify `backend/src/auth/auth.service.ts` — в `reset`, перед `await user.save();` (после `user.passwordResetExpires = null;`), добавить:
```typescript
    user.tokenVersion = (user.tokenVersion ?? 0) + 1; // инвалидируем все сессии
```

- [ ] **Step 5: Запустить — зелёный + сборка**

Run: `cd backend && npx jest users.service auth.service && npm run build && npm test`
Expected: PASS (новые ассерты); build OK; полный набор зелёный.

- [ ] **Step 6: Commit**

```bash
git add backend/src/users/users.service.ts backend/src/users/users.service.spec.ts backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): changePassword/reset инкрементят tokenVersion (инвалидация сессий)"
```

---

### Task 4: Попап — логаут после смены пароля + bump расширения

**Files:**
- Modify: `extension/popup.js`
- Modify: `extension/manifest.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `LLAPI.changePassword`, `LLAPI.logout` (уже есть).

- [ ] **Step 1: Логаут после успешной смены пароля**

Modify `extension/popup.js` — в функции `pwdForm`, в обработчике `acc-pwd-save`, заменить блок успеха. Найти:
```javascript
    try {
      await LLAPI.changePassword(cur, neu);
      box.dataset.open = "0";
      box.innerHTML = '<div class="note">Пароль изменён.</div>';
    } catch (e) { err.textContent = e.message; }
```
заменить на:
```javascript
    try {
      await LLAPI.changePassword(cur, neu);
      // Смена пароля инвалидирует все сессии (включая текущую) — выходим и просим войти заново.
      await LLAPI.logout();
      accForm("Пароль изменён, войдите снова.");
      renderFleet(null); renderTelegram(null);
    } catch (e) { err.textContent = e.message; }
```

- [ ] **Step 2: Проверить синтаксис и тесты**

Run:
```bash
cd /Users/bogdan/work/startup/dat.com
node --check extension/popup.js && npm test
```
Expected: `--check` без ошибок; `npm test` (node --test) — все PASS.

- [ ] **Step 3: Bump версии + CHANGELOG**

Modify `extension/manifest.json` — `"version": "0.3.3"` → `"version": "0.3.4"`.

Modify `CHANGELOG.md` — добавить под строкой `All notable user-facing changes...`:
```markdown
## 0.3.4 — 2026-06-28

### Changed
- **Changing your password now signs you out everywhere.** After a successful password change you're returned to the sign-in screen and must log in again with the new password — old sessions on other devices stop working immediately.
```

- [ ] **Step 4: Commit**

```bash
git add extension/popup.js extension/manifest.json CHANGELOG.md
git commit -m "feat(popup): логаут после смены пароля (сессии инвалидируются) + bump 0.3.4"
```

---

## Self-Review

**Spec coverage:**
- `tokenVersion` колонка + ALTER → Task 1 ✓
- `tv` в access+refresh (`tokens(user)`) → Task 1 ✓
- refresh сверяет tv → Task 1 ✓
- JwtAuthGuard сверяет tv + blocked (stateful) → Task 2 ✓
- changePassword + reset инкрементят tokenVersion → Task 3 ✓
- блокировка немедленна (через guard), tokenVersion не бампим на block → Task 2 (guard) + не трогаем setBlocked ✓
- фронт: логаут после changePassword + bump/CHANGELOG → Task 4 ✓
- обратная совместимость `tv ?? 0` → Task 1 (refresh) + Task 2 (guard) ✓
- тесты guard/refresh/changePassword/reset → Tasks 1,2,3 ✓

**Placeholder scan:** код во всех шагах полный, плейсхолдеров нет.

**Type consistency:** `tokenVersion: number` (Task 1) используется в guard (Task 2), reset/changePassword (Task 3), мок-объектах тестов. Claim `tv` пишется в `tokens` (Task 1) и читается в guard (Task 2) и refresh (Task 1) одинаково (`payload.tv ?? 0`). `tokens(user)` сигнатура согласована с тремя вызовами. `JwtAuthGuard(jwt, userModel)` конструктор (Task 2) совпадает с инстанцированием в guard-спеке (`new JwtAuthGuard(jwt, {...})`).

**Note:** `JwtAuthGuard` становится stateful (+1 чтение БД на авторизованный запрос). Осознанно (спека), для текущего масштаба приемлемо. Все 4 модуля, провайдящие guard (auth/users/drivers/telegram), уже имеют `User` в инжекторе — проверено.
