# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Минимальная админ-панель LoadLens: список пользователей, смена плана free/pro, метрики платформы, блокировка пользователей — за JWT + админ-ролью.

**Architecture:** Бэкенд — NestJS: новые поля `role`/`blocked` в `User`, JWT-роль (`AdminRoleGuard` поверх `JwtAuthGuard`), новый `AdminService`/`AdminController` под префиксом `admin/*`. Старый `x-admin-key` (`AdminGuard`+`ADMIN_KEY`) удаляется. Фронт — одностраничный vanilla `backend/public/admin.html`, отдаётся существующим `ServeStaticModule` по `/admin.html`.

**Tech Stack:** NestJS 10, Sequelize (Postgres, `synchronize:true`), `@nestjs/jwt`, class-validator, Jest. Фронт без сборки (vanilla HTML/JS).

## Global Constraints

- Бэкенд под `/api/v1` (глобальный префикс), `ValidationPipe({ whitelist: true, transform: true })` — DTO обязательны.
- Новые колонки — только идемпотентный `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `main.ts` (synchronize не меняет существующие таблицы).
- PII: `passwordHash` НИКОГДА не отдаётся наружу.
- Все строки в коде/ответах/комментариях — на русском, как в кодовой базе.
- Тесты бэкенда: `cd backend && npm test`. Коммиты — без упоминаний AI/Claude.
- Email везде нормализуется `trim().toLowerCase()`.
- `role` хранится как `TEXT` (не ENUM), допустимые значения `'user' | 'admin'`.

---

### Task 1: Хелпер `parseAdminEmails` + поля `role`/`blocked` в модели + bootstrap в `main.ts`

**Files:**
- Create: `backend/src/auth/admin-emails.ts`
- Test: `backend/src/auth/admin-emails.spec.ts`
- Modify: `backend/src/users/user.model.ts` (добавить 2 колонки)
- Modify: `backend/src/main.ts` (ALTER + bootstrap UPDATE)

**Interfaces:**
- Produces: `parseAdminEmails(raw?: string | null): string[]` — нормализованный (trim+lowercase), без пустых, уникальный список email из строки через запятую.
- Produces (model): `User.role: 'user' | 'admin'`, `User.blocked: boolean`.

- [ ] **Step 1: Написать падающий тест хелпера**

Create `backend/src/auth/admin-emails.spec.ts`:
```typescript
import { parseAdminEmails } from './admin-emails';

describe('parseAdminEmails', () => {
  it('пусто/undefined -> []', () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails('')).toEqual([]);
    expect(parseAdminEmails('  ,  ,')).toEqual([]);
  });

  it('разбивает по запятой, trim + lowercase, убирает дубли', () => {
    expect(parseAdminEmails(' A@B.md , a@b.md ,Boss@X.io')).toEqual(['a@b.md', 'boss@x.io']);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd backend && npx jest admin-emails -t parseAdminEmails`
Expected: FAIL — `Cannot find module './admin-emails'`.

- [ ] **Step 3: Реализовать хелпер**

Create `backend/src/auth/admin-emails.ts`:
```typescript
// Список админских email из env ADMIN_EMAIL (через запятую): trim + lowercase, без пустых и дублей.
export function parseAdminEmails(raw?: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}
```

- [ ] **Step 4: Запустить тест — зелёный**

Run: `cd backend && npx jest admin-emails`
Expected: PASS (2 теста).

- [ ] **Step 5: Добавить колонки в модель**

Modify `backend/src/users/user.model.ts` — добавить после поля `plan`:
```typescript
  // Роль: 'user' (по умолчанию) | 'admin'. Назначается из ADMIN_EMAIL (bootstrap + апгрейд на login).
  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'user' })
  role: 'user' | 'admin';

  // Блокировка: заблокированный юзер не может логиниться/рефрешиться.
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  blocked: boolean;
```

- [ ] **Step 6: Идемпотентные ALTER + bootstrap в `main.ts`**

Modify `backend/src/main.ts` — после блока telegram-ALTER (после строки с `alerts_enabled`), добавить:
```typescript
  await sequelize.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false');
  // Bootstrap админов из ADMIN_EMAIL (идемпотентно): уже существующие юзеры получают role=admin.
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAIL);
  if (adminEmails.length)
    await sequelize.query("UPDATE users SET role='admin' WHERE email IN (:emails)", {
      replacements: { emails: adminEmails },
    });
