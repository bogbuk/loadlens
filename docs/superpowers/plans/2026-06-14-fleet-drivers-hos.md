# Fleet Drivers + per-driver HOS + load↔driver matching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать диспетчеру вести парк водителей (имя/локация/прицеп/HOS) на сервере и показывать на каждом грузе, кому из парка он подходит (HOS-выполним, по прицепу, выгоден).

**Architecture:** Парк на бэкенде (NestJS+Sequelize, изоляция по `userId` из JWT, Pro-гейт). Матчинг груз↔водитель считается на клиенте чистой функцией `shared/fleet.js` (переиспользует `LLPLAN.stepHos` + `LLSCORE.netRpm`). Данные грузов на сервер не уходят.

**Tech Stack:** NestJS, sequelize-typescript, JWT (`@nestjs/jwt`), class-validator, MV3 content script (vanilla JS), node:test.

---

## File Structure

- Create `shared/fleet.js` — `LLFLEET.matchLoadToFleet(load, drivers, ctx)`; `shared/fleet.test.js`.
- Create `backend/src/drivers/{driver.model.ts, dto/driver.dto.ts, pro.guard.ts, drivers.service.ts, drivers.service.spec.ts, drivers.controller.ts, drivers.module.ts}`.
- Modify `backend/src/app.module.ts` (Driver model + DriversModule), `scripts/sync-shared.js` (fleet.js→vendor), `extension/manifest.json` (vendor/fleet.js), `extension/api.js` (driver methods), `extension/content.js` (fleet badge + breakdown + per-driver planner), `extension/popup.{html,js}` (fleet manager).

---

## Task 1: `shared/fleet.js` — матчер груз↔водитель

**Files:**
- Create: `shared/fleet.js`
- Test: `shared/fleet.test.js`

- [ ] **Step 1: Write the failing test**

```js
// shared/fleet.test.js
const test = require("node:test");
const assert = require("node:assert");
require("./scoring.js");   // LLSCORE
require("./planner.js");   // LLPLAN
const LLFLEET = require("./fleet.js");

const FRESH = { remainingDriveMin: 660, remainingDutyMin: 840, remainingCycleMin: 4200 };
const load = { originMarket: "CHICAGO_IL", destMarket: "ATLANTA_GA", equipment: "F",
               rate: 2000, loadedMiles: 700, deadheadMiles: 30 };
const dist = () => 0; // водитель уже на рынке отправления

test("матч: equipment совпал и HOS ок → feasible, попадает в best", () => {
  const drivers = [{ id: "d1", name: "Ivan", market: "CHICAGO_IL", equipment: "F", ...FRESH }];
  const r = LLFLEET.matchLoadToFleet(load, drivers, { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.feasibleCount, 1);
  assert.strictEqual(r.best.driverId, "d1");
  assert.strictEqual(r.matches[0].feasible, true);
});

test("прицеп не совпал → не feasible", () => {
  const drivers = [{ id: "d1", name: "Ivan", market: "CHICAGO_IL", equipment: "V", ...FRESH }];
  const r = LLFLEET.matchLoadToFleet(load, drivers, { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.feasibleCount, 0);
  assert.strictEqual(r.best, null);
  assert.strictEqual(r.matches[0].equipMatch, false);
});

test("исчерпанный цикл → HOS не feasible", () => {
  const drivers = [{ id: "d1", name: "Ivan", market: "CHICAGO_IL", equipment: "F",
                     remainingDriveMin: 660, remainingDutyMin: 840, remainingCycleMin: 60 }];
  const r = LLFLEET.matchLoadToFleet(load, drivers, { distance: dist, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.feasibleCount, 0);
  assert.strictEqual(r.matches[0].hosBadge, "red");
});

test("ранжирование: feasible выше нефизибл, затем по netRpm", () => {
  const drivers = [
    { id: "bad", name: "NoTrailer", market: "CHICAGO_IL", equipment: "V", ...FRESH },
    { id: "far", name: "Far", market: "DALLAS_TX", equipment: "F", ...FRESH },
    { id: "near", name: "Near", market: "CHICAGO_IL", equipment: "F", ...FRESH },
  ];
  const distByMarket = (a) => (a === "DALLAS_TX" ? 600 : 0); // far даёт большой deadhead
  const r = LLFLEET.matchLoadToFleet(load, drivers, { distance: distByMarket, dieselPrice: 4, costPerMile: 1.8 });
  assert.strictEqual(r.best.driverId, "near");        // меньше deadhead → выше netRpm
  assert.strictEqual(r.matches[r.matches.length - 1].driverId, "bad"); // нефизибл — в хвосте
});

test("пустой парк → best null, total 0", () => {
  const r = LLFLEET.matchLoadToFleet(load, [], { distance: dist });
  assert.deepStrictEqual(r, { matches: [], best: null, feasibleCount: 0, total: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/fleet.test.js`
