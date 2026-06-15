# Парк водителей диспетчера — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Диспетчер ведёт несколько своих водителей; активный водитель (рынок/HOS/прицеп/cost) питает скоринг и get-out цепочки; без логина всё работает по-старому.

**Architecture:** Backend — новый модуль `drivers` (NestJS/Sequelize, CRUD под `JwtAuthGuard`, скоуп по `userId`, каскад от `users`). Extension — тонкий `LLDRV` (чистый выбор контекста + per-device активный водитель), authed-методы в `LLAPI`, свитчер в шапке панели, секция «Парк» в popup. Аноним-режим — фолбэк на текущее поведение.

**Tech Stack:** NestJS, sequelize-typescript, class-validator, Jest (backend); ванильный JS, `chrome.storage.local`, `node:test` (extension).

---

## Файловая структура

**Backend (new):** `backend/src/drivers/driver.model.ts`, `dto/create-driver.dto.ts`, `dto/update-driver.dto.ts`, `drivers.service.ts`, `drivers.service.spec.ts`, `drivers.controller.ts`, `drivers.module.ts`.
**Backend (edit):** `backend/src/app.module.ts` (модель + модуль).
**Extension (new):** `extension/drivers.js` (LLDRV), `extension/drivers.test.js`.
**Extension (edit):** `extension/api.js` (CRUD), `extension/content.js` (свитчер + контекст), `extension/popup.html`, `extension/popup.js` (секция «Парк»), `extension/manifest.json` (подключить `drivers.js`).
**Docs (edit):** `CLAUDE.md`.

Backend и extension независимы и тестируются по отдельности — backend-таски (1–4) дают рабочий API, extension-таски (5–9) — рабочий UI поверх него.

---

## Task 1: Модель Driver + регистрация

**Files:**
- Create: `backend/src/drivers/driver.model.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Написать модель**

`backend/src/drivers/driver.model.ts`:

```typescript
import { Column, DataType, Model, Table } from 'sequelize-typescript';

export const EQUIPMENT = ['V', 'R', 'F', 'SD', 'PO'] as const;
export const DRIVER_STATUS = ['active', 'available', 'off'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export type DriverStatus = (typeof DRIVER_STATUS)[number];

// HOS-остаток водителя в минутах (стартовое состояние для planner.stepHos).
export interface DriverHos {
  remainingDrive: number;
  remainingOnDuty: number;
  remainingCycle: number;
}

@Table({
  tableName: 'drivers',
  underscored: true,
  timestamps: true,
  indexes: [{ name: 'idx_drivers_user', fields: ['user_id'] }],
})
export class Driver extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  // FK → users.id; каскад: удаление аккаунта (DELETE /users/me) уносит водителей.
  @Column({
    type: DataType.UUID, allowNull: false, field: 'user_id',
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  name: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'current_market' })
  currentMarket: string | null;

  @Column({ type: DataType.ENUM(...EQUIPMENT), allowNull: true })
  equipment: Equipment | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'cost_per_mile' })
  costPerMile: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'home_base' })
  homeBase: string | null;

  @Column({ type: DataType.ENUM(...DRIVER_STATUS), allowNull: false, defaultValue: 'available' })
  status: DriverStatus;

  @Column({ type: DataType.JSONB, allowNull: false })
  hos: DriverHos;
}
```

- [ ] **Step 2: Зарегистрировать модель в app.module**

`backend/src/app.module.ts` — добавить импорт и в массив `models`. После строки `import { User } from './users/user.model';` добавить:

```typescript
import { Driver } from './drivers/driver.model';
import { DriversModule } from './drivers/drivers.module';
```

В `SequelizeModule.forRoot({ ... models: [...] })` заменить массив на:

```typescript
      models: [Load, LaneDistance, BrokerReport, User, Driver],
