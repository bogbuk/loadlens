# Premium-only чтение бэкенда — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ограничить read-эндпоинты бэкенда так, чтобы крауд-данные читались только при валидном API-KEY (ENV-список) или Pro-JWT; расширение шлёт Bearer.

**Architecture:** Новый `PremiumReadGuard` (в `backend/src/common/`) пропускает запрос при валидном `X-API-Key` из ENV `API_KEYS` ИЛИ при Pro-JWT (`plan==='pro'`). Вешается только на GET-чтение через общий `CommonAuthModule` (даёт гарду `JwtService` + модель `User`). Расширение добавляет `Authorization: Bearer` к read-вызовам.

**Tech Stack:** NestJS + Sequelize + `@nestjs/jwt`, Jest (юнит-тесты по образцу `src/auth/admin.guard.spec.ts`), MV3-расширение (vanilla JS, `node:test`).

## Global Constraints

- Read-гейт пропускает при: **(B)** `X-API-Key` ∈ набора из ENV `API_KEYS` (split по запятой, trim, без пустых), ИЛИ **(A)** `Authorization: Bearer` с `payload.type==='access'` и `User.plan==='pro'`. Иначе — `ForbiddenException` (403).
- Ключи **только** в ENV `API_KEYS` (через запятую). Реальный ключ **никогда** не коммитить; `.env.example` — пустой `API_KEYS=`.
- Гард — **только на GET-чтение**: `lanes`(оба GET), `markets/:m/strength`, `loads`(`GET near`,`GET`), `geo/distance`, `rates`, `brokers/:mc/reputation`. POST-инжест (`POST /loads`, `POST /brokers/reports`) — **без гарда**. `auth`/`users`/`drivers`/`telegram` — не трогать.
- JWT-секрет: `process.env.JWT_SECRET || 'dev-secret'` (как в `AuthModule`/`UsersModule`).
- Заголовки: `X-API-Key`, `Authorization: Bearer <token>`.
- Гард-тест — по стилю `src/auth/admin.guard.spec.ts` (прямая инстанциация, мок `ExecutionContext`).
- Коммиты на русском, без упоминаний AI/Claude.

---

### Task 1: ENV-набор API-ключей (`api-keys.ts`) + `.env.example`

**Files:**
- Create: `backend/src/common/api-keys.ts`
- Test: `backend/src/common/api-keys.spec.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces:
  - `parseApiKeys(): Set<string>` — набор валидных ключей из `process.env.API_KEYS`.
  - `isValidApiKey(key: string | undefined | null): boolean` — членство в наборе; `false` для пусто/undefined.

- [ ] **Step 1: Написать падающий тест**

Создать `backend/src/common/api-keys.spec.ts`:

```ts
import { parseApiKeys, isValidApiKey } from './api-keys';