Expected: FAIL — `Cannot find module './fleet.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// shared/fleet.js
/* LoadLens — матчер груз↔водитель (fleet). Zero-dep CommonJS (браузер+Node+тесты).
   Зависит от глобалов LLPLAN (stepHos/legMinutes) и LLSCORE (netRpm) — грузятся раньше. */
const LLFLEET = (() => {
  "use strict";

  function matchLoadToFleet(load, drivers, ctx = {}) {
    const distance = ctx.distance || (() => 0);
    const matches = (drivers || []).map((dr) => {
      const equipMatch = !!dr.equipment && dr.equipment === load.equipment;
      const deadhead = dr.market ? Math.round(distance(dr.market, load.originMarket)) : (load.deadheadMiles || 0);
      const driveMin = LLPLAN.legMinutes((load.loadedMiles || 0) + deadhead);
      const hosState = {
        remainingDrive: dr.remainingDriveMin, remainingOnDuty: dr.remainingDutyMin,
        remainingCycle: dr.remainingCycleMin,
      };
      const hos = LLPLAN.stepHos(hosState, driveMin, 120);
      const hosBadge = hos.feasible ? hos.badge : "red";
      const netRpm = LLSCORE.netRpm({ ...load, deadheadMiles: deadhead },
        { dieselPrice: ctx.dieselPrice, costPerMile: ctx.costPerMile });
      return { driverId: dr.id, name: dr.name, equipMatch, deadhead, hosBadge, netRpm,
               feasible: equipMatch && hos.feasible };
    });
    matches.sort((a, b) =>
      (Number(b.feasible) - Number(a.feasible)) || ((b.netRpm ?? -Infinity) - (a.netRpm ?? -Infinity)));
    const feasibleCount = matches.filter((m) => m.feasible).length;
    return { matches, best: feasibleCount ? matches[0] : null, feasibleCount, total: matches.length };
  }

  return { matchLoadToFleet };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLFLEET;
if (typeof globalThis !== "undefined") globalThis.LLFLEET = LLFLEET;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/fleet.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/fleet.js shared/fleet.test.js
git commit -m "feat(fleet): matchLoadToFleet — матчер груз↔водитель (HOS+equipment+netRpm)"
```

---

## Task 2: Завендорить fleet.js в расширение

**Files:**
- Modify: `scripts/sync-shared.js:14` (массив `FILES`)
- Modify: `extension/manifest.json` (content_scripts js)

- [ ] **Step 1: Добавить fleet.js в список синка**

В `scripts/sync-shared.js` найти `const FILES = ["load.model.js", "scoring.js", "planner.js"];`
и заменить на:

```js
const FILES = ["load.model.js", "scoring.js", "planner.js", "fleet.js"];
```

- [ ] **Step 2: Запустить синк**

Run: `npm run sync:shared`
Expected: вывод `synced 5 files -> extension/vendor/ + backend/shared/markets.seed.json`, появился `extension/vendor/fleet.js`.

