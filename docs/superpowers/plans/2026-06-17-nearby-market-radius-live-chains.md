# Радиус соседних рынков + живая свежесть цепочек — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Планировщик строит непрерывные цепочки грузов, подхватывая onward-плечи из соседних рынков в радиусе deadhead, а панель в живом режиме (delta-poll) отбрасывает «ушедшие» грузы по серверному скору свежести.

**Architecture:** Бэкенд считает соседей рынка по seed-координатам (haversine) и отдаёт neighborhood грузов одним эндпоинтом `GET /loads/near` с аннотацией свежести (`liveness`/`likelyGone`) и крюка (`originDeadheadMi`); свежесть опирается на новую колонку `seen_count` (инкремент при ingest) без правок `inject.js`. Планировщик получает чистую инъекцию `nearby(market)` и расширяет кандидатов узла на соседей, deadhead считается существующим `distance`. Расширение опрашивает `/loads/near` с `since` каждые ~7 c при открытой панели и пересчитывает цепочки.

**Tech Stack:** NestJS + Sequelize + Postgres (бэкенд, jest); zero-dep CommonJS (`shared/planner.js`, `extension/*.js`, node:test).

---

## File Structure

**Backend (создать):**
- `backend/src/geo/nearby.ts` — чистая `nearbyMarkets(market, radiusMi, seed, maxNeighbors)`.
- `backend/src/geo/nearby.spec.ts` — тест радиус-математики.
- `backend/src/loads/freshness.ts` — чистая `computeLiveness(row, now)`.
- `backend/src/loads/freshness.spec.ts` — тест decay/каденса.

**Backend (изменить):**
- `backend/src/loads/load.model.ts` — колонка `seenCount`.
- `backend/src/main.ts` — идемпотентный `ALTER TABLE loads ADD COLUMN IF NOT EXISTS seen_count`.
- `backend/src/loads/loads.service.ts` — инкремент `seen_count` в `ingest`, метод `near()`, инъекция `@InjectConnection`.
- `backend/src/loads/loads.controller.ts` — `GET /loads/near`.
- `backend/src/loads/loads.service.spec.ts` — обновить конструктор (2 аргумента), тесты `near` + инкремента.

**Shared (изменить) + синк в vendor:**
- `shared/planner.js` — инъекция `nearby`, расширение кандидатов узла.
- `shared/planner.test.js` — тесты радиуса + регрессия строгого матча.

**Extension (изменить):**
- `extension/geo.js` — `LLGEO.nearby(market, radiusMi)`.
- `extension/geo.test.js` — **создать**, тест `nearby`.
- `extension/api.js` — `getLoadsNear(market, {equipment, since})`.
- `extension/content.js` — `fetchCrowdLoads`→`near`, `mergeNear`, `goneIds`, фильтр пула, `nearby` в `buildChains`, poll-цикл.

---

## Task 1: Backend — `nearbyMarkets` (чистая функция радиуса)

**Files:**
- Create: `backend/src/geo/nearby.ts`
- Test: `backend/src/geo/nearby.spec.ts`
- Reuse: `haversineMiles` из `backend/src/geo/geo.service.ts:62`

- [ ] **Step 1: Написать падающий тест**

Create `backend/src/geo/nearby.spec.ts`:
```ts
import { nearbyMarkets } from './nearby';
import { loadSeed } from '../common/seed';

const SEED = loadSeed();

describe('nearbyMarkets', () => {
  it('включает сам рынок первым с crowMi=0', () => {
    const r = nearbyMarkets('DALLAS_TX', 75, SEED);
    expect(r[0]).toEqual({ market: 'DALLAS_TX', crowMi: 0 });
  });

  it('берёт близкого соседа (Fort Worth ~37mi) и отсекает дальнего (Houston ~270mi)', () => {
    const r = nearbyMarkets('DALLAS_TX', 75, SEED);
    const names = r.map((x) => x.market);
    expect(names).toContain('FORT_WORTH_TX');
    expect(names).not.toContain('HOUSTON_TX');
  });

  it('сортирует по возрастанию crowMi', () => {
    const r = nearbyMarkets('DALLAS_TX', 75, SEED);
    const miles = r.map((x) => x.crowMi);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
  });

  it('неизвестный рынок → только он сам', () => {
    expect(nearbyMarkets('NOWHERE_XX', 75, SEED)).toEqual([{ market: 'NOWHERE_XX', crowMi: 0 }]);
  });

  it('ограничивает число соседей maxNeighbors', () => {
    const r = nearbyMarkets('DALLAS_TX', 5000, SEED, 3);
    expect(r.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest src/geo/nearby.spec.ts`