```

В массив `imports` после `AuthModule,` добавить `DriversModule,` (модуль создаётся в Task 4 — компиляция пройдёт после него; пока можно добавить только модель и вернуться к строке `DriversModule,` в Task 4).

- [ ] **Step 3: Сборка модели**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS (импорт `DriversModule` ещё может ругаться, если модуль не создан — это нормально, добавляется в Task 4; на этом шаге временно НЕ добавляй строку `DriversModule,` в imports, только модель в `models`).

- [ ] **Step 4: Commit**

```bash
git add backend/src/drivers/driver.model.ts backend/src/app.module.ts
git commit -m "feat(drivers): модель Driver + регистрация в Sequelize"
```

---

## Task 2: DTO создания и обновления

**Files:**
- Create: `backend/src/drivers/dto/create-driver.dto.ts`
- Create: `backend/src/drivers/dto/update-driver.dto.ts`

- [ ] **Step 1: CreateDriverDto**

`backend/src/drivers/dto/create-driver.dto.ts`:

```typescript
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DRIVER_STATUS, EQUIPMENT } from '../driver.model';

export class CreateDriverDto {
  @IsString() @MaxLength(64) @Matches(/^[^\n\r]{1,64}$/)
  name: string;

  // Market key CITY_ST, напр. CHICAGO_IL. Пусто допустимо (рынок задаётся позже).
  @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{0,48}$/)
  currentMarket?: string;

  @IsOptional() @IsIn(EQUIPMENT as unknown as string[])
  equipment?: string;

  @IsOptional() @IsNumber() @Min(0)
  costPerMile?: number;

  @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{0,48}$/)
  homeBase?: string;

  @IsOptional() @IsIn(DRIVER_STATUS as unknown as string[])
  status?: string;

  // { remainingDrive, remainingOnDuty, remainingCycle } в минутах. По умолчанию — «свежий» в сервисе.
  @IsOptional() @IsObject()
  hos?: { remainingDrive: number; remainingOnDuty: number; remainingCycle: number };
}
```

- [ ] **Step 2: UpdateDriverDto** (все поля optional, включая name)

`backend/src/drivers/dto/update-driver.dto.ts`:

```typescript
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DRIVER_STATUS, EQUIPMENT } from '../driver.model';

export class UpdateDriverDto {
  @IsOptional() @IsString() @MaxLength(64) @Matches(/^[^\n\r]{1,64}$/)
  name?: string;

  @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{0,48}$/)
  currentMarket?: string;

  @IsOptional() @IsIn(EQUIPMENT as unknown as string[])
  equipment?: string;

  @IsOptional() @IsNumber() @Min(0)
  costPerMile?: number;

  @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{0,48}$/)
  homeBase?: string;

  @IsOptional() @IsIn(DRIVER_STATUS as unknown as string[])
  status?: string;

  @IsOptional() @IsObject()
  hos?: { remainingDrive: number; remainingOnDuty: number; remainingCycle: number };
}
```

- [ ] **Step 3: Сборка**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS (кроме возможной строки `DriversModule,` — её добавляем в Task 4).

- [ ] **Step 4: Commit**

```bash
git add backend/src/drivers/dto
git commit -m "feat(drivers): DTO create/update с валидацией"
```

---

## Task 3: DriversService + spec (TDD)

**Files:**
- Create: `backend/src/drivers/drivers.service.ts`
- Test: `backend/src/drivers/drivers.service.spec.ts`

- [ ] **Step 1: Написать падающий тест**

`backend/src/drivers/drivers.service.spec.ts`:

```typescript
import { NotFoundException } from '@nestjs/common';
import { DriversService, FRESH_HOS } from './drivers.service';

function svcWith(model: any) { return new DriversService(model as any); }