- [ ] **Step 3: Подключить vendor/fleet.js в манифест**

В `extension/manifest.json`, в массиве `content_scripts[0].js`, после `"vendor/planner.js"` добавить строку `"vendor/fleet.js",` (порядок важен — fleet после planner/scoring):

```json
        "vendor/planner.js",
        "vendor/fleet.js",
        "vendor/markets.seed.js",
```

- [ ] **Step 4: Проверить манифест**

Run: `python3 -c "import json; json.load(open('extension/manifest.json')); print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-shared.js extension/manifest.json extension/vendor/fleet.js
git commit -m "build(fleet): vendor fleet.js в расширение + sync"
```

---

## Task 3: Backend — модель `Driver`

**Files:**
- Create: `backend/src/drivers/driver.model.ts`

- [ ] **Step 1: Создать модель**

```ts
// backend/src/drivers/driver.model.ts
import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'drivers',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'idx_driver_user', fields: ['user_id'] }],
})
export class Driver extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  market: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  equipment: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'remaining_drive_min', defaultValue: 660 })
  remainingDriveMin: number;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'remaining_duty_min', defaultValue: 840 })
  remainingDutyMin: number;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'remaining_cycle_min', defaultValue: 4200 })
  remainingCycleMin: number;

  @Column({ type: DataType.DATE, allowNull: true, field: 'hos_updated_at' })
  hosUpdatedAt: Date | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/drivers/driver.model.ts
git commit -m "feat(drivers): модель Driver (привязка к userId)"
```

---

## Task 4: Backend — DTO

**Files:**
- Create: `backend/src/drivers/dto/driver.dto.ts`

- [ ] **Step 1: Создать DTO**

```ts
// backend/src/drivers/dto/driver.dto.ts
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const EQUIP = ['V', 'R', 'F', 'SD', 'PO', 'HS'];

export class CreateDriverDto {
  @IsString() @MaxLength(80)
  name: string;

  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[A-Z0-9_]{1,80}$/, { message: 'market: CITY_ST' })
  market?: string;

  @IsIn(EQUIP)
  equipment: string;

  @IsOptional() @IsNumber() @Min(0) @Max(11) driveH?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(14) dutyH?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(70) cycleH?: number;
}

export class UpdateDriverDto extends CreateDriverDto {
  @IsOptional() @IsString() @MaxLength(80)
  declare name: string;

  @IsOptional() @IsIn(EQUIP)
  declare equipment: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/drivers/dto/driver.dto.ts
git commit -m "feat(drivers): DTO create/update"
```

---

## Task 5: Backend — Pro-гейт

**Files:**
- Create: `backend/src/drivers/pro.guard.ts`

- [ ] **Step 1: Создать ProGuard**

```ts
// backend/src/drivers/pro.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';

@Injectable()
export class ProGuard implements CanActivate {
  constructor(@InjectModel(User) private readonly users: typeof User) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    const user = userId ? await this.users.findByPk(userId) : null;
    if (!user || user.plan !== 'pro') throw new ForbiddenException('Парк водителей доступен в Pro');
    return true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/drivers/pro.guard.ts
git commit -m "feat(drivers): ProGuard — гейт парка по plan==='pro'"
```

---

## Task 6: Backend — сервис (CRUD с изоляцией по userId) + тест

**Files:**
- Create: `backend/src/drivers/drivers.service.ts`
- Test: `backend/src/drivers/drivers.service.spec.ts`

- [ ] **Step 1: Написать сервис**