describe('api-keys', () => {
  afterEach(() => { delete process.env.API_KEYS; });

  it('парсит список через запятую, trim, отбрасывает пустые', () => {
    process.env.API_KEYS = ' k1 , k2,, k3 ,';
    expect([...parseApiKeys()].sort()).toEqual(['k1', 'k2', 'k3']);
  });

  it('незаданная переменная → пустой набор', () => {
    expect(parseApiKeys().size).toBe(0);
  });

  it('isValidApiKey: членство в наборе', () => {
    process.env.API_KEYS = 'abc,def';
    expect(isValidApiKey('abc')).toBe(true);
    expect(isValidApiKey('xyz')).toBe(false);
  });

  it('isValidApiKey: пусто/undefined → false', () => {
    process.env.API_KEYS = 'abc';
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey('')).toBe(false);
  });

  it('пустой API_KEYS → любой ключ невалиден', () => {
    process.env.API_KEYS = '';
    expect(isValidApiKey('abc')).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd backend && npx jest src/common/api-keys.spec.ts`
Expected: FAIL — `Cannot find module './api-keys'`

- [ ] **Step 3: Реализация**

Создать `backend/src/common/api-keys.ts`:

```ts
// Набор валидных API-ключей для Premium-чтения. Источник — ENV API_KEYS (через запятую).
export function parseApiKeys(): Set<string> {
  return new Set(
    String(process.env.API_KEYS || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  );
}

export function isValidApiKey(key: string | undefined | null): boolean {
  return !!key && parseApiKeys().has(key);
}
```

- [ ] **Step 4: Запустить тест — зелёный**

Run: `cd backend && npx jest src/common/api-keys.spec.ts`
Expected: PASS (5 тестов)

- [ ] **Step 5: Документировать ENV**

В `backend/.env.example`, сразу после строки `ADMIN_KEY=`, добавить:

```
# Premium-чтение: список валидных API-ключей через запятую (заголовок X-API-Key).
# Пусто → крауд-данные читает только Pro-JWT. Реальные ключи держать в Coolify, не в репозитории.
API_KEYS=
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/api-keys.ts backend/src/common/api-keys.spec.ts backend/.env.example
git commit -m "feat(backend): ENV-набор API-ключей для Premium-чтения (parseApiKeys/isValidApiKey)"
```

---

### Task 2: `PremiumReadGuard` + `CommonAuthModule`

**Files:**
- Create: `backend/src/common/premium-read.guard.ts`
- Create: `backend/src/common/common-auth.module.ts`
- Test: `backend/src/common/premium-read.guard.spec.ts`

**Interfaces:**
- Consumes: `isValidApiKey` (Task 1); `User` модель (`backend/src/users/user.model.ts`, поле `plan`); `JwtService.verifyAsync`.
- Produces:
  - `PremiumReadGuard` (CanActivate, async) — конструктор `(@InjectModel(User) users, jwt: JwtService)`.
  - `CommonAuthModule` — провайдит и экспортит `PremiumReadGuard` (импортирует `SequelizeModule.forFeature([User])` + `JwtModule.register({ secret })`).

- [ ] **Step 1: Написать падающий тест**

Создать `backend/src/common/premium-read.guard.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { PremiumReadGuard } from './premium-read.guard';

const ctx = (headers: any): any => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
});
const usersWith = (user: any): any => ({ findByPk: jest.fn().mockResolvedValue(user) });
const jwtVerifying = (payload: any): any => ({ verifyAsync: jest.fn().mockResolvedValue(payload) });
const jwtRejecting = (): any => ({ verifyAsync: jest.fn().mockRejectedValue(new Error('bad')) });

describe('PremiumReadGuard', () => {
  afterEach(() => { delete process.env.API_KEYS; });

  it('валидный X-API-Key → пропуск (JWT не трогаем)', async () => {
    process.env.API_KEYS = 'good-key';
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({ 'x-api-key': 'good-key' }))).resolves.toBe(true);
  });

  it('неизвестный X-API-Key без Bearer → 403', async () => {
    process.env.API_KEYS = 'good-key';
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({ 'x-api-key': 'nope' }))).rejects.toThrow(ForbiddenException);
  });

  it('Pro-JWT без ключа → пропуск, req.user выставлен', async () => {
    const req: any = { headers: { authorization: 'Bearer t' } };
    const g = new PremiumReadGuard(usersWith({ plan: 'pro' }), jwtVerifying({ sub: 'u1', type: 'access' }));
    const c: any = { switchToHttp: () => ({ getRequest: () => req }) };
    await expect(g.canActivate(c)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'u1' });
  });

  it('access-JWT, но план не pro → 403', async () => {
    const g = new PremiumReadGuard(usersWith({ plan: 'free' }), jwtVerifying({ sub: 'u1', type: 'access' }));
    await expect(g.canActivate(ctx({ authorization: 'Bearer t' }))).rejects.toThrow(ForbiddenException);
  });

  it('refresh-токен (type!=access) → 403', async () => {
    const g = new PremiumReadGuard(usersWith({ plan: 'pro' }), jwtVerifying({ sub: 'u1', type: 'refresh' }));
    await expect(g.canActivate(ctx({ authorization: 'Bearer t' }))).rejects.toThrow(ForbiddenException);
  });

  it('пустой API_KEYS + любой X-API-Key → 403', async () => {
    process.env.API_KEYS = '';
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({ 'x-api-key': 'whatever' }))).rejects.toThrow(ForbiddenException);
  });

  it('ни ключа, ни токена → 403', async () => {
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({}))).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd backend && npx jest src/common/premium-read.guard.spec.ts`
Expected: FAIL — `Cannot find module './premium-read.guard'`

- [ ] **Step 3: Реализация гарда**

Создать `backend/src/common/premium-read.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/user.model';
import { isValidApiKey } from './api-keys';