Expected: FAIL — `Cannot find module './nearby'`.

- [ ] **Step 3: Реализовать**

Create `backend/src/geo/nearby.ts`:
```ts
import { haversineMiles } from './geo.service';
import type { Seed } from '../common/seed';

export interface NearbyMarket {
  market: string;
  crowMi: number; // приближённые дорожные мили (haversine ×1.2)
}

// Соседние seed-рынки в радиусе (включая сам рынок, crowMi=0).
// Рынок без координат → только он сам (деградация к строгому матчу).
export function nearbyMarkets(
  market: string,
  radiusMi: number,
  seed: Seed,
  maxNeighbors = 12,
): NearbyMarket[] {
  const self = seed.markets[market];
  const out: NearbyMarket[] = [{ market, crowMi: 0 }];
  if (!self) return out;
  for (const m of Object.keys(seed.markets)) {
    if (m === market) continue;
    const mi = Math.round(haversineMiles(self, seed.markets[m]) * 1.2);
    if (mi <= radiusMi) out.push({ market: m, crowMi: mi });
  }
  out.sort((a, b) => a.crowMi - b.crowMi);
  return out.slice(0, maxNeighbors);
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd backend && npx jest src/geo/nearby.spec.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add backend/src/geo/nearby.ts backend/src/geo/nearby.spec.ts
git commit -m "feat(geo): nearbyMarkets — соседние рынки в радиусе по seed-координатам"
```

---

## Task 2: Backend — `computeLiveness` (свежесть: decay + каденс)

**Files:**
- Create: `backend/src/loads/freshness.ts`
- Test: `backend/src/loads/freshness.spec.ts`

- [ ] **Step 1: Написать падающий тест**

Create `backend/src/loads/freshness.spec.ts`:
```ts
import { computeLiveness } from './freshness';

const NOW = new Date('2026-06-17T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('computeLiveness', () => {
  it('свежий груз → liveness ~1, не gone', () => {
    const r = computeLiveness({ firstSeen: minsAgo(2), lastSeen: minsAgo(1), seenCount: 1 }, NOW);
    expect(r.liveness).toBeGreaterThan(0.98);
    expect(r.likelyGone).toBe(false);
  });

  it('старый груз (70ч) → liveness ~0, но не gone при малом seenCount', () => {
    const r = computeLiveness({ firstSeen: minsAgo(70 * 60), lastSeen: minsAgo(70 * 60), seenCount: 1 }, NOW);
    expect(r.liveness).toBeLessThan(0.05);
    expect(r.likelyGone).toBe(false);
  });

  it('часто виденный, затем пропал → likelyGone', () => {
    // seenCount 10, span 90мин ⇒ cadence ~10мин; не виден 60мин > 4×10 ⇒ gone
    const r = computeLiveness({ firstSeen: minsAgo(150), lastSeen: minsAgo(60), seenCount: 10 }, NOW);
    expect(r.likelyGone).toBe(true);
  });

  it('часто виденный и недавно → не gone', () => {
    const r = computeLiveness({ firstSeen: minsAgo(150), lastSeen: minsAgo(2), seenCount: 10 }, NOW);
    expect(r.likelyGone).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest src/loads/freshness.spec.ts`
Expected: FAIL — `Cannot find module './freshness'`.

- [ ] **Step 3: Реализовать**

Create `backend/src/loads/freshness.ts`:
```ts
export const FRESH_WINDOW_HOURS = 72;
export const MIN_OBS = 4;        // минимум наблюдений для инференса «ушёл»
export const GONE_FACTOR = 4;    // не виден > GONE_FACTOR×каденс ⇒ likelyGone

export interface LivenessInput {
  firstSeen: Date | string;
  lastSeen: Date | string;
  seenCount?: number | null;
}

export interface Liveness {
  liveness: number;   // 0..1, линейный decay по давности
  likelyGone: boolean;
}

// Свежесть груза по снимкам чужих сессий: recency-decay + (для часто виденных) каденс-инференс.
export function computeLiveness(row: LivenessInput, now: Date): Liveness {
  const lastSeenMs = new Date(row.lastSeen).getTime();
  const ageMs = now.getTime() - lastSeenMs;
  const ageH = ageMs / 3_600_000;
  const liveness = clamp01(1 - ageH / FRESH_WINDOW_HOURS);

  let likelyGone = false;
  const seen = row.seenCount ?? 1;
  if (seen >= MIN_OBS) {
    const spanMs = lastSeenMs - new Date(row.firstSeen).getTime();
    const cadenceMs = spanMs / Math.max(1, seen - 1);
    if (cadenceMs > 0 && ageMs > GONE_FACTOR * cadenceMs) likelyGone = true;
  }
  return { liveness: round2(liveness), likelyGone };
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function round2(x: number): number { return Math.round(x * 100) / 100; }
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd backend && npx jest src/loads/freshness.spec.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add backend/src/loads/freshness.ts backend/src/loads/freshness.spec.ts
git commit -m "feat(loads): computeLiveness — свежесть груза (recency-decay + каденс-инференс)"
```