```ts
// backend/src/drivers/drivers.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Driver } from './driver.model';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';

const h2m = (h?: number) => (h == null ? undefined : Math.round(h * 60));

@Injectable()
export class DriversService {
  constructor(@InjectModel(Driver) private readonly model: typeof Driver) {}

  list(userId: string) {
    return this.model.findAll({ where: { userId }, order: [['name', 'ASC']] });
  }

  create(userId: string, dto: CreateDriverDto) {
    return this.model.create({
      userId, name: dto.name, market: dto.market ?? null, equipment: dto.equipment,
      ...(dto.driveH != null ? { remainingDriveMin: h2m(dto.driveH) } : {}),
      ...(dto.dutyH != null ? { remainingDutyMin: h2m(dto.dutyH) } : {}),
      ...(dto.cycleH != null ? { remainingCycleMin: h2m(dto.cycleH) } : {}),
      hosUpdatedAt: new Date(),
    });
  }

  // владельца проверяем в where — чужого водителя метод не находит (изоляция тенанта)
  private async owned(userId: string, id: string): Promise<Driver> {
    const d = await this.model.findOne({ where: { id, userId } });
    if (!d) throw new NotFoundException('водитель не найден');
    return d;
  }

  async update(userId: string, id: string, dto: UpdateDriverDto) {
    const d = await this.owned(userId, id);
    if (dto.name != null) d.name = dto.name;
    if (dto.market !== undefined) d.market = dto.market ?? null;
    if (dto.equipment != null) d.equipment = dto.equipment;
    if (dto.driveH != null) d.remainingDriveMin = h2m(dto.driveH)!;
    if (dto.dutyH != null) d.remainingDutyMin = h2m(dto.dutyH)!;
    if (dto.cycleH != null) d.remainingCycleMin = h2m(dto.cycleH)!;
    if (dto.driveH != null || dto.dutyH != null || dto.cycleH != null) d.hosUpdatedAt = new Date();
    await d.save();
    return d;
  }

  async remove(userId: string, id: string) {
    const d = await this.owned(userId, id);
    await d.destroy();
    return { ok: true };
  }
}
```

- [ ] **Step 2: Написать тест (изоляция тенанта — ключевой)**

```ts
// backend/src/drivers/drivers.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { DriversService } from './drivers.service';

describe('DriversService', () => {
  it('list фильтрует по userId', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    await new DriversService({ findAll } as any).list('u1');
    expect(findAll.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('create конвертит часы в минуты и пишет userId', async () => {
    const create = jest.fn().mockResolvedValue({});
    await new DriversService({ create } as any).create('u1', { name: 'Ivan', equipment: 'F', driveH: 10 } as any);
    const row = create.mock.calls[0][0];
    expect(row.userId).toBe('u1');
    expect(row.remainingDriveMin).toBe(600);
  });

  it('изоляция: чужой водитель (findOne by id+userId не найден) → NotFound', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const svc = new DriversService({ findOne } as any);
    await expect(svc.update('attacker', 'someones-id', { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(findOne.mock.calls[0][0].where).toEqual({ id: 'someones-id', userId: 'attacker' });
  });

  it('update меняет поля владельца и сохраняет', async () => {
    const driver: any = { save: jest.fn() };
    const findOne = jest.fn().mockResolvedValue(driver);
    await new DriversService({ findOne } as any).update('u1', 'd1', { market: 'DALLAS_TX', cycleH: 70 } as any);
    expect(driver.market).toBe('DALLAS_TX');
    expect(driver.remainingCycleMin).toBe(4200);
    expect(driver.save).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Запустить тесты**

Run: `cd backend && npx jest src/drivers`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/src/drivers/drivers.service.ts backend/src/drivers/drivers.service.spec.ts
git commit -m "feat(drivers): сервис CRUD с изоляцией по userId + тесты"
```

---

## Task 7: Backend — контроллер + модуль + регистрация

**Files:**
- Create: `backend/src/drivers/drivers.controller.ts`, `backend/src/drivers/drivers.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Контроллер (JwtAuthGuard + ProGuard, userId из req.user)**

```ts
// backend/src/drivers/drivers.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from './pro.guard';
import { DriversService } from './drivers.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';

@Controller('drivers')
@UseGuards(JwtAuthGuard, ProGuard)
export class DriversController {
  constructor(private readonly service: DriversService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) { return this.service.list(req.user.userId); }