describe('DriversService', () => {
  it('list фильтрует по userId', async () => {
    const findAll = jest.fn().mockResolvedValueOnce([{ id: 'd1' }]);
    const res = await svcWith({ findAll }).list('u1');
    expect(findAll).toHaveBeenCalledWith({ where: { userId: 'u1' }, order: [['createdAt', 'ASC']] });
    expect(res).toEqual([{ id: 'd1' }]);
  });

  it('create подставляет userId и дефолтный hos', async () => {
    const create = jest.fn().mockImplementation(async (v: any) => ({ id: 'd1', ...v }));
    const res = await svcWith({ create }).create('u1', { name: 'Bob' } as any);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', name: 'Bob', hos: FRESH_HOS }));
    expect(res.id).toBe('d1');
  });

  it('create уважает переданный hos', async () => {
    const create = jest.fn().mockImplementation(async (v: any) => v);
    const hos = { remainingDrive: 120, remainingOnDuty: 240, remainingCycle: 600 };
    await svcWith({ create }).create('u1', { name: 'Bob', hos } as any);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ hos }));
  });

  it('update находит по id+userId и патчит', async () => {
    const row = { update: jest.fn().mockResolvedValue(undefined) };
    const findOne = jest.fn().mockResolvedValueOnce(row);
    const res = await svcWith({ findOne }).update('u1', 'd1', { status: 'active' } as any);
    expect(findOne).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'u1' } });
    expect(row.update).toHaveBeenCalledWith({ status: 'active' });
    expect(res).toBe(row);
  });

  it('update чужого водителя → NotFound', async () => {
    const findOne = jest.fn().mockResolvedValueOnce(null);
    await expect(svcWith({ findOne }).update('u1', 'dX', {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove по id+userId; ничего не удалено → NotFound', async () => {
    const destroyOk = jest.fn().mockResolvedValueOnce(1);
    await expect(svcWith({ destroy: destroyOk }).remove('u1', 'd1')).resolves.toEqual({ ok: true });
    expect(destroyOk).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'u1' } });

    const destroyNone = jest.fn().mockResolvedValueOnce(0);
    await expect(svcWith({ destroy: destroyNone }).remove('u1', 'dX')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd backend && npx jest drivers.service`
Expected: FAIL — `Cannot find module './drivers.service'`.

- [ ] **Step 3: Написать сервис**

`backend/src/drivers/drivers.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Driver } from './driver.model';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

// «Свежий» водитель: полный ресурс часов (минуты) — как FRESH в extension/hos.js.
export const FRESH_HOS = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 70 * 60 };

@Injectable()
export class DriversService {
  constructor(@InjectModel(Driver) private readonly model: typeof Driver) {}

  list(userId: string): Promise<Driver[]> {
    return this.model.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
  }

  create(userId: string, dto: CreateDriverDto): Promise<Driver> {
    return this.model.create({ ...dto, userId, hos: dto.hos ?? FRESH_HOS } as any);
  }

  async update(userId: string, id: string, dto: UpdateDriverDto): Promise<Driver> {
    const row = await this.model.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('водитель не найден');
    await row.update(dto as any);
    return row;
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const n = await this.model.destroy({ where: { id, userId } });
    if (!n) throw new NotFoundException('водитель не найден');
    return { ok: true };
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd backend && npx jest drivers.service`
Expected: PASS (6 тестов).

- [ ] **Step 5: Commit**

```bash
git add backend/src/drivers/drivers.service.ts backend/src/drivers/drivers.service.spec.ts
git commit -m "feat(drivers): DriversService с изоляцией по userId + тесты"
```

---

## Task 4: DriversController + module + подключение

**Files:**
- Create: `backend/src/drivers/drivers.controller.ts`
- Create: `backend/src/drivers/drivers.module.ts`
- Modify: `backend/src/app.module.ts` (строка `DriversModule,` в imports)

- [ ] **Step 1: Контроллер**

`backend/src/drivers/drivers.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly service: DriversService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.list(req.user.userId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateDriverDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.service.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.userId, id);
  }
}
```

- [ ] **Step 2: Модуль**

`backend/src/drivers/drivers.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { Driver } from './driver.model';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([Driver]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [DriversController],
  providers: [DriversService, JwtAuthGuard],
  exports: [SequelizeModule],
})
export class DriversModule {}
```

- [ ] **Step 3: Дописать `DriversModule,` в app.module imports**

`backend/src/app.module.ts` — в массиве `imports`, после `AuthModule,`, добавить строку:

```typescript
    DriversModule,