// Гейт чтения крауд-данных: пропуск при валидном X-API-Key (ENV API_KEYS) ИЛИ Pro-JWT (plan==='pro').
@Injectable()
export class PremiumReadGuard implements CanActivate {
  constructor(
    @InjectModel(User) private readonly users: typeof User,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // (B) API-KEY = пропуск
    const apiKey = req.headers['x-api-key'];
    if (isValidApiKey(typeof apiKey === 'string' ? apiKey : undefined)) return true;

    // (A) Pro-JWT
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        const payload: { sub: string; type: string } = await this.jwt.verifyAsync(token);
        if (payload.type === 'access') {
          const user = await this.users.findByPk(payload.sub);
          if (user && user.plan === 'pro') {
            req.user = { userId: payload.sub };
            return true;
          }
        }
      } catch { /* невалидный токен → ниже 403 */ }
    }

    throw new ForbiddenException('Premium-доступ к чтению требует Pro-аккаунт или API-ключ');
  }
}
```

- [ ] **Step 4: Реализация модуля**

Создать `backend/src/common/common-auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { PremiumReadGuard } from './premium-read.guard';

// Общий модуль для PremiumReadGuard: даёт ему JwtService + модель User. Импортируется read-модулями.
@Module({
  imports: [
    SequelizeModule.forFeature([User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  providers: [PremiumReadGuard],
  exports: [PremiumReadGuard],
})
export class CommonAuthModule {}
```

- [ ] **Step 5: Запустить тест — зелёный**

Run: `cd backend && npx jest src/common/premium-read.guard.spec.ts`
Expected: PASS (7 тестов)

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/premium-read.guard.ts backend/src/common/common-auth.module.ts backend/src/common/premium-read.guard.spec.ts
git commit -m "feat(backend): PremiumReadGuard (Pro-JWT или API-KEY) + CommonAuthModule"
```

---

### Task 3: Навесить гард на read-эндпоинты + wiring модулей

**Files:**
- Modify: `backend/src/lanes/lanes.controller.ts`, `backend/src/lanes/lanes.module.ts`
- Modify: `backend/src/markets/markets.controller.ts`, `backend/src/markets/markets.module.ts`
- Modify: `backend/src/geo/geo.controller.ts`, `backend/src/geo/geo.module.ts`
- Modify: `backend/src/rates/rates.controller.ts`, `backend/src/rates/rates.module.ts`
- Modify: `backend/src/loads/loads.controller.ts`, `backend/src/loads/loads.module.ts`
- Modify: `backend/src/brokers/brokers.controller.ts`, `backend/src/brokers/brokers.module.ts`

**Interfaces:**
- Consumes: `PremiumReadGuard`, `CommonAuthModule` (Task 2).
- Produces: ничего для следующих задач.

Паттерн на каждый модуль — добавить `CommonAuthModule` в `imports`; на контроллер — `@UseGuards(PremiumReadGuard)` (на классе для чистых GET-контроллеров; на методе — для смешанных с POST).

- [ ] **Step 1: lanes (контроллер-уровень)**

`backend/src/lanes/lanes.controller.ts` — в импорт `@nestjs/common` добавить `UseGuards`, импортировать гард, повесить на класс:

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LanesService } from './lanes.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

@SkipThrottle()
@UseGuards(PremiumReadGuard)
@Controller('lanes')
export class LanesController {
```

`backend/src/lanes/lanes.module.ts` — добавить импорт модуля:

```ts
import { Module } from '@nestjs/common';
import { LanesService } from './lanes.service';
import { LanesController } from './lanes.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [CommonAuthModule],
  controllers: [LanesController],
  providers: [LanesService],
})
export class LanesModule {}
```

- [ ] **Step 2: markets (контроллер-уровень)**

`backend/src/markets/markets.controller.ts`:

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { MarketsService } from './markets.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

@UseGuards(PremiumReadGuard)
@Controller('markets')
export class MarketsController {
```

(Сохранить существующие декораторы методов; если в импортах нет `Param`/др. — не удалять имеющееся, только добавить `UseGuards`.)

`backend/src/markets/markets.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MarketsService } from './markets.service';
import { MarketsController } from './markets.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [CommonAuthModule],
  controllers: [MarketsController],
  providers: [MarketsService],
})
export class MarketsModule {}
```

- [ ] **Step 3: geo (контроллер-уровень)**

`backend/src/geo/geo.controller.ts` — добавить `UseGuards` в импорт `@nestjs/common`, импортировать гард, повесить `@UseGuards(PremiumReadGuard)` на класс `GeoController` (над `@Controller('geo')`).

`backend/src/geo/geo.module.ts` — добавить `CommonAuthModule` в существующий массив `imports` (рядом с `SequelizeModule.forFeature([LaneDistance])`):

```ts
import { CommonAuthModule } from '../common/common-auth.module';
// ...
  imports: [SequelizeModule.forFeature([LaneDistance]), CommonAuthModule],
```

- [ ] **Step 4: rates (контроллер-уровень)**

`backend/src/rates/rates.controller.ts`:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { RatesService } from './rates.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

@UseGuards(PremiumReadGuard)
@Controller('rates')
export class RatesController {
```

`backend/src/rates/rates.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [CommonAuthModule],
  controllers: [RatesController],
  providers: [RatesService],
})
export class RatesModule {}
```

- [ ] **Step 5: loads (метод-уровень — только GET, НЕ POST)**

`backend/src/loads/loads.controller.ts` — добавить `UseGuards` в импорт `@nestjs/common`, импортировать гард, повесить `@UseGuards(PremiumReadGuard)` на методы `near` и `byOrigin` (НЕ на `ingest`):

```ts
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LoadsService } from './loads.service';
import { IngestLoadsDto } from './dto/ingest.dto';
import { PremiumReadGuard } from '../common/premium-read.guard';