---

## Task 3: Backend — колонка `seen_count` + инкремент при ingest

**Files:**
- Modify: `backend/src/loads/load.model.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/src/loads/loads.service.ts`
- Modify: `backend/src/loads/loads.service.spec.ts`

- [ ] **Step 1: Добавить колонку в модель**

In `backend/src/loads/load.model.ts`, после блока `lastSeen` (строка 64) добавить:
```ts
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1, field: 'seen_count' })
  seenCount: number;
```

- [ ] **Step 2: Идемпотентный ALTER в bootstrap**

In `backend/src/main.ts`, заменить блок создания приложения. После строки `const app = await NestFactory.create(AppModule);` (строка 10) добавить:
```ts
  const { getConnectionToken } = await import('@nestjs/sequelize');
  const sequelize = app.get(getConnectionToken()) as import('sequelize').Sequelize;
  await sequelize.query(
    'ALTER TABLE loads ADD COLUMN IF NOT EXISTS seen_count INTEGER NOT NULL DEFAULT 1',
  );
```

- [ ] **Step 3: Написать падающий тест инкремента**

In `backend/src/loads/loads.service.spec.ts` обновить конструкторы (теперь 2 аргумента) и добавить тест. Заменить строку `const svc = new LoadsService({ findAll } as any);` на:
```ts
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
```
И добавить новый describe в конец файла:
```ts
describe('LoadsService.ingest seen_count', () => {
  it('инкрементит seen_count для уже существующих грузов (first_seen < now)', async () => {
    const bulkCreate = jest.fn().mockResolvedValue([]);
    const query = jest.fn().mockResolvedValue([]);
    const svc = new LoadsService({ bulkCreate } as any, { query } as any);
    await svc.ingest({
      clientId: 'c1',
      items: [{
        board: 'dat', loadId: 'L1', originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
        equipment: 'V', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|V',
      }],
    } as any);
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    // инкремент-апдейт вызван с фильтром по board + load_id + first_seen
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/seen_count = seen_count \+ 1/);
    expect(sql).toMatch(/first_seen < :now/);
    const repl = query.mock.calls[0][1].replacements;
    expect(repl.board).toBe('dat');
    expect(repl.ids).toEqual(['L1']);
  });
});
```

- [ ] **Step 4: Запустить — убедиться, что падает**

Run: `cd backend && npx jest src/loads/loads.service.spec.ts`
Expected: FAIL — конструктор LoadsService принимает 1 аргумент / `query` не вызывается.

- [ ] **Step 5: Реализовать инкремент**

In `backend/src/loads/loads.service.ts`:

(a) Добавить импорты вверху:
```ts
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize';
```

(b) Заменить конструктор:
```ts
  constructor(
    @InjectModel(Load) private readonly model: typeof Load,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}
```

(c) В методе `ingest`, после блока `await this.model.bulkCreate(...)` (перед `return`), добавить:
```ts
    // Инкремент seen_count только для уже существовавших грузов: у новых first_seen == now
    // (выставлен выше), у существующих — старее. Группируем по board (составной ключ).
    const idsByBoard = new Map<string, string[]>();
    for (const r of rows) {
      const arr = idsByBoard.get(r.board) ?? [];
      arr.push(r.loadId);
      idsByBoard.set(r.board, arr);
    }
    for (const [board, ids] of idsByBoard) {
      await this.sequelize.query(
        `UPDATE loads SET seen_count = seen_count + 1
           WHERE board = :board AND load_id IN (:ids) AND first_seen < :now`,
        { replacements: { board, ids, now } },
      );
    }
```

- [ ] **Step 6: Запустить — убедиться, что проходит**