```
И добавить импорт в начало `main.ts`:
```typescript
import { parseAdminEmails } from './auth/admin-emails';
```

- [ ] **Step 7: Собрать и прогнать тесты**

Run: `cd backend && npm run build && npm test`
Expected: build OK, все существующие тесты PASS + новые `parseAdminEmails`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth/admin-emails.ts backend/src/auth/admin-emails.spec.ts backend/src/users/user.model.ts backend/src/main.ts
git commit -m "feat(admin): поля role/blocked в User + bootstrap админов из ADMIN_EMAIL"
```

---

### Task 2: `auth.service` — апгрейд роли на login + запрет блокированным (login/refresh)

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `parseAdminEmails` (Task 1).
- Produces: `login`/`refresh` бросают `ForbiddenException('аккаунт заблокирован')` для `blocked` юзеров; `login` ставит `role='admin'`, если email ∈ ADMIN_EMAIL.

- [ ] **Step 1: Дополнить тесты в `auth.service.spec.ts`**

Сначала расширить мок `userModel` в `beforeEach` — добавить `update` и сохранять `role/blocked` в объекте. Заменить блок `const userModel: any = {...}` на:
```typescript
    const userModel: any = {
      findOne: jest.fn(({ where: { email } }) => Promise.resolve(users[email] ?? null)),
      create: jest.fn((data) => {
        if (users[data.email]) return Promise.reject(new Error('unique'));
        users[data.email] = { id: 'u-' + data.email, plan: 'free', role: 'user', blocked: false, ...data };
        return Promise.resolve(users[data.email]);
      }),
      findByPk: jest.fn((id) =>
        Promise.resolve(Object.values(users).find((u: any) => u.id === id) ?? null)),
      update: jest.fn((vals, { where: { email } }) => {
        if (users[email]) Object.assign(users[email], vals);
        return Promise.resolve([1]);
      }),
    };
```
Добавить импорт `ForbiddenException`:
```typescript
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
```
И новые тесты (в конце `describe`):
```typescript
  it('login: email из ADMIN_EMAIL -> апгрейд role=admin', async () => {
    process.env.ADMIN_EMAIL = 'a@b.md';
    await service.register('a@b.md', 'password1');
    await service.login('a@b.md', 'password1');
    expect(users['a@b.md'].role).toBe('admin');
    delete process.env.ADMIN_EMAIL;
  });

  it('login: blocked юзер -> ForbiddenException', async () => {
    await service.register('a@b.md', 'password1');
    users['a@b.md'].blocked = true;
    await expect(service.login('a@b.md', 'password1')).rejects.toThrow(ForbiddenException);
  });

  it('refresh: blocked юзер -> ForbiddenException', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1');
    users['a@b.md'].blocked = true;
    await expect(service.refresh(refreshToken)).rejects.toThrow(ForbiddenException);
  });
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest auth.service`
Expected: FAIL — 3 новых теста (блокировки нет, апгрейда роли нет).

- [ ] **Step 3: Реализовать в `auth.service.ts`**

Добавить импорт:
```typescript
import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { parseAdminEmails } from './admin-emails';
```
Заменить метод `login`:
```typescript
  async login(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new UnauthorizedException('неверный email или пароль');
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
    // Апгрейд роли: email из ADMIN_EMAIL → admin (покрывает регистрацию после старта приложения).
    if (user.role !== 'admin' && parseAdminEmails(process.env.ADMIN_EMAIL).includes(email)) {
      user.role = 'admin';
      await this.userModel.update({ role: 'admin' }, { where: { email } });
    }
    return { ...(await this.tokens(user.id)), user: this.publicUser(user) };
  }
```
В методе `refresh` после `if (!user) throw ...` добавить:
```typescript
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
```

- [ ] **Step 4: Запустить — зелёный**