@Controller('loads')
export class LoadsController {
  constructor(private readonly service: LoadsService) {}

  @Post()
  ingest(@Body() dto: IngestLoadsDto) {
    return this.service.ingest(dto);
  }

  @SkipThrottle()
  @UseGuards(PremiumReadGuard)
  @Get('near')
  near(
```

…и аналогично `@UseGuards(PremiumReadGuard)` над `@Get()` метода `byOrigin` (под его `@SkipThrottle()`). `ingest` остаётся без гарда.

`backend/src/loads/loads.module.ts` — добавить `CommonAuthModule` в существующий `imports`:

```ts
import { CommonAuthModule } from '../common/common-auth.module';
// ...
  imports: [SequelizeModule.forFeature([Load]), CommonAuthModule],
```

- [ ] **Step 6: brokers (метод-уровень — только GET reputation, НЕ POST reports)**

`backend/src/brokers/brokers.controller.ts` — добавить `UseGuards` в импорт, импортировать гард, повесить `@UseGuards(PremiumReadGuard)` на метод `reputation` (под его `@SkipThrottle()`), НЕ на `report`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BrokersService } from './brokers.service';
import { ReportDto } from './dto/report.dto';
import { PremiumReadGuard } from '../common/premium-read.guard';
// ...
  @SkipThrottle()
  @UseGuards(PremiumReadGuard)
  @Get(':mc/reputation')
  reputation(@Param('mc') mc: string) {
```

`backend/src/brokers/brokers.module.ts` — добавить `CommonAuthModule` в существующий `imports`:

```ts
import { CommonAuthModule } from '../common/common-auth.module';
// ...
  imports: [SequelizeModule.forFeature([BrokerReport]), CommonAuthModule],
```

- [ ] **Step 7: Сборка — DI и типы резолвятся**

Run: `cd backend && npm run build`
Expected: успешная сборка (`nest build` без ошибок). Ошибка резолва провайдера/типа здесь всплывёт.

- [ ] **Step 8: Юнит-тесты зелёные (регресс)**

Run: `cd backend && npm test`
Expected: PASS (все сервис/гард-спеки, включая новые из Task 1–2).

- [ ] **Step 9: Commit**

```bash
git add backend/src/lanes backend/src/markets backend/src/geo backend/src/rates backend/src/loads backend/src/brokers
git commit -m "feat(backend): Premium-гард на read-эндпоинты (lanes/markets/geo/rates/loads-GET/brokers-GET)"
```

---

### Task 4: Расширение — Bearer на read-вызовах (`api.js`)

**Files:**
- Modify: `extension/api.js` (новый `authHeader()` + 7 read-функций)

**Interfaces:**
- Consumes: существующий `getAuth()` (возвращает `{ accessToken, ... } | null`).
- Produces: ничего для следующих задач.

- [ ] **Step 1: Добавить хелпер `authHeader()`**

В `extension/api.js`, сразу после `async function logout() { ... }` (рядом с `getAuth`/`setAuth`), добавить:

```js
  // Bearer для read-вызовов: Premium-чтение требует Pro-JWT. Не залогинен → пустой заголовок → 403 → фолбэк.
  async function authHeader() {
    const a = await getAuth();
    return a && a.accessToken ? { Authorization: `Bearer ${a.accessToken}` } : {};
  }
```

(Объявления функций хойстятся в области IIFE, поэтому `authHeader` можно звать из read-функций, объявленных выше по файлу.)

- [ ] **Step 2: `getLane` — добавить заголовок**

Заменить строку fetch в `getLane`:

```js
      const res = await fetch(`${BASE}/lanes/${encodeURIComponent(origin)}/${encodeURIComponent(dest)}${q}`);
```
на:
```js
      const res = await fetch(`${BASE}/lanes/${encodeURIComponent(origin)}/${encodeURIComponent(dest)}${q}`, { headers: await authHeader() });
```

- [ ] **Step 3: `getLoadsByOrigin`**

Заменить:
```js
      const res = await fetch(`${BASE}/loads?origin=${encodeURIComponent(market)}${q}`);
```
на:
```js
      const res = await fetch(`${BASE}/loads?origin=${encodeURIComponent(market)}${q}`, { headers: await authHeader() });
```

- [ ] **Step 4: `getLoadsNear`**

Заменить:
```js
      const res = await fetch(`${BASE}/loads/near?${q.toString()}`);
```
на:
```js
      const res = await fetch(`${BASE}/loads/near?${q.toString()}`, { headers: await authHeader() });
```

- [ ] **Step 5: `getBrokerReputation`**

Заменить:
```js
      const res = await fetch(`${BASE}/brokers/${encodeURIComponent(mc)}/reputation`);
```
на:
```js
      const res = await fetch(`${BASE}/brokers/${encodeURIComponent(mc)}/reputation`, { headers: await authHeader() });
```

- [ ] **Step 6: `getMarket`**

Заменить:
```js
      const res = await fetch(`${BASE}/markets/${encodeURIComponent(market)}/strength`);
```
на:
```js
      const res = await fetch(`${BASE}/markets/${encodeURIComponent(market)}/strength`, { headers: await authHeader() });
```

- [ ] **Step 7: `getDistance`**

Заменить:
```js
      const res = await fetch(`${BASE}/geo/distance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
```
на:
```js
      const res = await fetch(`${BASE}/geo/distance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: await authHeader() });
```

- [ ] **Step 8: `getDiesel` (вызов `/rates`)**

Заменить:
```js
      const res = await fetch(`${BASE}/rates`);
```
на:
```js
      const res = await fetch(`${BASE}/rates`, { headers: await authHeader() });
```

- [ ] **Step 9: Регресс-тесты + проверка покрытия**

Run: `npm test`
Expected: PASS (все shared + extension; read-функции `api.js` юнит-тестами не покрыты — это ожидаемо).

Run: `grep -c "await authHeader()" extension/api.js`
Expected: `7` (по одному в каждом read-вызове).

- [ ] **Step 10: Commit**

```bash
git add extension/api.js
git commit -m "feat(extension): read-вызовы шлют Bearer (Premium-чтение); не-Pro → 403 → локальный фолбэк"
```

---

### Task 5: Документация (`CLAUDE.md`) + заметка по деплою

**Files:**
- Modify: `CLAUDE.md` (таблица модулей backend + конвенция + env деплоя)

**Interfaces:**
- Consumes: ничего.
- Produces: ничего.

- [ ] **Step 1: Конвенция Premium-чтения**

В `CLAUDE.md`, в раздел «Конвенции (важное)», добавить буллет (после буллета про «Crowd-репутация брокеров» или рядом с auth-темами):

```
- **Premium-гейт чтения** (`backend/src/common/premium-read.guard.ts` + `common-auth.module.ts`):
  read-эндпоинты (`lanes`/`markets`/`geo`/`rates`/`loads` GET/`brokers` GET reputation) отдают
  крауд-данные только при валидном `X-API-Key` (ENV-список `API_KEYS`, через запятую) ИЛИ Pro-JWT
  (`plan==='pro'`); иначе 403. POST-инжест (`POST /loads`, `POST /brokers/reports`) — открыт (крауд
  пополняется от всех). Расширение шлёт `Authorization: Bearer` на read-вызовах; Free/аноним → 403 →
  локальный скоринг без крауд-данных. Ключи только в ENV, реальные значения не коммитить.
```

- [ ] **Step 2: Обновить строки структуры (`loads/`, `geo/`, `markets/`, `rates/`, `brokers/`)**

В блоке `backend/src/` описания модулей, к строкам `loads/`, `markets/`, `geo/`, `rates/`, `brokers/`
дописать пометку `(read — Premium-гард)`. Пример для `markets/`:

```
  markets/                  GET /markets/:m/strength — сила рынка (read — Premium-гард: API-KEY/Pro-JWT)
```

(Аналогично коротко для `lanes/`, `loads/` GET, `geo/`, `rates/`, `brokers/` reputation — одной фразой про Premium-гард на чтении.)

- [ ] **Step 3: Env деплоя**

В `CLAUDE.md`, в раздел «Деплой (Coolify…)», в абзац про env (где перечислены `DATABASE_URL`,
`JWT_SECRET`, …) добавить:

```
`API_KEYS` (список валидных X-API-Key через запятую для Premium-чтения; пусто → читает только Pro-JWT).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Premium-гейт чтения — конвенция, пометки модулей, env деплоя"
```

---

## Пост-имплементация (ручное, вне задач TDD)

- **Coolify env:** задать `API_KEYS=<реальный ключ(и)>` в production-окружении LoadLens, затем push
  в `main` (автодеплой подхватывает только свежий env). По скиллу `coolify-deploy`.
- **Smoke после деплоя** (curl): без ключа → 403, с валидным ключом → 200:
  ```
  curl -s -o /dev/null -w "%{http_code}\n" https://loadlens.krait.studio/api/v1/rates
  curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: <ключ>" https://loadlens.krait.studio/api/v1/rates
  ```
- **Расширение (ручная проверка):** залогиненный Pro → крауд-данные читаются (медианы/рынки/цепочки/
  дизель); разлогин/Free → те же запросы 403 → панель деградирует к локальному скорингу без ошибок.

## Self-Review

**Spec coverage:**
- Гард (Pro-JWT ИЛИ API-KEY, иначе 403) → Task 2. ✓
- ENV-набор ключей, пустой = путь B выключен → Task 1 (`parseApiKeys`/`isValidApiKey`) + Task 2 (использование). ✓
- Гард только на GET-чтение, POST-инжест открыт, account/JWT не трогаем → Task 3 (контроллер- vs метод-уровень). ✓
- Расширение шлёт Bearer, не-Premium → 403 → деградация → Task 4. ✓
- Ключ не в репозитории, `.env.example` пустой → Task 1 Step 5 + Task 5 + пост-имплементация (Coolify). ✓
- Тесты гарда (6+ кейсов из спеки) → Task 2 (7 кейсов, включая refresh-токен). ✓
- `parseApiKeys` кейсы → Task 1. ✓
- CLAUDE.md документация → Task 5. ✓

**Placeholder scan:** весь код приведён полностью; «(аналогично…)» в Task 3/5 сопровождены явным паттерном и точными именами методов (`near`/`byOrigin`/`reputation`) — не плейсхолдеры. ✓

**Type consistency:** `PremiumReadGuard` конструктор `(users: typeof User, jwt: JwtService)` и `isValidApiKey(key)` идентичны в Task 1 (опр.) / Task 2 (исп.). `authHeader()` → `{ Authorization } | {}` едино в Task 4. `CommonAuthModule` экспортит `PremiumReadGuard`, импортится в Task 3. ✓