```

(импорт `import { DriversModule } from './drivers/drivers.module';` уже добавлен в Task 1, Step 2.)

- [ ] **Step 4: Сборка + полный прогон тестов**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: PASS — компиляция чистая, все тесты зелёные (включая 6 из Task 3).

- [ ] **Step 5: Smoke-тест эндпоинтов вручную (опционально, если поднят dev-стек)**

Run (при запущенном `docker compose -p loadlens up -d` и `npm run start:dev`):

```bash
# зарегистрировать тестового диспетчера и создать водителя
TOK=$(curl -s -XPOST localhost:3000/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"disp@test.dev","password":"password123"}' | npx --yes json -a accessToken)
curl -s -XPOST localhost:3000/api/v1/drivers -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d '{"name":"Bob","currentMarket":"CHICAGO_IL","equipment":"V"}'
curl -s localhost:3000/api/v1/drivers -H "Authorization: Bearer $TOK"
```

Expected: POST вернёт объект водителя с `id`, GET — массив с ним. Без заголовка `Authorization` → 401.

- [ ] **Step 6: Commit**

```bash
git add backend/src/drivers/drivers.controller.ts backend/src/drivers/drivers.module.ts backend/src/app.module.ts
git commit -m "feat(drivers): REST-контроллер под JwtAuthGuard + модуль"
```

---

## Task 5: extension/drivers.js (LLDRV) + тест (TDD)

**Files:**
- Create: `extension/drivers.js`
- Test: `extension/drivers.test.js`

- [ ] **Step 1: Написать падающий тест**

`extension/drivers.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const LLDRV = require("./drivers.js");

const DRIVER = {
  id: "d1", name: "Bob", currentMarket: "CHICAGO_IL", equipment: "R",
  costPerMile: 1.5, hos: { remainingDrive: 300, remainingOnDuty: 480, remainingCycle: 2400 },
};

test("resolveDriverContext: активный водитель питает все поля", () => {
  const ctx = LLDRV.resolveDriverContext(DRIVER, { market: "X", costPerMile: 1.8 });
  assert.strictEqual(ctx.market, "CHICAGO_IL");
  assert.strictEqual(ctx.equipment, "R");
  assert.strictEqual(ctx.costPerMile, 1.5);
  assert.deepStrictEqual(ctx.hos, DRIVER.hos);
});

test("resolveDriverContext: нет водителя → аноним-фолбэк", () => {
  const ctx = LLDRV.resolveDriverContext(null, { market: "PERU_IL", hos: { remainingDrive: 1, remainingOnDuty: 2, remainingCycle: 3 }, costPerMile: 2.1 });
  assert.strictEqual(ctx.market, "PERU_IL");
  assert.strictEqual(ctx.equipment, null);          // аноним без фильтра прицепа
  assert.strictEqual(ctx.costPerMile, 2.1);
  assert.deepStrictEqual(ctx.hos, { remainingDrive: 1, remainingOnDuty: 2, remainingCycle: 3 });
});

test("resolveDriverContext: пустой market/equipment у водителя → фолбэк market, equipment null", () => {
  const ctx = LLDRV.resolveDriverContext({ id: "d2", name: "Sue", hos: LLDRV.FRESH }, { market: "PERU_IL", costPerMile: 1.8 });
  assert.strictEqual(ctx.market, "PERU_IL");         // фолбэк на авто-рынок выдачи
  assert.strictEqual(ctx.equipment, null);
});