Run: `cd backend && npx jest auth.service`
Expected: PASS (все тесты, включая 3 новых).

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(admin): апгрейд роли на login по ADMIN_EMAIL + запрет login/refresh заблокированным"
```

---

### Task 3: `AdminRoleGuard`

**Files:**
- Create: `backend/src/auth/admin-role.guard.ts`
- Test: `backend/src/auth/admin-role.guard.spec.ts`

**Interfaces:**
- Consumes: `req.user.userId` (кладёт `JwtAuthGuard`), модель `User`.
- Produces: `AdminRoleGuard` — `canActivate` → `true` если у юзера `role==='admin'`, иначе `ForbiddenException`.

- [ ] **Step 1: Написать падающий тест**

Create `backend/src/auth/admin-role.guard.spec.ts`:
```typescript
import { ForbiddenException } from '@nestjs/common';
import { AdminRoleGuard } from './admin-role.guard';

const ctx = (userId?: string): any => ({
  switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined }) }),
});

describe('AdminRoleGuard', () => {
  const make = (user: any) =>
    new AdminRoleGuard({ findByPk: jest.fn(() => Promise.resolve(user)) } as any);

  it('role=admin -> пропускает', async () => {
    await expect(make({ id: 'u1', role: 'admin' }).canActivate(ctx('u1'))).resolves.toBe(true);
  });

  it('role=user -> 403', async () => {
    await expect(make({ id: 'u1', role: 'user' }).canActivate(ctx('u1'))).rejects.toThrow(ForbiddenException);
  });

  it('юзер не найден -> 403', async () => {
    await expect(make(null).canActivate(ctx('u1'))).rejects.toThrow(ForbiddenException);
  });

  it('нет req.user -> 403', async () => {
    await expect(make({ role: 'admin' }).canActivate(ctx(undefined))).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `cd backend && npx jest admin-role.guard`
Expected: FAIL — `Cannot find module './admin-role.guard'`.

- [ ] **Step 3: Реализовать guard**

Create `backend/src/auth/admin-role.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';

// Ставится ПОСЛЕ JwtAuthGuard (тот кладёт req.user.userId). Требует role==='admin'.
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException();
    const user = await this.userModel.findByPk(userId);
    if (!user || user.role !== 'admin') throw new ForbiddenException();
    return true;
  }
}
```

- [ ] **Step 4: Запустить — зелёный**

Run: `cd backend && npx jest admin-role.guard`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/admin-role.guard.ts backend/src/auth/admin-role.guard.spec.ts
git commit -m "feat(admin): AdminRoleGuard (JWT + role=admin)"
```

---

### Task 4: DTO + `AdminService`

**Files:**
- Create: `backend/src/auth/dto/admin.dto.ts`
- Create: `backend/src/auth/admin.service.ts`
- Test: `backend/src/auth/admin.service.spec.ts`

**Interfaces:**
- Consumes: модель `User`, `LanesService.overview()` (`{loads, lanes, markets, medianRpm}`).
- Produces:
  - `SetPlanDto { plan: 'free'|'pro' }`, `SetBlockedDto { blocked: boolean }`.
  - `AdminService.listUsers(q?: string): Promise<AdminUserView[]>` где `AdminUserView = { email, plan, role, blocked, telegramLinked, alertsEnabled, createdAt }`.
  - `AdminService.stats(): Promise<{ users, proUsers, blockedUsers, loads, lanes, markets, medianRpm }>`.
  - `AdminService.setPlan(email, plan): Promise<{ email, plan }>` (404 если нет юзера).
  - `AdminService.setBlocked(email, blocked): Promise<{ email, blocked }>` (404 если нет; нельзя блокировать `role==='admin'` → `ForbiddenException`).

- [ ] **Step 1: Создать DTO**

Create `backend/src/auth/dto/admin.dto.ts`:
```typescript
import { IsBoolean, IsIn } from 'class-validator';

export class SetPlanDto {
  @IsIn(['free', 'pro'])
  plan: 'free' | 'pro';
}

export class SetBlockedDto {
  @IsBoolean()
  blocked: boolean;
}
```

- [ ] **Step 2: Написать падающий тест сервиса**

Create `backend/src/auth/admin.service.spec.ts`:
```typescript
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let users: Record<string, any>;
  let service: AdminService;

  const lanes: any = { overview: jest.fn(() => Promise.resolve({ loads: 10, lanes: 4, markets: 2, medianRpm: 2.1 })) };

  beforeEach(() => {
    users = {
      'a@b.md': { email: 'a@b.md', plan: 'free', role: 'user', blocked: false, telegramChatId: null, alertsEnabled: false, createdAt: new Date('2026-01-01') },
      'pro@b.md': { email: 'pro@b.md', plan: 'pro', role: 'user', blocked: false, telegramChatId: 'c1', alertsEnabled: true, createdAt: new Date('2026-02-01') },
      'boss@b.md': { email: 'boss@b.md', plan: 'pro', role: 'admin', blocked: false, telegramChatId: null, alertsEnabled: false, createdAt: new Date('2026-03-01') },
    };
    const userModel: any = {
      findAll: jest.fn(({ where }: any = {}) => {
        let list = Object.values(users);
        const like = where?.email?.[Op.iLike];
        if (like) {
          const sub = String(like).replace(/%/g, '').toLowerCase();
          list = list.filter((u: any) => u.email.includes(sub));
        }
        return Promise.resolve(list);
      }),
      findOne: jest.fn(({ where: { email } }: any) => Promise.resolve(users[email] ?? null)),
      count: jest.fn(({ where }: any = {}) => {
        let list = Object.values(users) as any[];
        if (where?.plan) list = list.filter((u) => u.plan === where.plan);
        if (where?.blocked !== undefined) list = list.filter((u) => u.blocked === where.blocked);
        return Promise.resolve(list.length);
      }),
    };
    service = new AdminService(userModel, lanes);
  });

  it('listUsers: без passwordHash, поля-вьюхи', async () => {
    const list = await service.listUsers();
    expect(list).toHaveLength(3);
    expect(JSON.stringify(list)).not.toContain('passwordHash');
    expect(list.find((u) => u.email === 'pro@b.md')).toMatchObject({ plan: 'pro', telegramLinked: true, alertsEnabled: true });
    expect(list.find((u) => u.email === 'a@b.md')).toMatchObject({ telegramLinked: false });
  });

  it('listUsers: поиск по подстроке email', async () => {
    const list = await service.listUsers('pro');
    expect(list.map((u) => u.email)).toEqual(['pro@b.md']);
  });

  it('stats: счётчики юзеров + overview lane', async () => {
    const s = await service.stats();
    expect(s).toMatchObject({ users: 3, proUsers: 2, blockedUsers: 0, loads: 10, lanes: 4, markets: 2, medianRpm: 2.1 });
  });

  it('setPlan: меняет план', async () => {
    const r = await service.setPlan('a@b.md', 'pro');
    expect(r).toEqual({ email: 'a@b.md', plan: 'pro' });
    expect(users['a@b.md'].plan).toBe('pro');
  });

  it('setPlan: нет юзера -> 404', async () => {
    await expect(service.setPlan('no@b.md', 'pro')).rejects.toThrow(NotFoundException);
  });

  it('setBlocked: ставит флаг', async () => {
    const r = await service.setBlocked('a@b.md', true);
    expect(r).toEqual({ email: 'a@b.md', blocked: true });
    expect(users['a@b.md'].blocked).toBe(true);
  });

  it('setBlocked: нельзя блокировать админа -> 403', async () => {
    await expect(service.setBlocked('boss@b.md', true)).rejects.toThrow(ForbiddenException);
  });

  it('setBlocked: нет юзера -> 404', async () => {
    await expect(service.setBlocked('no@b.md', true)).rejects.toThrow(NotFoundException);
  });
});
```
Примечание: в тесте `users[email]` — простые объекты; `service` вызывает `user.save()`. Чтобы тест работал, в Step 3 для записи используем `Object.assign(user, vals); await user.save?.()` НЕ годится (нет save). Вместо этого сервис меняет поле и вызывает `user.save()` — добавь в мок-объекты метод save. **Поправка:** в `beforeEach` оборачивать каждый объект: после создания `users`, добавь
```typescript
    for (const u of Object.values(users)) (u as any).save = jest.fn(function (this: any) { return Promise.resolve(this); });
```
(вставить сразу после литерала `users = {...}`).

- [ ] **Step 3: Запустить — падает**

Run: `cd backend && npx jest admin.service`
Expected: FAIL — `Cannot find module './admin.service'`.

- [ ] **Step 4: Реализовать `admin.service.ts`**

Create `backend/src/auth/admin.service.ts`:
```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../users/user.model';
import { LanesService } from '../lanes/lanes.service';

export interface AdminUserView {
  email: string;
  plan: 'free' | 'pro';
  role: 'user' | 'admin';
  blocked: boolean;
  telegramLinked: boolean;
  alertsEnabled: boolean;
  createdAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly lanes: LanesService,
  ) {}

  private view(u: User): AdminUserView {
    return {
      email: u.email,
      plan: u.plan,
      role: u.role,
      blocked: u.blocked,
      telegramLinked: !!u.telegramChatId,
      alertsEnabled: u.alertsEnabled,
      createdAt: (u as any).createdAt,
    };
  }

  async listUsers(q?: string): Promise<AdminUserView[]> {
    const where = q ? { email: { [Op.iLike]: `%${q.trim().toLowerCase()}%` } } : undefined;
    const rows = await this.userModel.findAll({ where, order: [['createdAt', 'DESC']] });
    return rows.map((u) => this.view(u));
  }

  async stats() {
    const [users, proUsers, blockedUsers, overview] = await Promise.all([
      this.userModel.count(),
      this.userModel.count({ where: { plan: 'pro' } }),
      this.userModel.count({ where: { blocked: true } }),
      this.lanes.overview(),
    ]);
    return { users, proUsers, blockedUsers, ...overview };
  }

  async setPlan(emailRaw: string, plan: 'free' | 'pro') {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('пользователь не найден');
    user.plan = plan;
    await user.save();
    return { email: user.email, plan: user.plan };
  }

  async setBlocked(emailRaw: string, blocked: boolean) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('пользователь не найден');
    if (user.role === 'admin') throw new ForbiddenException('нельзя заблокировать администратора');
    user.blocked = blocked;
    await user.save();
    return { email: user.email, blocked: user.blocked };
  }
}
```
Заметь: `order` в тесте не проверяется (мок `findAll` игнорирует order) — ок.

- [ ] **Step 5: Запустить — зелёный**

Run: `cd backend && npx jest admin.service`
Expected: PASS (8 тестов).

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth/dto/admin.dto.ts backend/src/auth/admin.service.ts backend/src/auth/admin.service.spec.ts
git commit -m "feat(admin): AdminService (список/метрики/план/блокировка) + DTO"
```