Run: `cd backend && npx jest src/loads/loads.service.spec.ts`
Expected: PASS (все describe, включая seen_count).

- [ ] **Step 7: Коммит**

```bash
git add backend/src/loads/load.model.ts backend/src/main.ts backend/src/loads/loads.service.ts backend/src/loads/loads.service.spec.ts
git commit -m "feat(loads): колонка seen_count + инкремент при повторном ingest"
```

---

## Task 4: Backend — `near()` сервис + `GET /loads/near`

**Files:**
- Modify: `backend/src/loads/loads.service.ts`
- Modify: `backend/src/loads/loads.controller.ts`
- Modify: `backend/src/loads/loads.service.spec.ts`

- [ ] **Step 1: Написать падающий тест сервиса**

In `backend/src/loads/loads.service.spec.ts` добавить describe в конец:
```ts
describe('LoadsService.near', () => {
  it('возвращает соседей с originDeadheadMi и делит на loads/gone', async () => {
    const now = new Date('2026-06-17T12:00:00Z');
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    const findAll = jest.fn().mockResolvedValue([
      // живой груз из самого рынка
      { board: 'dat', loadId: 'L1', originMarket: 'DALLAS_TX', destMarket: 'ATLANTA_GA',
        equipment: 'V', groupKey: 'g1', lastSeen: minsAgo(1), firstSeen: minsAgo(2), seenCount: 1,
        rate: 2000, loadedMiles: 800, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
      // часто виденный и пропавший → gone
      { board: 'dat', loadId: 'L2', originMarket: 'FORT_WORTH_TX', destMarket: 'HOUSTON_TX',
        equipment: 'V', groupKey: 'g2', lastSeen: minsAgo(60), firstSeen: minsAgo(150), seenCount: 10,
        rate: 1500, loadedMiles: 250, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
    ]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    const res = await svc.near('DALLAS_TX', { radiusMi: 75 }, now);

    expect(res.gone).toContain('L2');
    expect(res.loads.map((l) => l.loadId)).toEqual(['L1']);
    expect(res.loads[0].originDeadheadMi).toBe(0);       // L1 из самого рынка
    expect(typeof res.loads[0].liveness).toBe('number');
    expect(typeof res.ts).toBe('string');
    // запрошен IN по соседям, включая Fort Worth
    const origins = findAll.mock.calls[0][0].where.originMarket;
    expect(origins[Object.getOwnPropertySymbols(origins)[0]]).toContain('FORT_WORTH_TX');
  });

  it('с since отдаёт только обновлённые после since', async () => {
    const now = new Date('2026-06-17T12:00:00Z');
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    const findAll = jest.fn().mockResolvedValue([
      { board: 'dat', loadId: 'NEW', originMarket: 'DALLAS_TX', destMarket: 'ATLANTA_GA',
        equipment: 'V', groupKey: 'g', lastSeen: minsAgo(1), firstSeen: minsAgo(2), seenCount: 1,
        rate: 2000, loadedMiles: 800, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
      { board: 'dat', loadId: 'OLD', originMarket: 'DALLAS_TX', destMarket: 'MEMPHIS_TN',
        equipment: 'V', groupKey: 'g', lastSeen: minsAgo(30), firstSeen: minsAgo(40), seenCount: 1,
        rate: 1800, loadedMiles: 450, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
    ]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    const res = await svc.near('DALLAS_TX', { since: minsAgo(10).toISOString() }, now);
    expect(res.loads.map((l) => l.loadId)).toEqual(['NEW']);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest src/loads/loads.service.spec.ts -t near`
Expected: FAIL — `svc.near is not a function`.

- [ ] **Step 3: Реализовать сервис**

In `backend/src/loads/loads.service.ts`:

(a) Добавить импорты:
```ts
import { loadSeed } from '../common/seed';
import { nearbyMarkets } from '../geo/nearby';
import { computeLiveness } from './freshness';
```

(b) Расширить интерфейс `CrowdLoad` новым подтипом — добавить после объявления `CrowdLoad`:
```ts
export interface CrowdLoadNear extends CrowdLoad {
  originDeadheadMi: number;
  liveness: number;
}
export interface NearResult {
  loads: CrowdLoadNear[];
  gone: string[];
  ts: string;
}
```