test("pickActive: находит по id, иначе первый, иначе null", () => {
  const list = [{ id: "a" }, { id: "b" }];
  assert.strictEqual(LLDRV.pickActive(list, "b").id, "b");
  assert.strictEqual(LLDRV.pickActive(list, "ZZZ").id, "a"); // сохранённый id удалён → первый
  assert.strictEqual(LLDRV.pickActive([], "a"), null);
  assert.strictEqual(LLDRV.pickActive(null, "a"), null);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd /Users/bogdan/work/startup/dat.com && node --test extension/drivers.test.js`
Expected: FAIL — `Cannot find module './drivers.js'`.

- [ ] **Step 3: Написать модуль**

`extension/drivers.js`:

```javascript
/* LoadLens — LLDRV: парк водителей диспетчера. Чистый выбор контекста планировщика
   (resolveDriverContext/pickActive — тестируются node:test) + per-device активный водитель
   (chrome.storage.local). Профили живут на бэкенде (LLAPI), здесь только кэш и выбор. */
const LLDRV = (() => {
  "use strict";
  const ACTIVE_KEY = "ll_active_driver";
  const DEFAULT_CPM = 1.80;
  const FRESH = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 70 * 60 };

  // Чистая: из активного водителя (или его отсутствия) собрать контекст для планировщика/скоринга.
  // fallback = { market, hos, costPerMile } — текущие аноним-настройки (авто-рынок выдачи и т.п.).
  function resolveDriverContext(activeDriver, fallback) {
    const fb = fallback || {};
    const fbCpm = fb.costPerMile != null ? fb.costPerMile : DEFAULT_CPM;
    if (!activeDriver) {
      return { market: fb.market || null, hos: fb.hos || { ...FRESH }, equipment: null, costPerMile: fbCpm };
    }
    return {
      market: activeDriver.currentMarket || fb.market || null,
      hos: activeDriver.hos || fb.hos || { ...FRESH },
      equipment: activeDriver.equipment || null,
      costPerMile: activeDriver.costPerMile != null ? activeDriver.costPerMile : fbCpm,
    };
  }

  // Выбрать активного из списка по сохранённому id; если его нет — первый; пустой список → null.
  function pickActive(list, activeId) {
    if (!Array.isArray(list) || !list.length) return null;
    return list.find((d) => d.id === activeId) || list[0];
  }

  async function getActiveId() {
    try { return (await chrome.storage.local.get(ACTIVE_KEY))[ACTIVE_KEY] || null; } catch { return null; }
  }
  async function setActive(id) {
    try { await chrome.storage.local.set({ [ACTIVE_KEY]: id }); } catch { /* офлайн */ }
  }

  return { resolveDriverContext, pickActive, getActiveId, setActive, FRESH };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLDRV;
if (typeof globalThis !== "undefined") globalThis.LLDRV = LLDRV;
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd /Users/bogdan/work/startup/dat.com && node --test extension/drivers.test.js`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add extension/drivers.js extension/drivers.test.js
git commit -m "feat(drivers): LLDRV — выбор контекста водителя + тесты"
```

---

## Task 6: LLAPI — authed CRUD методов drivers

**Files:**
- Modify: `extension/api.js`

- [ ] **Step 1: Добавить authed-helper и методы**

В `extension/api.js`, сразу ПОСЛЕ функции `getMe` (перед `return { ... }`), вставить:

```javascript
  // ---- authed fetch с авто-refresh (как getMe). Возвращает Response или null (не залогинен). ----
  async function authedFetch(path, opts = {}) {
    let auth = await getAuth();
    if (!auth) return null;
    const call = (a) => fetch(`${BASE}${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), "Content-Type": "application/json", Authorization: `Bearer ${a.accessToken}` },
    });
    let res = await call(auth);
    if (res.status === 401) {
      auth = await refreshTokens(auth);
      if (!auth) return null;
      res = await call(auth);
    }
    return res;
  }

  // ---- парк водителей (под JWT диспетчера) ----
  async function getDrivers() {
    try { const res = await authedFetch("/drivers"); return res && res.ok ? await res.json() : []; }
    catch { return []; }
  }
  async function createDriver(d) {
    const res = await authedFetch("/drivers", { method: "POST", body: JSON.stringify(d) });
    if (!res) throw new Error("нужен вход в аккаунт");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    return data;
  }
  async function updateDriver(id, patch) {
    const res = await authedFetch(`/drivers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!res) throw new Error("нужен вход в аккаунт");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    return data;
  }
  async function deleteDriver(id) {
    const res = await authedFetch(`/drivers/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res) throw new Error("нужен вход в аккаунт");
    if (!res.ok) throw new Error(`ошибка ${res.status}`);
    return { ok: true };
  }
```

- [ ] **Step 2: Экспортировать методы**

В `extension/api.js` заменить строку `return` экспорта на:

```javascript
  return { sanitizeLoad, clientId, sendLoads, getLane, getMarket, getDistance, getDiesel,
           getLoadsByOrigin, getBrokerReputation, reportBroker, register, login, logout, getMe,
           getDrivers, createDriver, updateDriver, deleteDriver };
```

- [ ] **Step 3: Проверить синтаксис**

Run: `cd /Users/bogdan/work/startup/dat.com && node -e "require('./extension/api.js')" 2>&1 | head -5 || node --check extension/api.js`
Expected: без синтаксических ошибок (модуль обращается к `chrome`/`fetch` лишь внутри функций, на require не падает; при ошибке — `node --check extension/api.js` должен пройти).

- [ ] **Step 4: Commit**

```bash
git add extension/api.js
git commit -m "feat(drivers): LLAPI getDrivers/createDriver/updateDriver/deleteDriver"
```

---

## Task 7: content.js — свитчер водителя + контекст

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Подключить drivers.js в manifest (до content.js, после hos.js)**

`extension/manifest.json` — в `content_scripts[0].js` добавить `"drivers.js",` между `"hos.js",` и `"csv.js"`:

```json
        "hos.js",
        "drivers.js",
        "csv.js",
        "content.js"