---

### Task 5: Переписать `admin.controller`, подключить модули, удалить старый x-admin-key

**Files:**
- Rewrite: `backend/src/auth/admin.controller.ts`
- Delete: `backend/src/auth/admin.guard.ts`, `backend/src/auth/admin.guard.spec.ts`
- Modify: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/lanes/lanes.module.ts` (экспорт `LanesService`)

**Interfaces:**
- Consumes: `AdminService` (Task 4), `JwtAuthGuard`, `AdminRoleGuard` (Task 3), `SetPlanDto`/`SetBlockedDto` (Task 4).
- Produces (HTTP, под `/api/v1`): `GET /admin/users?q=`, `GET /admin/stats`, `PATCH /admin/users/:email/plan`, `PATCH /admin/users/:email/block`.

- [ ] **Step 1: Экспортировать `LanesService` из `LanesModule`**

Modify `backend/src/lanes/lanes.module.ts` — добавить `exports`:
```typescript
@Module({
  controllers: [LanesController],
  providers: [LanesService],
  exports: [LanesService],
})
export class LanesModule {}
```

- [ ] **Step 2: Переписать контроллер**

Replace полностью `backend/src/auth/admin.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { AdminService } from './admin.service';
import { SetBlockedDto, SetPlanDto } from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('users')
  users(@Query('q') q?: string) {
    return this.service.listUsers(q);
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Patch('users/:email/plan')
  setPlan(@Param('email') email: string, @Body() dto: SetPlanDto) {
    return this.service.setPlan(email, dto.plan);
  }

  @Patch('users/:email/block')
  setBlocked(@Param('email') email: string, @Body() dto: SetBlockedDto) {
    return this.service.setBlocked(email, dto.blocked);
  }
}
```

- [ ] **Step 3: Обновить `auth.module.ts`**

Replace `backend/src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { LanesModule } from '../lanes/lanes.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRoleGuard } from './admin-role.guard';