  @Post()
  create(@Req() req: { user: { userId: string } }, @Body() dto: CreateDriverDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Patch(':id')
  update(@Req() req: { user: { userId: string } }, @Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.service.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.service.remove(req.user.userId, id);
  }
}
```

- [ ] **Step 2: Модуль**

```ts
// backend/src/drivers/drivers.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtModule } from '@nestjs/jwt';
import { Driver } from './driver.model';
import { User } from '../users/user.model';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from './pro.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([Driver, User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [DriversController],
  providers: [DriversService, JwtAuthGuard, ProGuard],
})
export class DriversModule {}
```

- [ ] **Step 3: Зарегистрировать в app.module**

В `backend/src/app.module.ts`:
- импорт: добавить `import { Driver } from './drivers/driver.model';` и `import { DriversModule } from './drivers/drivers.module';`
- в `models: [...]` добавить `Driver`
- в `imports: [...]` добавить `DriversModule`

- [ ] **Step 4: Сборка + тесты**

Run: `cd backend && npm run build && npm test`
Expected: build ок, все тесты PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/drivers/drivers.controller.ts backend/src/drivers/drivers.module.ts backend/src/app.module.ts
git commit -m "feat(drivers): контроллер CRUD под JwtAuthGuard+ProGuard, регистрация модуля"
```

---

## Task 8: Extension — driver-методы в `api.js`

**Files:**
- Modify: `extension/api.js`

- [ ] **Step 1: Добавить методы (авто-refresh как в getMe)**

В `extension/api.js`, перед `return { ... }`, добавить:

```js
  async function authedJson(path, method, body) {
    let auth = await getAuth();
    if (!auth) return null;
    const call = (a) => fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.accessToken}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    try {
      let res = await call(auth);
      if (res.status === 401) { auth = await refreshTokens(auth); if (!auth) return null; res = await call(auth); }
      if (!res.ok) return null;
      return method === "DELETE" ? true : res.json();
    } catch { return null; }
  }
  const getDrivers = () => authedJson("/drivers", "GET");
  const createDriver = (d) => authedJson("/drivers", "POST", d);
  const updateDriver = (id, d) => authedJson(`/drivers/${encodeURIComponent(id)}`, "PATCH", d);
  const deleteDriver = (id) => authedJson(`/drivers/${encodeURIComponent(id)}`, "DELETE");
```

И в объект `return { ... }` добавить: `getDrivers, createDriver, updateDriver, deleteDriver,`.

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check extension/api.js`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add extension/api.js
git commit -m "feat(fleet): driver CRUD методы в LLAPI (авто-refresh)"
```

---

## Task 9: Extension — fleet-бейдж на грузе + разбивка в детали

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/styles.css`

- [ ] **Step 1: Загрузка парка + кэш (content.js)**

Рядом с другими кэшами (после `let gqlLoads = [];`) добавить:

```js
  let fleet = [];                 // парк водителя (Pro), из backend
```

В `boot()` (после загрузки cpm) добавить загрузку парка:

```js
    if (typeof LLAPI !== "undefined") {
      try { const f = await LLAPI.getDrivers(); if (Array.isArray(f)) fleet = f; } catch { /* free/нет сети */ }
    }
```

- [ ] **Step 2: Fleet-чип в `badgeRow` (после crowd/detail чипов)**

В `badgeRow`, перед `anchorEl.appendChild(host);`, добавить:

```js
    if (fleet.length && typeof LLFLEET !== "undefined") {
      const m = LLFLEET.matchLoadToFleet(load, fleet,
        { distance: (a, b) => LLGEO.sync(a, b), dieselPrice, costPerMile });
      const lvl = m.best ? m.best.hosBadge : "thin";
      const txt = m.best ? `👤 ${m.best.name} (${m.feasibleCount}/${m.total})` : `👤 нет (0/${m.total})`;
      const fc = chip(txt, "ll-fleet ll-" + (lvl === "green" ? "good" : lvl === "amber" ? "ok" : lvl === "red" ? "risk" : "thin"));
      fc.style.cursor = "pointer";
      fc.title = m.matches.map((x) => `${x.name}: ${x.equipMatch ? "" : "прицеп≠ · "}HOS ${x.hosBadge}${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`).join("\n");
      fc.addEventListener("click", (e) => { e.stopPropagation(); openLoadDetail(load); });
      host.appendChild(fc);
    }