```

- [ ] **Step 2: Добавить состояние парка**

`extension/content.js` — после строки `let currentMarket = null; ...` (≈стр. 14) добавить:

```javascript
  let drivers = [];              // парк диспетчера (LLAPI.getDrivers; пусто, если не залогинен)
  let activeDriver = null;       // выбранный водитель (LLDRV.pickActive)
  let activeEquipment = null;    // фильтр прицепа активного водителя (null = без фильтра)
```

- [ ] **Step 3: Применение контекста водителя**

`extension/content.js` — добавить функцию рядом с `topOriginMarket` (после неё, ≈стр. 334):

```javascript
  // Применить активного водителя к параметрам планировщика/скоринга (или аноним-фолбэк).
  function applyDriverContext(loads) {
    const fallbackMarket = currentMarket || topOriginMarket(loads);
    const ctx = (typeof LLDRV !== "undefined")
      ? LLDRV.resolveDriverContext(activeDriver, { market: fallbackMarket, hos: hosState, costPerMile })
      : { market: fallbackMarket, hos: hosState, equipment: null, costPerMile };
    if (activeDriver) {                       // водитель переопределяет аноним-настройки
      hosState = ctx.hos;
      costPerMile = ctx.costPerMile;
    }
    activeEquipment = ctx.equipment;
    return ctx.market;
  }
```

- [ ] **Step 4: Прокинуть equipment в планировщик**

`extension/content.js` — в `buildChains` (≈стр. 317) добавить `equipment` в опции `LLPLAN.plan`:

```javascript
  function buildChains(pool, start) {
    if (typeof LLPLAN === "undefined" || !start) return [];
    return LLPLAN.plan({
      start: { market: start },
      hosState,
      loads: pool,
      distance: (a, b) => LLGEO.sync(a, b),
      marketStrength: strengthOf,
      equipment: activeEquipment || undefined,
      dieselPrice, costPerMile, maxLegs: 3, topN: 5,
    });
  }
```

- [ ] **Step 5: Использовать контекст водителя в render + добавить свитчер**

`extension/content.js` — в `render()` заменить строку
`const start = currentMarket || topOriginMarket(loads);` (≈стр. 378) на:

```javascript
    const start = applyDriverContext(loads);
```

Затем в том же `render()`, в шаблоне `bd.innerHTML`, ПЕРЕД строкой `row("Грузов в выдаче", ...)` добавить свитчер (рендерится только при непустом парке):

```javascript
      (drivers.length ? `<div class="ll-driver"><span class="k">Водитель</span>` +
        `<select id="ll-driver">` + drivers.map((d) =>
          `<option value="${esc(d.id)}"${activeDriver && d.id === activeDriver.id ? " selected" : ""}>` +
          `${esc(d.name)}${d.currentMarket ? " · " + esc(d.currentMarket) : ""}${d.equipment ? " · " + esc(d.equipment) : ""}</option>`).join("") +
        `</select></div>` : "") +
```

- [ ] **Step 6: Повесить обработчик свитчера**

`extension/content.js` — в `render()`, рядом с привязкой `#ll-cpm`/`#ll-start` (≈стр. 399), добавить:

```javascript
    const drvSel = bd.querySelector("#ll-driver");
    if (drvSel) drvSel.onchange = async () => {
      activeDriver = (typeof LLDRV !== "undefined") ? LLDRV.pickActive(drivers, drvSel.value) : null;
      if (typeof LLDRV !== "undefined") await LLDRV.setActive(drvSel.value);
      render();
    };
```

- [ ] **Step 7: Загрузить парк в boot()**

`extension/content.js` — в `boot()`, после строки загрузки cost/mile
(`try { const { ll_cpm } = ... } catch {...}`, ≈стр. 449) добавить:

```javascript
    // парк водителей диспетчера (если залогинен); активный — per-device выбор
    if (typeof LLAPI !== "undefined" && typeof LLDRV !== "undefined") {
      try {
        drivers = await LLAPI.getDrivers();
        if (drivers.length) activeDriver = LLDRV.pickActive(drivers, await LLDRV.getActiveId());
      } catch { drivers = []; activeDriver = null; }
    }
```

- [ ] **Step 8: Прогнать extension-тесты (регрессия) + проверить синтаксис content.js**

Run: `cd /Users/bogdan/work/startup/dat.com && node --check extension/content.js && npm run test:ext`
Expected: PASS — синтаксис чист, существующие extension-тесты (включая drivers.test.js) зелёные.

- [ ] **Step 9: Commit**

```bash
git add extension/content.js extension/manifest.json
git commit -m "feat(drivers): свитчер водителя в панели + контекст планировщика"
```

---

## Task 8: popup — секция «Парк»

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [ ] **Step 1: Контейнер секции + подключить drivers.js в popup**

`extension/popup.html` — после `<div class="bd" id="account">...</div>` (стр. 31) добавить контейнер парка, и подключить `drivers.js` перед `popup.js`:

```html
  <div class="bd" id="account"><div class="empty">Аккаунт…</div></div>
  <div class="bd" id="fleet"></div>
  <script src="api.js"></script>
  <script src="hos.js"></script>
  <script src="drivers.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 2: Рендер секции «Парк»**

`extension/popup.js` — перед финальными вызовами (`renderSettings(); LLAPI.getMe()...`) добавить:

```javascript
// ---- парк водителей (виден залогиненному диспетчеру) ----
const fleetEl = document.getElementById("fleet");
const EQUIP = ["V", "R", "F", "SD", "PO"];

async function renderFleet() {
  const me = await LLAPI.getMe().catch(() => null);
  if (!me) { fleetEl.innerHTML = '<h4>Парк водителей</h4><div class="note">Войдите в аккаунт, чтобы вести своих водителей.</div>'; return; }
  let list = [];
  try { list = await LLAPI.getDrivers(); } catch { list = []; }
  fleetEl.innerHTML = '<h4>Парк водителей</h4>' +
    (list.length ? list.map(driverRow).join("") : '<div class="note">Пока нет водителей. Добавьте первого.</div>') +
    '<button id="drv-add">+ Добавить водителя</button>';
  list.forEach((d) => {
    fleetEl.querySelector(`[data-del="${d.id}"]`).onclick = async () => { await LLAPI.deleteDriver(d.id); renderFleet(); };
    fleetEl.querySelector(`[data-mkt="${d.id}"]`).onchange = (e) => saveField(d.id, "currentMarket", e.target.value.trim().toUpperCase());
    fleetEl.querySelector(`[data-eq="${d.id}"]`).onchange = (e) => saveField(d.id, "equipment", e.target.value || null);
  });
  document.getElementById("drv-add").onclick = addDriver;
}

function driverRow(d) {
  const opts = ['<option value="">—</option>'].concat(EQUIP.map((e) =>
    `<option value="${e}"${d.equipment === e ? " selected" : ""}>${e}</option>`)).join("");
  return `<div class="row"><span class="k">${escA(d.name)}</span>` +
    `<span><input data-mkt="${d.id}" type="text" value="${escA(d.currentMarket || "")}" placeholder="CHICAGO_IL" style="width:96px">` +
    `<select data-eq="${d.id}">${opts}</select>` +
    `<button data-del="${d.id}" title="Удалить" style="width:auto;margin:0 0 0 4px;padding:4px 8px">✕</button></span></div>`;
}

async function saveField(id, field, value) {
  try { await LLAPI.updateDriver(id, { [field]: value }); } catch (e) { alert(e.message); }
}