@Module({
  imports: [
    UsersModule,
    LanesModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AdminService, JwtAuthGuard, AdminRoleGuard],
})
export class AuthModule {}
```

- [ ] **Step 4: Удалить старый x-admin-key guard**

```bash
git rm backend/src/auth/admin.guard.ts backend/src/auth/admin.guard.spec.ts
```

- [ ] **Step 5: Собрать и прогнать все тесты**

Run: `cd backend && npm run build && npm test`
Expected: build OK; все тесты PASS; нет ссылок на `AdminGuard`/`ADMIN_KEY`. Если компилятор ругается на оставшиеся импорты `AdminGuard` — убрать их.

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth/admin.controller.ts backend/src/auth/auth.module.ts backend/src/lanes/lanes.module.ts
git commit -m "feat(admin): admin-контроллер на JWT-роли (users/stats/plan/block), удалён x-admin-key"
```

---

### Task 6: Фронтенд `backend/public/admin.html`

**Files:**
- Create: `backend/public/admin.html`

**Interfaces:**
- Consumes (HTTP): `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `GET /api/v1/admin/stats`, `GET /api/v1/admin/users?q=`, `PATCH /api/v1/admin/users/:email/plan`, `PATCH /api/v1/admin/users/:email/block`.

- [ ] **Step 1: Создать страницу**

Create `backend/public/admin.html`:
```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LoadLens — админ-панель</title>
  <style>
    :root { --blue:#1d4ed8; --ink:#0f1720; --mut:#64748b; --line:#e2e8f0; --bg:#f8fafc; --red:#991b1b; --green:#166534; }
    * { box-sizing: border-box; }
    body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
           max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; background: #fff; }
    h1 { margin: 0 0 4px; font-size: 24px; } h1 b { color: var(--blue); }
    .sub { color: var(--mut); font-size: 13px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .spacer { flex: 1; }
    input, button { font: inherit; }
    input[type=text], input[type=email], input[type=password] {
      padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
    button { padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); cursor: pointer; }
    button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
    button.danger { color: var(--red); }
    button:disabled { opacity: .5; cursor: default; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--bg); }
    .card b { display: block; font-size: 24px; line-height: 1.1; }
    .card span { color: var(--mut); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { color: var(--mut); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; }
    .badge { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 12px; font-weight: 700; }
    .badge.admin { background: #eef2ff; color: var(--blue); }
    .badge.pro { background: #ecfdf5; color: var(--green); }
    .badge.blocked { background: #fef2f2; color: var(--red); }
    .err { color: var(--red); font-size: 13px; min-height: 18px; }
    #login { max-width: 360px; margin: 48px auto; display: grid; gap: 10px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div id="login">
    <h1>Load<b>Lens</b> · админ</h1>
    <input id="email" type="email" placeholder="email" autocomplete="username" />
    <input id="password" type="password" placeholder="пароль" autocomplete="current-password" />
    <button class="primary" id="loginBtn">Войти</button>
    <div class="err" id="loginErr"></div>
  </div>

  <div id="app" class="hidden">
    <div class="row">
      <h1>Load<b>Lens</b> · админ</h1>
      <div class="spacer"></div>
      <span class="sub" id="who"></span>
      <button id="logoutBtn">Выйти</button>
    </div>
    <div class="cards" id="cards"></div>
    <div class="row">
      <input id="search" type="text" placeholder="поиск по email…" />
      <button id="refreshBtn">Обновить</button>
      <div class="err" id="appErr"></div>
    </div>
    <table>
      <thead><tr>
        <th>Email</th><th>Роль</th><th>План</th><th>Статус</th><th>TG</th><th>Алерты</th><th>Создан</th><th></th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>

  <script>
    const API = '/api/v1';
    const $ = (id) => document.getElementById(id);
    const tok = {
      get a() { return localStorage.getItem('ll_admin_at'); },
      get r() { return localStorage.getItem('ll_admin_rt'); },
      set(at, rt) { localStorage.setItem('ll_admin_at', at); localStorage.setItem('ll_admin_rt', rt); },
      clear() { localStorage.removeItem('ll_admin_at'); localStorage.removeItem('ll_admin_rt'); },
    };

    async function api(path, opts = {}, retry = true) {
      const res = await fetch(API + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok.a, ...(opts.headers || {}) },
      });
      if (res.status === 401 && retry && tok.r) {
        const ok = await tryRefresh();
        if (ok) return api(path, opts, false);
      }
      if (res.status === 401 || res.status === 403) {
        const e = new Error(res.status === 403 ? 'нет прав администратора' : 'сессия истекла');
        e.code = res.status; throw e;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'ошибка');
      return res.json();
    }

    async function tryRefresh() {
      try {
        const res = await fetch(API + '/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tok.r }),
        });
        if (!res.ok) return false;
        const d = await res.json();
        tok.set(d.accessToken, d.refreshToken);
        return true;
      } catch { return false; }
    }

    function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('ru-RU') : '—'; }
    function money(n) { return n == null ? '—' : '$' + Number(n).toFixed(2); }

    async function loadAll() {
      $('appErr').textContent = '';
      try {
        const [stats, users] = await Promise.all([
          api('/admin/stats'),
          api('/admin/users' + ($('search').value ? '?q=' + encodeURIComponent($('search').value) : '')),
        ]);
        renderCards(stats); renderRows(users);
        showApp();
      } catch (e) {
        if (e.code === 401) return logout();
        $('appErr').textContent = e.message;
        if (e.code === 403) { renderCards({}); renderRows([]); showApp(); }
      }
    }

    function renderCards(s) {
      $('cards').innerHTML = [
        ['Пользователей', s.users ?? '—'], ['Pro', s.proUsers ?? '—'], ['Заблокировано', s.blockedUsers ?? '—'],
        ['Грузов (7д)', s.loads ?? '—'], ['Lane', s.lanes ?? '—'], ['Рынков', s.markets ?? '—'],
        ['Медиана RPM', s.medianRpm != null ? money(s.medianRpm) + '/mi' : '—'],
      ].map(([l, v]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('');
    }

    function renderRows(users) {
      $('rows').innerHTML = '';
      for (const u of users) {
        const tr = document.createElement('tr');
        const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        tr.innerHTML = `
          <td>${esc(u.email)}</td>
          <td>${u.role === 'admin' ? '<span class="badge admin">admin</span>' : 'user'}</td>
          <td>${u.plan === 'pro' ? '<span class="badge pro">pro</span>' : 'free'}</td>
          <td>${u.blocked ? '<span class="badge blocked">blocked</span>' : 'active'}</td>
          <td>${u.telegramLinked ? '✓' : '—'}</td>
          <td>${u.alertsEnabled ? '✓' : '—'}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td class="row"></td>`;
        const actions = tr.querySelector('td.row');
        const planBtn = document.createElement('button');
        planBtn.textContent = u.plan === 'pro' ? '→ free' : '→ pro';
        planBtn.onclick = () => act(() => api('/admin/users/' + encodeURIComponent(u.email) + '/plan',
          { method: 'PATCH', body: JSON.stringify({ plan: u.plan === 'pro' ? 'free' : 'pro' }) }));
        actions.appendChild(planBtn);
        if (u.role !== 'admin') {
          const blockBtn = document.createElement('button');
          blockBtn.className = u.blocked ? '' : 'danger';
          blockBtn.textContent = u.blocked ? 'разблок.' : 'блок';
          blockBtn.onclick = () => act(() => api('/admin/users/' + encodeURIComponent(u.email) + '/block',
            { method: 'PATCH', body: JSON.stringify({ blocked: !u.blocked }) }));
          actions.appendChild(blockBtn);
        }
        $('rows').appendChild(tr);
      }
    }

    async function act(fn) {
      try { await fn(); await loadAll(); }
      catch (e) { $('appErr').textContent = e.message; if (e.code === 401) logout(); }
    }

    function showApp() { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('who').textContent = $('email').value || ''; }
    function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }
    function logout() { tok.clear(); showLogin(); }

    $('loginBtn').onclick = async () => {
      $('loginErr').textContent = '';
      try {
        const res = await fetch(API + '/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: $('email').value, password: $('password').value }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'не удалось войти');
        const d = await res.json();
        tok.set(d.accessToken, d.refreshToken);
        await loadAll();
      } catch (e) { $('loginErr').textContent = e.message; }
    };
    $('logoutBtn').onclick = logout;
    $('refreshBtn').onclick = loadAll;
    $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAll(); });

    // автологин по сохранённому токену
    if (tok.a) loadAll(); else showLogin();
  </script>
</body>
</html>
```

- [ ] **Step 2: Ручная проверка**

Run (локально): `cd backend && docker compose -p loadlens up -d && npm run build && node dist/main.js`
(перед стартом задать в `.env`: `ADMIN_EMAIL=<твой-email>`).
Открыть `http://localhost:3000/admin.html`. Зарегистрировать юзера с этим email (через расширение/`POST /api/v1/auth/register`), войти → должны появиться карточки метрик и таблица. Проверить: переключение план free⇄pro, блок/разблок другого (не-admin) юзера, поиск по email.
Expected: логин админом работает; не-админ видит «нет прав администратора».

- [ ] **Step 3: Commit**

```bash
git add backend/public/admin.html
git commit -m "feat(admin): админ-страница /admin.html (логин, метрики, список, план, блок)"
```

---

### Task 7: Документация (CLAUDE.md) + env

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Обновить env-строку деплоя**

Modify `CLAUDE.md` строка ~167 — заменить `ADMIN_KEY` на `ADMIN_EMAIL` в перечне env:
было:
```
Env в Coolify: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_KEY`, `PORT`. Опц. ...
```
стало:
```
Env в Coolify: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL` (список email админов через запятую), `PORT`. Опц. ...
```

- [ ] **Step 2: Обновить описание `auth/ users/` в структуре**

В блоке структуры найти строку про `auth/ users/` и добавить упоминание админки. Заменить:
```
  auth/ users/              register/login/refresh/me, DELETE /users/me (hard-delete + каскад водителей), PATCH /admin/users/:email/plan
```
на:
```
  auth/ users/              register/login/refresh/me, DELETE /users/me (hard-delete + каскад водителей)
                            admin/* (JwtAuthGuard+AdminRoleGuard, role из ADMIN_EMAIL): GET users/stats, PATCH users/:email/plan|block. Страница /admin.html
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: ADMIN_EMAIL вместо ADMIN_KEY + админ-панель в CLAUDE.md"
```

- [ ] **Step 4: Деплой**

После мёрджа в `main` сработает автодеплой Coolify. Перед этим в Coolify-env добавить `ADMIN_EMAIL` и удалить `ADMIN_KEY` (по скиллу `coolify-deploy`, `--context yoolip999`). Без `ADMIN_EMAIL` админов не будет — это ожидаемо.

---

## Self-Review

**Spec coverage:**
- Модель role/blocked + ALTER → Task 1 ✓
- Bootstrap ADMIN_EMAIL → Task 1 (startup) + Task 2 (login-апгрейд) ✓
- Блокировка enforcement login/refresh → Task 2 ✓
- AdminRoleGuard → Task 3 ✓
- GET users / GET stats / PATCH plan / PATCH block → Task 4 (service) + Task 5 (controller) ✓
- Удаление x-admin-key → Task 5 ✓
- admin.html (логин, метрики, таблица, refresh-on-401) → Task 6 ✓
- Тесты (guard/service/auth) → Tasks 2,3,4 ✓
- Docs/env → Task 7 ✓

**Placeholder scan:** код приведён полностью во всех шагах, плейсхолдеров нет.

**Type consistency:** `AdminUserView` (Task 4) совпадает с полями, которые рендерит `admin.html` (Task 6: email/role/plan/blocked/telegramLinked/alertsEnabled/createdAt). `stats()` возвращает `{users,proUsers,blockedUsers,loads,lanes,markets,medianRpm}` — карточки в Task 6 читают те же ключи. `LanesService.overview()` сигнатура совпадает с реальной (`backend/src/lanes/lanes.service.ts:54`). DTO `SetPlanDto`/`SetBlockedDto` — используются в контроллере Task 5.