(c) Добавить метод `near` в класс (после `byOrigin`):
```ts
  // Neighborhood грузов (рынок + соседи в радиусе) для непрерывных цепочек + живой свежести.
  async near(
    market: string,
    opts: { equipment?: string; radiusMi?: number; since?: string } = {},
    now: Date = new Date(),
  ): Promise<NearResult> {
    const radiusMi = Math.min(Math.max(0, opts.radiusMi ?? 75), 200);
    const neighbors = nearbyMarkets(market, radiusMi, loadSeed());
    const dhByMarket = new Map(neighbors.map((n) => [n.market, n.crowMi]));
    const where: any = {
      originMarket: { [Op.in]: neighbors.map((n) => n.market) },
      lastSeen: { [Op.gt]: new Date(now.getTime() - CROWD_WINDOW_HOURS * 3600 * 1000) },
    };
    if (opts.equipment) where.equipment = opts.equipment;
    const rows = await this.model.findAll({ where, order: [['lastSeen', 'DESC']], limit: 300 });

    const since = opts.since ? new Date(opts.since) : null;
    const loads: CrowdLoadNear[] = [];
    const gone: string[] = [];
    for (const r of rows) {
      const { liveness, likelyGone } = computeLiveness(r, now);
      if (likelyGone) { gone.push(r.loadId); continue; }
      if (since && new Date(r.lastSeen) <= since) continue;
      loads.push({
        board: r.board, loadId: r.loadId,
        originMarket: r.originMarket, destMarket: r.destMarket,
        equipment: r.equipment, groupKey: r.groupKey, lastSeen: r.lastSeen,
        rate: r.rate, loadedMiles: r.loadedMiles, deadheadMiles: r.deadheadMiles,
        weight: r.weight, brokerMc: r.brokerMc, brokerName: r.brokerName,
        originDeadheadMi: dhByMarket.get(r.originMarket) ?? 0,
        liveness,
      });
    }
    return { loads, gone, ts: now.toISOString() };
  }
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `cd backend && npx jest src/loads/loads.service.spec.ts`
Expected: PASS (включая near).

- [ ] **Step 5: Добавить эндпоинт в контроллер**

In `backend/src/loads/loads.controller.ts`, добавить метод ДО `@Get()` (`byOrigin`):
```ts
  // Neighborhood грузов (рынок + соседи в радиусе) для цепочек + delta-poll живой свежести.
  @SkipThrottle()
  @Get('near')
  near(
    @Query('market') market?: string,
    @Query('equipment') equipment?: string,
    @Query('radiusMi') radiusMi?: string,
    @Query('since') since?: string,
  ) {
    if (!market) throw new BadRequestException('market обязателен');
    return this.service.near(market, {
      equipment,
      radiusMi: radiusMi ? parseInt(radiusMi, 10) : undefined,
      since,
    });
  }
```

- [ ] **Step 6: Сборка бэкенда (проверка типов)**

Run: `cd backend && npm run build`
Expected: успешная компиляция (нет TS-ошибок).

- [ ] **Step 7: Коммит**

```bash
git add backend/src/loads/loads.service.ts backend/src/loads/loads.controller.ts backend/src/loads/loads.service.spec.ts
git commit -m "feat(loads): GET /loads/near — neighborhood грузов + свежесть + delta(since)"
```

---

## Task 5: Shared — `nearby` в планировщике

**Files:**
- Modify: `shared/planner.js:103-162` (`plan`)
- Test: `shared/planner.test.js`
- Sync: `npm run sync:shared`

- [ ] **Step 1: Написать падающие тесты**

In `shared/planner.test.js` добавить в конец файла:
```js
test("радиус: цепочка продолжается через соседний рынок", () => {
  const loads = [
    load({ id: "B", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
    // onward-груз из СОСЕДА FTW, не из DAL
    load({ id: "C", from: "FTW", to: "LA", rate: 1900, mi: 1400 }),
  ];
  const nearby = (m) =>
    m === "DAL" ? [{ market: "DAL", miles: 0 }, { market: "FTW", miles: 35 }]
                : [{ market: m, miles: 0 }];
  const distance = (a, b) => (a === "DAL" && b === "FTW" ? 35 : 0);
  const chains = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance, marketStrength: strengthFn, nearby, maxLegs: 3,
  });
  const multi = chains.find((c) => c.legs.length === 2);
  assert.ok(multi, "ожидается 2-плечевая цепочка через соседа");
  assert.strictEqual(multi.finalMarket, "LA");
  assert.strictEqual(multi.legs[1].deadhead, 35); // крюк DAL→FTW учтён
});