async function addDriver() {
  const name = prompt("Имя водителя:");
  if (!name || !name.trim()) return;
  try { await LLAPI.createDriver({ name: name.trim() }); renderFleet(); }
  catch (e) { alert(e.message); }
}
```

- [ ] **Step 3: Вызвать renderFleet при загрузке popup**

`extension/popup.js` — заменить последнюю строку
`LLAPI.getMe().then((u) => (u ? accRow(u) : accForm())).catch(() => accForm());` на:

```javascript
LLAPI.getMe().then((u) => (u ? accRow(u) : accForm())).catch(() => accForm()).finally(renderFleet);
```

- [ ] **Step 4: Проверить синтаксис**

Run: `cd /Users/bogdan/work/startup/dat.com && node --check extension/popup.js`
Expected: PASS.

- [ ] **Step 5: Ручная проверка popup (опционально)**

Загрузить расширение (`chrome://extensions` → Загрузить распакованное → `extension/`), открыть popup залогиненным: секция «Парк» показывает кнопку «+ Добавить водителя»; добавление по имени появляется в списке; правка рынка/прицепа сохраняется (перезагрузка popup показывает изменения); удаление убирает строку. Без логина — подсказка «Войдите в аккаунт».

- [ ] **Step 6: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(drivers): секция «Парк» в popup (CRUD водителей)"
```

---

## Task 9: Документация (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Описать модуль drivers в структуре backend**

`CLAUDE.md` — в блоке `backend/src/` (рядом со строкой `brokers/`) добавить строку:

```
  drivers/                  GET/POST/PATCH/DELETE /drivers — парк водителей диспетчера (JwtAuthGuard, скоуп userId, каскад от users)
```

- [ ] **Step 2: Описать extension drivers.js + конвенцию аноним-фолбэка**

`CLAUDE.md` — в блоке `extension/` добавить строку про `drivers.js`:

```
  drivers.js (LLDRV)        парк диспетчера: resolveDriverContext (чистая, выбор контекста планировщика) + per-device активный водитель (ll_active_driver)
```

И в раздел «Конвенции (важное)» добавить пункт:

```
- **Парк водителей** (`backend/drivers` + `extension/drivers.js`): диспетчер ведёт несколько
  водителей (имя/рынок/HOS/equipment/costPerMile/homeBase/status), профили на бэкенде под JWT.
  Активный водитель — per-device (`ll_active_driver`) — питает скоринг и цепочки через
  `LLDRV.resolveDriverContext`. **Без логина / при пустом парке — аноним-режим: текущее
  поведение (локальный `ll_hos`, авто-рынок выдачи).** Свитчер водителя — в шапке панели,
  CRUD парка — в popup. `homeBase` хранится, в скоринг пока не идёт (YAGNI).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: парк водителей (модуль drivers + LLDRV + аноним-фолбэк)"
```

---

## Task 10: Финальная верификация

- [ ] **Step 1: Полный прогон тестов проекта**

Run: `cd /Users/bogdan/work/startup/dat.com && npm test`
Expected: PASS — shared + extension (включая 4 теста drivers.test.js). `sync:shared` без изменений (мы не трогали `shared/`).

- [ ] **Step 2: Backend-тесты и сборка**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: PASS — компиляция чистая, все Jest-тесты зелёные (включая 6 drivers.service).

- [ ] **Step 3: Деплой**

Push в `main` → Coolify автодеплоит backend (новая таблица `drivers` создаётся `synchronize:true` при старте). Расширение — перезагрузить распакованное в Chrome.

```bash
git push origin main
```

Expected: деплой `finished`, `GET https://loadlens.krait.studio/healthz` → 200.

---

## Self-review (выполнено при написании плана)

- **Покрытие спеки:** модель/эндпоинты/изоляция userId (Task 1–4) ✓; `resolveDriverContext` + аноним-фолбэк + краевые случаи (Task 5) ✓; LLAPI CRUD (Task 6) ✓; свитчер + контекст + equipment-фильтр (Task 7) ✓; секция «Парк» popup (Task 8) ✓; каскад от users — FK `onDelete: CASCADE` (Task 1) ✓; YAGNI homeBase/status — поля есть, в скоринг не идут ✓.
- **Плейсхолдеры:** нет — весь код приведён целиком.
- **Согласованность типов:** `FRESH_HOS` (backend) / `LLDRV.FRESH` (extension) — оба `{remainingDrive,remainingOnDuty,remainingCycle}` в минутах; методы `getDrivers/createDriver/updateDriver/deleteDriver`, `resolveDriverContext/pickActive/getActiveId/setActive` — имена совпадают между определением (Task 5–6) и использованием (Task 7–8).