```

- [ ] **Step 3: Секция «Кому подходит» в карточке детали (`openLoadDetail`)**

В `openLoadDetail`, перед блоком `// действия`, добавить:

```js
    if (fleet.length && typeof LLFLEET !== "undefined") {
      const m = LLFLEET.matchLoadToFleet(load, fleet, { distance: (a, b) => LLGEO.sync(a, b), dieselPrice, costPerMile });
      const wrap = document.createElement("div"); wrap.className = "fleet-match";
      const h = document.createElement("div"); h.className = "fleet-h"; h.textContent = `Кому подходит (${m.feasibleCount}/${m.total})`;
      wrap.appendChild(h);
      m.matches.forEach((x) => {
        const r = document.createElement("div"); r.className = "fleet-row ll-" + (x.feasible ? "ok" : "no");
        r.textContent = `${x.feasible ? "✓" : "✕"} ${x.name} · HOS ${x.hosBadge}` +
          `${x.equipMatch ? "" : " · прицеп≠"} · DH ${x.deadhead}mi` +
          `${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`;
        wrap.appendChild(r);
      });
      bd.appendChild(wrap);
    }
```

- [ ] **Step 4: Стили**

В `extension/styles.css` добавить:

```css
.ll-fleet { font-weight: 700; user-select: none; }
.ll-fleet.ll-good { background: #dcfce7; color: #166534; }
.ll-fleet.ll-ok   { background: #fef9c3; color: #854d0e; }
.ll-fleet.ll-risk { background: #fee2e2; color: #991b1b; }
.ll-fleet.ll-thin { background: #f1f5f9; color: #64748b; }
#ll-detail .fleet-match { margin-top: 10px; border-top: 1px solid #eef1f4; padding-top: 8px; }
#ll-detail .fleet-h { font-weight: 700; color: #1e3a8a; margin-bottom: 4px; }
#ll-detail .fleet-row { padding: 3px 0; font-size: 12.5px; }
#ll-detail .fleet-row.ll-ok { color: #166534; }
#ll-detail .fleet-row.ll-no { color: #94a3b8; }
```

- [ ] **Step 5: Проверка**

Run: `node --check extension/content.js && python3 -c "import json;json.load(open('extension/manifest.json'));print('ok')"`
Expected: без ошибок, `ok`.

- [ ] **Step 6: Commit**

```bash
git add extension/content.js extension/styles.css
git commit -m "feat(fleet): чип лучшего водителя на грузе + разбивка по парку в детали"
```

---

## Task 10: Extension — менеджер парка в попапе (Pro)

**Files:**
- Modify: `extension/popup.html`, `extension/popup.js`

- [ ] **Step 1: Контейнер в popup.html**

В `extension/popup.html`, после `<div class="bd" id="settings"></div>`, добавить:

```html
  <div class="bd" id="fleet"></div>
```

- [ ] **Step 2: Рендер парка в popup.js**

В конце `extension/popup.js`, перед `renderSettings();`, добавить функцию и вызов:

```js
const EQUIP = ["V", "R", "F", "SD", "PO", "HS"];
const fleetEl = document.getElementById("fleet");
async function renderFleet() {
  const me = await LLAPI.getMe().catch(() => null);
  if (!me || me.plan !== "pro") { fleetEl.innerHTML = '<h4>Парк водителей</h4><div class="note">Доступно в Pro.</div>'; return; }
  const drivers = (await LLAPI.getDrivers().catch(() => null)) || [];
  fleetEl.innerHTML = "<h4>Парк водителей</h4>";
  drivers.forEach((d) => {
    const row = document.createElement("div"); row.className = "row";
    const who = document.createElement("span"); who.className = "k";
    who.textContent = `${d.name} · ${d.equipment}${d.market ? " · " + d.market : ""}`;
    const del = document.createElement("button"); del.textContent = "✕"; del.style.width = "auto"; del.style.margin = "0";
    del.onclick = async () => { await LLAPI.deleteDriver(d.id); renderFleet(); };
    row.append(who, del); fleetEl.appendChild(row);
  });
  const add = document.createElement("div"); add.className = "acc";
  add.innerHTML =
    '<input id="d-name" placeholder="имя">' +
    '<input id="d-market" placeholder="рынок, напр. CHICAGO_IL">' +
    '<input id="d-equip" placeholder="прицеп V/R/F" value="V">' +
    '<div class="row"><span class="k">drive/duty/cycle ч</span></div>' +
    '<input id="d-drive" type="number" placeholder="11"><input id="d-duty" type="number" placeholder="14"><input id="d-cycle" type="number" placeholder="70">' +
    '<button id="d-add">Добавить водителя</button>';
  fleetEl.appendChild(add);
  document.getElementById("d-add").onclick = async () => {
    const name = document.getElementById("d-name").value.trim();
    const equipment = document.getElementById("d-equip").value.trim().toUpperCase();
    if (!name || !EQUIP.includes(equipment)) { alert("Имя и валидный прицеп (V/R/F/SD/PO/HS) обязательны."); return; }
    await LLAPI.createDriver({
      name, equipment,
      market: document.getElementById("d-market").value.trim().toUpperCase() || undefined,
      driveH: numOrU("d-drive"), dutyH: numOrU("d-duty"), cycleH: numOrU("d-cycle"),
    });
    renderFleet();
  };
}
function numOrU(id) { const v = parseFloat(document.getElementById(id).value); return Number.isFinite(v) ? v : undefined; }
renderFleet();
```

- [ ] **Step 3: Проверка синтаксиса**

Run: `node --check extension/popup.js`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(fleet): менеджер парка в попапе (Pro): список + добавить/удалить"
```

---

## Task 11: Extension — get-out планировщик по парку

**Files:**
- Modify: `extension/content.js`

- [ ] **Step 1: Прогон планировщика по каждому водителю**

В `content.js`, в `render()`, заменить строку построения цепочек:

```js
    const chains = buildChains(chainPool(loads), start).filter((c) => c.legs.length >= 1);
```

на прогон по парку (если он есть), иначе старое поведение:

```js
    let chains;
    if (fleet.length) {
      chains = [];
      fleet.forEach((dr) => {
        if (!dr.market) return;
        const hos = { remainingDrive: dr.remainingDriveMin, remainingOnDuty: dr.remainingDutyMin, remainingCycle: dr.remainingCycleMin };
        const dch = LLPLAN.plan({
          start: { market: dr.market }, hosState: hos, loads: chainPool(loads),
          distance: (a, b) => LLGEO.sync(a, b), marketStrength: strengthOf,
          equipment: dr.equipment, dieselPrice, costPerMile, maxLegs: 3, topN: 2,
        });
        dch.forEach((c) => { c.driverName = dr.name; chains.push(c); });
      });
      chains.sort((a, b) => b.rank - a.rank);
      chains = chains.slice(0, 5);
    } else {
      chains = buildChains(chainPool(loads), start).filter((c) => c.legs.length >= 1);
    }
```

- [ ] **Step 2: Показать имя водителя в строке цепочки**

В функции `chainRow(c)`, в строку `.meta`, добавить подпись водителя. Заменить тело `chainRow` на:

```js
  function chainRow(c) {
    const path = c.legs.map((l) => l.origin).concat(c.finalMarket);
    const badge = c.hosBadge === "green" ? "✓" : c.hosBadge === "amber" ? "!" : "✕";
    const who = c.driverName ? esc(c.driverName) + " · " : "";
    return `<div class="chain ll-${c.hosBadge}">` +
      `<div class="route">${esc(path.join(" → "))}</div>` +
      `<div class="meta">${who}$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ${c.totalMiles}mi · HOS ${badge}</div></div>`;
  }
```

- [ ] **Step 3: Проверка**

Run: `node --check extension/content.js`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat(fleet): get-out цепочки прогоняются по парку (по водителю + equipment)"
```

---

## Task 12: Полная проверка + деплой

- [ ] **Step 1: Все тесты**

Run (из корня): `npm run sync:shared && node --test shared/*.test.js extension/*.test.js extension/adapters/*.test.js && (cd backend && npm test)`
Expected: всё PASS (shared включает fleet.test, backend включает drivers.spec).

- [ ] **Step 2: Деплой (push в main → автодеплой Coolify)**

```bash
git push origin main
```
Подождать ~110с, проверить `coolify --context yoolip999 app deployments list hiooby9kgzj8i79ycl33drec` → последний `finished`.

- [ ] **Step 3: E2E на проде — изоляция тенантов (критично)**

```bash
B=https://loadlens.krait.studio/api/v1
# два Pro-аккаунта
for e in fleetA@test.md fleetB@test.md; do
  curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$e\",\"password\":\"password1\"}" >/dev/null
  curl -s -X PATCH "$B/admin/users/$e/plan" -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d '{"plan":"pro"}' >/dev/null
done
TA=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"fleetA@test.md","password":"password1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
TB=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"fleetB@test.md","password":"password1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
# A создаёт водителя
DID=$(curl -s -X POST $B/drivers -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' -d '{"name":"Ivan","equipment":"F","market":"CHICAGO_IL","driveH":11,"dutyH":14,"cycleH":70}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "A видит своих:"; curl -s $B/drivers -H "Authorization: Bearer $TA"
echo "B НЕ видит водителя A (ожидаем []):"; curl -s $B/drivers -H "Authorization: Bearer $TB"
echo "B НЕ может изменить водителя A (ожидаем 404):"; curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $B/drivers/$DID -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"name":"hacked"}'
```
Expected: A видит [Ivan]; B видит []; PATCH от B → 404.

- [ ] **Step 4: E2E — Pro-гейт**

```bash
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"email":"free1@test.md","password":"password1"}' >/dev/null
TF=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"free1@test.md","password":"password1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
echo "Free → 403 на парк:"; curl -s -o /dev/null -w "%{http_code}\n" $B/drivers -H "Authorization: Bearer $TF"
```
Expected: `403`.

- [ ] **Step 5: Manual smoke в расширении**

Войти Pro-аккаунтом в попапе → добавить водителя (имя/рынок/прицеп/часы) → открыть `one.dat.com/search-loads` → убедиться, что на строках появился чип `👤 Имя (N/M)`, клик открывает разбивку «Кому подходит», get-out цепочки подписаны водителем.

---

## Заметки по реализации

- `shared/fleet.js` зависит от `LLPLAN`/`LLSCORE` — в тесте `require` их раньше; в манифесте порядок vendor: load.model → scoring → planner → **fleet** → markets.seed.
- Изоляция тенанта — единственный по-настоящему критичный инвариант: каждый сервис-метод фильтрует по `userId`, контроллер берёт его строго из `req.user.userId` (JWT), не из тела/параметров. E2E (Task 12.3) это проверяет.
- `cost/mile` остаётся аккаунт-глобальным (из `ll_cpm`); per-driver — вне MVP.
- Free-поведение не ломается: при пустом `fleet` (Free или нет водителей) бейджи/планировщик работают как раньше (единичный HOS).