test("без nearby онвард из соседа не подхватывается (регрессия строгого матча)", () => {
  const loads = [
    load({ id: "B", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
    load({ id: "C", from: "FTW", to: "LA", rate: 1900, mi: 1400 }),
  ];
  const chains = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: zeroDistance, marketStrength: strengthFn,
  });
  assert.ok(chains.every((c) => c.legs.length === 1), "соседский онвард не должен попадать без nearby");
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test shared/planner.test.js`
Expected: FAIL — «радиус…» падает (2-плечевая цепочка не строится, кандидаты только из точного рынка).

- [ ] **Step 3: Реализовать**

In `shared/planner.js`, в функции `plan`, заменить блок перебора кандидатов внутри `for (const p of beam)` (строки 127-129):
```js
      for (const p of beam) {
        const candidates = byOrigin.get(p.node) || [];
        for (const load of candidates) {
```
на:
```js
      for (const p of beam) {
        // кандидаты узла: грузы из самого рынка + из соседей в радиусе (nearby).
        // По умолчанию nearby нет → только сам рынок (строгий матч, прежнее поведение).
        const origins = o.nearby ? o.nearby(p.node) : [{ market: p.node, miles: 0 }];
        const seenIds = new Set();
        for (const { market: om } of origins) {
          const list = byOrigin.get(om) || [];
          for (const load of list) {
            if (seenIds.has(load.loadId)) continue;
            seenIds.add(load.loadId);
```
И закрыть дополнительный цикл: найти конец внутреннего `for (const load of candidates)` (строка 152 `next.push(score(cand, strength, o));` затем `}` на 153) и заменить закрывающую часть:
```js
          next.push(score(cand, strength, o));
        }
      }
```
на:
```js
            next.push(score(cand, strength, o));
          }
        }
      }
```
(добавлен один уровень вложенности `for (const { market: om } of origins)`.)

> Примечание: deadhead по-прежнему `Math.round(distance(p.node, load.originMarket))` — для соседского груза это крюк до соседа; HOS-гейт и экономика не меняются.

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test shared/planner.test.js`
Expected: PASS (все тесты, включая 2 новых и старые регрессионные).

- [ ] **Step 5: Синхронизировать vendor**

Run: `npm run sync:shared`
Expected: `extension/vendor/planner.js` и `backend/shared/*` пересобраны.

- [ ] **Step 6: Коммит**

```bash
git add shared/planner.js shared/planner.test.js extension/vendor/planner.js backend/shared/planner.js
git commit -m "feat(planner): инъекция nearby — onward-плечи из соседних рынков в радиусе"
```

---

## Task 6: Extension — `LLGEO.nearby`

**Files:**
- Modify: `extension/geo.js`
- Test: `extension/geo.test.js` (создать)

- [ ] **Step 1: Написать падающий тест**

Create `extension/geo.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert");
globalThis.LLSEED = require("./vendor/markets.seed.js");
const LLGEO = require("./geo.js");

test("nearby: сам рынок первым + близкий сосед, дальний отсечён", () => {
  const n = LLGEO.nearby("DALLAS_TX", 75);
  assert.strictEqual(n[0].market, "DALLAS_TX");
  assert.strictEqual(n[0].miles, 0);
  assert.ok(n.some((x) => x.market === "FORT_WORTH_TX"));
  assert.ok(!n.some((x) => x.market === "HOUSTON_TX"));
});

test("nearby: неизвестный рынок → только он сам", () => {
  assert.deepStrictEqual(LLGEO.nearby("NOWHERE_XX", 75), [{ market: "NOWHERE_XX", miles: 0 }]);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test extension/geo.test.js`
Expected: FAIL — `LLGEO.nearby is not a function`.

- [ ] **Step 3: Реализовать**

In `extension/geo.js`, добавить функцию перед `return { distance, sync, warm, offline, haversineMiles };` (строка 53):
```js
  // Соседние seed-рынки в радиусе (включая сам рынок, miles=0). Та же метрика, что на бэке.
  function nearby(market, radiusMi) {
    const seed = (globalThis.LLSEED && globalThis.LLSEED.markets) || {};
    const self = seed[market];
    const out = [{ market, miles: 0 }];
    if (!self) return out;
    for (const m in seed) {
      if (m === market) continue;
      const mi = Math.round(haversineMiles(self, seed[m]) * 1.2);
      if (mi <= radiusMi) out.push({ market: m, miles: mi });
    }
    out.sort((a, b) => a.miles - b.miles);
    return out.slice(0, 12);
  }
```
И добавить `nearby` в возвращаемый объект:
```js
  return { distance, sync, warm, offline, haversineMiles, nearby };
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test extension/geo.test.js`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add extension/geo.js extension/geo.test.js
git commit -m "feat(geo-ext): LLGEO.nearby — соседи рынка в радиусе для планировщика"
```

---

## Task 7: Extension — `api.getLoadsNear`

**Files:**
- Modify: `extension/api.js:54-61` (рядом с `getLoadsByOrigin`) и `:218` (экспорт)

- [ ] **Step 1: Добавить метод**

In `extension/api.js`, после функции `getLoadsByOrigin` (строка 61) добавить:
```js
  // neighborhood грузов (рынок + соседи) + delta(since) для живого монитора цепочек
  async function getLoadsNear(market, { equipment, since } = {}) {
    try {
      const q = new URLSearchParams({ market });
      if (equipment) q.set("equipment", equipment);
      if (since) q.set("since", since);
      const res = await fetch(`${BASE}/loads/near?${q.toString()}`);
      return res.ok ? res.json() : null;
    } catch { return null; }
  }
```

- [ ] **Step 2: Экспортировать**

In `extension/api.js:218`, в `return { ... }` добавить `getLoadsNear` рядом с `getMarket`:
```js
  return { sanitizeLoad, clientId, sendLoads, getLane, getMarket, getDistance, getDiesel,
```
→ убедиться, что в итоговом объекте присутствует `getLoadsNear` (добавить в список возвращаемых имён).

- [ ] **Step 3: Проверка синтаксиса**

Run: `node -e "require('./extension/api.js')"`
Expected: без ошибок (модуль парсится). Если файл завязан на browser-only глобалы и падает — вместо этого `node --check extension/api.js` (только синтаксис).

- [ ] **Step 4: Коммит**

```bash
git add extension/api.js
git commit -m "feat(api-ext): getLoadsNear — клиент для GET /loads/near"
```

---

## Task 8: Extension — `content.js` (near + goneIds + poll + nearby)

**Files:**
- Modify: `extension/content.js` (строки 27, 102-118, 362, ~693)

- [ ] **Step 1: Добавить состояние свежести/радиуса**

In `extension/content.js`, рядом с объявлением `const crowdCache = new Map();` (строка 27) добавить:
```js
  const goneIds = new Set();      // loadId, помеченные сервером likelyGone
  const crowdSince = new Map();   // market -> серверный ts последнего ответа near (для delta-poll)
  const RADIUS_MI = 75;           // радиус соседних рынков (тот же, что в LLGEO.nearby/бэке)
  const POLL_MS = 7000;           // интервал живого delta-poll при открытой панели
```

- [ ] **Step 2: Заменить `fetchCrowdLoads` на near + merge**

Заменить функцию `fetchCrowdLoads` целиком (строки 102-111):
```js
  // подтянуть крауд-грузы из рынков назначения — это origin'ы следующих плеч цепочки
  function fetchCrowdLoads(markets) {
    if (typeof LLAPI === "undefined") return;
    markets.slice(0, 25).forEach((m) => {            // bound: не больше 25 запросов
      if (crowdRequested.has(m)) return;
      crowdRequested.add(m);
      LLAPI.getLoadsByOrigin(m).then((rows) => {
        if (rows && rows.length) { crowdCache.set(m, rows); schedule(); }
      }).catch(() => {});
    });
  }
```
на:
```js
  // подтянуть neighborhood грузов из рынков назначения (рынок + соседи) — origin'ы следующих плеч.
  // opts.poll=true: живой delta-poll (игнорируем crowdRequested, шлём since), иначе разовый full-snapshot.
  function fetchCrowdLoads(markets, opts = {}) {
    if (typeof LLAPI === "undefined") return;
    markets.slice(0, 25).forEach((m) => {            // bound: не больше 25 запросов
      if (!opts.poll && crowdRequested.has(m)) return;
      crowdRequested.add(m);
      const since = opts.poll ? crowdSince.get(m) : undefined;
      LLAPI.getLoadsNear(m, { equipment: activeEquipment || undefined, since }).then((res) => {
        if (res) mergeNear(m, res);
      }).catch(() => {});
    });
  }

  // Слить near-ответ в crowdCache: added/updated upsert по loadId, gone — удалить и запомнить.
  function mergeNear(market, res) {
    const prev = crowdCache.get(market) || [];
    const byId = new Map(prev.map((l) => [l.loadId, l]));
    (res.loads || []).forEach((l) => byId.set(l.loadId, l));
    (res.gone || []).forEach((id) => { byId.delete(id); goneIds.add(id); });
    crowdCache.set(market, [...byId.values()]);
    if (res.ts) crowdSince.set(market, res.ts);
    schedule();
  }
```

- [ ] **Step 3: Исключать `goneIds` из пула планировщика**

Заменить `chainPool` (строки 113-118):
```js
  function chainPool(visible) {
    const byId = new Map();
    visible.forEach((l) => byId.set(l.loadId, l));
    crowdCache.forEach((rows) => rows.forEach((l) => { if (!byId.has(l.loadId)) byId.set(l.loadId, l); }));
    return [...byId.values()];
  }
```
на:
```js
  function chainPool(visible) {
    const byId = new Map();
    visible.forEach((l) => byId.set(l.loadId, l));
    crowdCache.forEach((rows) => rows.forEach((l) => { if (!byId.has(l.loadId)) byId.set(l.loadId, l); }));
    return [...byId.values()].filter((l) => !goneIds.has(l.loadId)); // ушедшие грузы — вон из цепочек
  }
```

- [ ] **Step 4: Передать `nearby` в планировщик**

In `buildChains` (строка 362-370), добавить в объект `LLPLAN.plan({...})` строку после `distance:` (строка 366):
```js
      distance: (a, b) => LLGEO.sync(a, b),
      nearby: (m) => LLGEO.nearby(m, RADIUS_MI),
```

- [ ] **Step 5: Живой delta-poll при открытой панели**

In `boot()`, после существующего `setInterval(...)` со слежением за path (заканчивается на строке 696 `}, 600);`), добавить:
```js
    // живой монитор: пока панель открыта и вкладка видима — delta-poll neighborhood'ов цепочки
    setInterval(() => {
      if (panelCollapsed || document.visibilityState !== "visible") return;
      const onward = [...new Set(currentLoads().map((l) => l.destMarket))];
      if (onward.length) fetchCrowdLoads(onward, { poll: true });
    }, POLL_MS);
```

- [ ] **Step 6: Проверка синтаксиса**

Run: `node --check extension/content.js`
Expected: без ошибок синтаксиса.

- [ ] **Step 7: Прогнать весь набор тестов (регрессия)**

Run: `npm test`
Expected: PASS — sync:shared + shared (19: было 17 + 2 планировщика) + extension (12: было 10 + 2 geo).

- [ ] **Step 8: Коммит**

```bash
git add extension/content.js
git commit -m "feat(content): живой delta-poll near + радиус соседних рынков в цепочках"
```

---

## Финальная проверка (вся фича)

- [ ] **Бэкенд: полный прогон**

Run: `cd backend && npm test && npm run build`
Expected: все jest-наборы зелёные, сборка успешна.

- [ ] **Корневые тесты**

Run: `npm test`
Expected: shared + extension зелёные.

- [ ] **Ручная проверка расширения (smoke)**

`chrome://extensions` → перезагрузить распакованное `extension/` → открыть DAT One с грузами →
панель LoadLens → убедиться, что цепочки строятся, при открытой панели запросы `GET /loads/near`
идут ~раз в 7 c (DevTools → Network), при сворачивании панели/скрытии вкладки — прекращаются.

---

## Self-Review (выполнено при написании плана)

- **Покрытие спеки:** §1 радиус → Task 1,5,6,8; §2 свежесть/seen_count → Task 2,3; §3 delta-poll → Task 4,7,8; planner nearby → Task 5; деградация без координат → Task 1 (тест unknown market), Task 6. ✔
- **Плейсхолдеры:** не найдено — весь код приведён. ✔
- **Согласованность типов:** `nearbyMarkets→{market,crowMi}` (бэк) / `LLGEO.nearby→{market,miles}` (клиент) — разные имена полей намеренно (разные слои); планировщик использует только `.market`. `near()` возвращает `{loads,gone,ts}` — клиент `mergeNear` читает ровно эти поля. `computeLiveness(row,now)` сигнатура едина в Task 2 и Task 4. ✔
- **Радиус-константа** 75 миль и формула `haversine×1.2` идентичны на бэке (`nearby.ts`) и клиенте (`geo.js`) → neighborhood пула и индекс планировщика совпадают. ✔
