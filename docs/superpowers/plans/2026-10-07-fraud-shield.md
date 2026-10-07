# Fraud Shield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать диспетчеру статус и возраст лицензии брокера (FMCSA), перепосты одного lane и размер крауда, чтобы подозрительный груз был виден до звонка.

**Architecture:** Новый NestJS-модуль `backend/src/shield/` отдаёт открытый `GET /brokers/:mc/shield`: статус — QCMobile (если есть `FMCSA_WEBKEY`), возраст/инциденты — два SODA-датасета DOT, кэш в таблице `fmcsa_authority`; перепосты — SQL по `loads`. `shared/scoring.js` превращает ответ во флаги `redFlags` и чип `shieldBadge`; расширение лениво тянет shield по `mc|lane` и рисует чип; карточка показывает «N reports».

**Tech Stack:** NestJS 10 + sequelize-typescript + Postgres, jest (backend); vanilla JS MV3, `node --test` (shared/extension).

**Spec:** `docs/superpowers/specs/2026-10-07-fraud-shield-design.md`

## Global Constraints

- Рабочая копия: worktree `/Users/bogdan/work/startup/dat.com-fraud-shield`, ветка `fraud-shield`. В основной каталог не коммитить.
- Коммиты без упоминаний Claude/AI и без `Co-Authored-By`.
- Пользовательские строки (extension/, shared/, backend/src/) — **только английский**: `npm run check:lang` падает на кириллице вне комментариев. Комментарии — по-русски, как в коде вокруг.
- `shared/*.js` — канон; после правки `npm run sync:shared` (vendor/ и backend/shared/ руками не трогать).
- Новых запросов к DAT нет. Наружу из `loads` — только счётчики, без PII.
- Без `FMCSA_WEBKEY` `authority.status === null` → статусных флагов нет (принцип: лучше промолчать, чем ложно обвинить).
- Отсутствие брокерской записи в истории ≠ отсутствие лицензии → `grantedAt/ageDays/incidents12m = null`, флагов нет.
- Таймаут внешних запросов 5000 мс. TTL кэша: 24ч (найден), 6ч (`not_found`); частичный результат (какой-то источник упал) не кэшируется.
- Эндпоинт открыт (без `PremiumReadGuard`), троттлинг маршрута `@Throttle({ default: { limit: 600, ttl: 60000 } })`.
- Пороги флагов: `new_authority` < 180 дней (med), < 90 (high); `reposted` count ≥ 4 и days ≥ 3; окно перепостов 14 дней; инциденты — за 365 дней.

## Review Focus

- MC с ведущими нулями / префиксом (`MC-055000`, `055000`) — в SODA docket хранится как `MC` + цифры, дополненные нулями до 6 (`FF000031`, `MC384859`); ожидаем, что `MC-055000` и `55000` находят одну запись → тест `docketOf` в Task 2.
- `broker_mc` в `loads` хранится сырым (`MC-555000` из фикстуры, цифры у живого DAT) — перепост-счётчик должен совпадать для обоих форматов → тест в Task 3 (сырой `MC-555000` в БД, запрос по `555000`).
- Отменённый отзыв лицензии (`INVOLUNTARY REVOCATION` → `DISCONTINUED REVOCATION`) у крупного брокера — инцидент 12-месячного окна считается по дате уведомления, но через 2 года не должен давать флаг → тест в Task 1.
- DOT/QCMobile лежат или отвечают 5xx — эндпоинт не 500, а отдаёт протухший кэш либо `authority: null` → тест в Task 4.
- Груз без `brokerMc` или без lane-полей — расширение не шлёт запрос и не падает; `redFlags` без `ctx.shield` ведёт себя как раньше → тесты в Task 5 и Task 6.

---

### Task 1: Чистые функции вывода лицензии (`authority.ts`)

**Files:**
- Create: `backend/src/shield/authority.ts`
- Test: `backend/src/shield/authority.spec.ts`

**Interfaces:**
- Produces:
  - `type AuthorityStatus = 'active' | 'inactive' | 'carrier_only' | 'not_found'`
  - `interface QcCarrier { allowedToOperate?: string; brokerAuthorityStatus?: string; commonAuthorityStatus?: string; contractAuthorityStatus?: string }`
  - `interface AuthHistRow { mod_col_1?: string; original_action_desc?: string; orig_served_date?: string; disp_action_desc?: string; disp_served_date?: string }`
  - `interface MotusRow { op_auth_type?: string; op_auth_status?: string; reason?: string; status_change_date?: string }`
  - `interface AuthorityHistory { grantedAt: string | null; ageDays: number | null; incidents12m: number | null }`
  - `interface Authority extends AuthorityHistory { status: AuthorityStatus | null; allowedToOperate: boolean | null; checkedAt: string }`
  - `deriveStatus(carrier: QcCarrier | null): AuthorityStatus` — `null` = docket не найден
  - `deriveHistory(hist: AuthHistRow[], motus: MotusRow[], now: Date): AuthorityHistory`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/shield/authority.spec.ts
import { deriveHistory, deriveStatus } from './authority';

const NOW = new Date('2026-10-07T00:00:00Z');

describe('deriveStatus (QCMobile)', () => {
  it('not_found, когда docket не найден', () => {
    expect(deriveStatus(null)).toBe('not_found');
  });
  it('active при брокерской A', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'A', allowedToOperate: 'Y' })).toBe('active');
  });
  it('inactive при брокерской A, но allowedToOperate=N', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'A', allowedToOperate: 'N' })).toBe('inactive');
  });
  it('carrier_only, когда активна только перевозочная', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'N', commonAuthorityStatus: 'A' })).toBe('carrier_only');
    expect(deriveStatus({ brokerAuthorityStatus: 'I', contractAuthorityStatus: 'A' })).toBe('carrier_only');
  });
  it('inactive, когда ничего не активно', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'I', commonAuthorityStatus: 'N' })).toBe('inactive');
  });
});

describe('deriveHistory (AuthHist + Motus)', () => {
  it('нет брокерских записей → всё null (не значит «нет лицензии»)', () => {
    const hist = [{ mod_col_1: 'MOTOR PROPERTY COMMON CARRIER', original_action_desc: 'GRANTED', orig_served_date: '08/10/2001' }];
    expect(deriveHistory(hist, [], NOW)).toEqual({ grantedAt: null, ageDays: null, incidents12m: null });
  });
  it('дата выдачи — самая ранняя брокерская GRANTED из AuthHist', () => {
    const hist = [
      { mod_col_1: 'PROPERTY BROKER', original_action_desc: 'GRANTED', orig_served_date: '07/12/2000' },
      { mod_col_1: 'MOTOR PROPERTY COMMON CARRIER', original_action_desc: 'GRANTED', orig_served_date: '01/01/1999' },
    ];
    const h = deriveHistory(hist, [], NOW);
    expect(h.grantedAt).toBe('2000-07-12');
    expect(h.ageDays).toBe(9583);
    expect(h.incidents12m).toBe(0);
  });
  it('дата выдачи из Motus (YYYYMMDD) для новых брокеров', () => {
    const motus = [{ op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Active', reason: 'GRANTED', status_change_date: '20260515' }];
    const h = deriveHistory([], motus, NOW);
    expect(h.grantedAt).toBe('2026-05-15');
    expect(h.ageDays).toBe(145);
  });
  it('приостановка Motus 2 месяца назад — инцидент', () => {
    const motus = [{ op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Inactive', reason: 'Involuntary Suspension - insurance cancellation effective', status_change_date: '20260802' }];
    expect(deriveHistory([], motus, NOW).incidents12m).toBe(1);
  });
  it('реинстейт Motus — не инцидент', () => {
    const motus = [{ op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Active', reason: 'Reinstated', status_change_date: '20260901' }];
    expect(deriveHistory([], motus, NOW).incidents12m).toBe(0);
  });
  it('отозванный отзыв 2019 года — вне окна 12 мес', () => {
    const hist = [{ mod_col_1: 'BROKER', original_action_desc: 'INVOLUNTARY REVOCATION', orig_served_date: '06/12/2019', disp_action_desc: 'DISCONTINUED REVOCATION', disp_served_date: '06/19/2019' }];
    expect(deriveHistory(hist, [], NOW).incidents12m).toBe(0);
  });
  it('уведомление об отзыве в окне — инцидент; DISCONTINUED-диспозиция инцидент не добавляет', () => {
    const hist = [{ mod_col_1: 'BROKER', original_action_desc: 'INVOLUNTARY REVOCATION', orig_served_date: '03/01/2026', disp_action_desc: 'DISCONTINUED REVOCATION', disp_served_date: '03/20/2026' }];
    expect(deriveHistory(hist, [], NOW).incidents12m).toBe(1);
  });
  it('REVOKED-диспозиция в окне — инцидент', () => {
    const hist = [{ mod_col_1: 'PROPERTY BROKER', original_action_desc: 'GRANTED', orig_served_date: '01/05/2020', disp_action_desc: 'REVOKED', disp_served_date: '04/01/2026' }];
    expect(deriveHistory(hist, [], NOW).incidents12m).toBe(1);
  });
  it('мусорные даты не роняют', () => {
    const hist = [{ mod_col_1: 'BROKER', original_action_desc: 'GRANTED', orig_served_date: 'n/a' }];
    expect(deriveHistory(hist, [], NOW)).toEqual({ grantedAt: null, ageDays: null, incidents12m: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && npx jest src/shield/authority.spec.ts`
Expected: FAIL — `Cannot find module './authority'`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/shield/authority.ts
// Чистый вывод «лицензии брокера» из ответов FMCSA (спека 2026-10-07-fraud-shield-design).
// Статус — ТОЛЬКО из QCMobile; история (AuthHist/Motus) — журнал событий, не реестр:
// отсутствие брокерской записи не значит отсутствие лицензии → null, а не флаг.

export type AuthorityStatus = 'active' | 'inactive' | 'carrier_only' | 'not_found';

export interface QcCarrier {
  allowedToOperate?: string;
  brokerAuthorityStatus?: string;
  commonAuthorityStatus?: string;
  contractAuthorityStatus?: string;
}
export interface AuthHistRow {
  mod_col_1?: string;
  original_action_desc?: string;
  orig_served_date?: string;
  disp_action_desc?: string;
  disp_served_date?: string;
}
export interface MotusRow {
  op_auth_type?: string;
  op_auth_status?: string;
  reason?: string;
  status_change_date?: string;
}
export interface AuthorityHistory { grantedAt: string | null; ageDays: number | null; incidents12m: number | null }
export interface Authority extends AuthorityHistory {
  status: AuthorityStatus | null;   // null — нет FMCSA_WEBKEY или QCMobile недоступен
  allowedToOperate: boolean | null;
  checkedAt: string;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 365;
const HIST_BROKER = new Set(['BROKER', 'PROPERTY BROKER']);
const isMotusBroker = (t?: string) => /^Broker of Property/i.test(t || '');
const BAD_ORIG = /REVOCATION|REVOKED|SUSPENSION/i;
const BAD_DISP = /REVOKED|INACTIVATION|SUSPENSION/i;

export function deriveStatus(c: QcCarrier | null): AuthorityStatus {
  if (!c) return 'not_found';
  if (c.brokerAuthorityStatus === 'A') return c.allowedToOperate === 'N' ? 'inactive' : 'active';
  if (c.commonAuthorityStatus === 'A' || c.contractAuthorityStatus === 'A') return 'carrier_only';
  return 'inactive';
}

// 'MM/DD/YYYY' (AuthHist) → Date UTC | null
function parseUs(s?: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null;
}
// 'YYYYMMDD' (Motus) → Date UTC | null
function parseYmd(s?: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function deriveHistory(hist: AuthHistRow[], motus: MotusRow[], now: Date): AuthorityHistory {
  const h = hist.filter((r) => HIST_BROKER.has(String(r.mod_col_1 || '').toUpperCase()));
  const m = motus.filter((r) => isMotusBroker(r.op_auth_type));
  if (!h.length && !m.length) return { grantedAt: null, ageDays: null, incidents12m: null };

  const grants: Date[] = [];
  const incidents: Date[] = [];
  for (const r of h) {
    const orig = parseUs(r.orig_served_date);
    const disp = parseUs(r.disp_served_date);
    if (/^GRANTED$/i.test(r.original_action_desc || '') && orig) grants.push(orig);
    if (BAD_ORIG.test(r.original_action_desc || '') && orig) incidents.push(orig);
    const dispText = r.disp_action_desc || '';
    if (BAD_DISP.test(dispText) && !/DISCONTINUED/i.test(dispText) && disp) incidents.push(disp);
  }
  for (const r of m) {
    const d = parseYmd(r.status_change_date);
    if (!d) continue;
    if (/^GRANTED$/i.test(r.reason || '')) grants.push(d);
    else if (!/reinstat/i.test(r.reason || '') &&
      (r.op_auth_status === 'Inactive' || /suspension|revoc/i.test(r.reason || ''))) incidents.push(d);
  }

  const first = grants.length ? new Date(Math.min(...grants.map((d) => d.getTime()))) : null;
  const since = now.getTime() - WINDOW_DAYS * DAY;
  return {
    grantedAt: first ? first.toISOString().slice(0, 10) : null,
    ageDays: first ? Math.floor((now.getTime() - first.getTime()) / DAY) : null,
    incidents12m: incidents.filter((d) => d.getTime() >= since).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && npx jest src/shield/authority.spec.ts`
Expected: PASS (14 tests). Если `ageDays` в тестах разойдётся на ±1 — пересчитать ожидание от `NOW` (2000-07-12 → 2026-10-07 = 9583 дня; 2026-05-15 → 2026-10-07 = 145), не менять формулу.

- [ ] **Step 5: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add backend/src/shield/authority.ts backend/src/shield/authority.spec.ts
git commit -m "feat(shield): вывод статуса и истории лицензии брокера из ответов FMCSA"
```

---

### Task 2: HTTP-клиент FMCSA (`fmcsa.client.ts`)

**Files:**
- Create: `backend/src/shield/fmcsa.client.ts`
- Test: `backend/src/shield/fmcsa.client.spec.ts`

**Interfaces:**
- Consumes: `QcCarrier`, `AuthHistRow`, `MotusRow` из Task 1.
- Produces:
  - `docketOf(mc: string): string` — `'55000'` → `'MC055000'`, `'1819236'` → `'MC1819236'`
  - `class FmcsaClient` (`@Injectable`): `authHist(mc): Promise<AuthHistRow[]>`, `motus(mc): Promise<MotusRow[]>`, `qc(mc): Promise<QcCarrier | null | undefined>` (`undefined` — нет ключа, `null` — docket не найден; ошибки сети/5xx — reject).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/shield/fmcsa.client.spec.ts
import { docketOf, FmcsaClient } from './fmcsa.client';

describe('docketOf', () => {
  it('дополняет нулями до 6 цифр, срезая лишние ведущие нули', () => {
    expect(docketOf('55000')).toBe('MC055000');
    expect(docketOf('055000')).toBe('MC055000');
    expect(docketOf('384859')).toBe('MC384859');
    expect(docketOf('1819236')).toBe('MC1819236');
  });
});

describe('FmcsaClient', () => {
  const orig = global.fetch;
  const env = process.env.FMCSA_WEBKEY;
  afterEach(() => { global.fetch = orig; process.env.FMCSA_WEBKEY = env; });
  const reply = (status: number, body: unknown) =>
    (global.fetch = jest.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body }) as any);

  it('authHist ходит в SODA 9mw4-x3tu по docket', async () => {
    reply(200, [{ mod_col_1: 'BROKER' }]);
    const rows = await new FmcsaClient().authHist('384859');
    expect(rows).toEqual([{ mod_col_1: 'BROKER' }]);
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://data.transportation.gov/resource/9mw4-x3tu.json?docket_number=MC384859&$limit=200');
  });
  it('motus ходит в SODA yu5v-wbh6', async () => {
    reply(200, []);
    await new FmcsaClient().motus('55000');
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://data.transportation.gov/resource/yu5v-wbh6.json?docket_number=MC055000&$limit=200');
  });
  it('5xx → reject', async () => {
    reply(503, {});
    await expect(new FmcsaClient().motus('1')).rejects.toThrow('503');
  });
  it('qc без ключа → undefined, без запроса', async () => {
    delete process.env.FMCSA_WEBKEY;
    global.fetch = jest.fn() as any;
    expect(await new FmcsaClient().qc('384859')).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('qc: первый carrier из content, номер без нулей', async () => {
    process.env.FMCSA_WEBKEY = 'k';
    reply(200, { content: [{ carrier: { brokerAuthorityStatus: 'A', allowedToOperate: 'Y' } }] });
    expect(await new FmcsaClient().qc('055000')).toEqual({ brokerAuthorityStatus: 'A', allowedToOperate: 'Y' });
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/55000?webKey=k');
  });
  it('qc: пустой content → null (не найден)', async () => {
    process.env.FMCSA_WEBKEY = 'k';
    reply(200, { content: [] });
    expect(await new FmcsaClient().qc('9999999')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && npx jest src/shield/fmcsa.client.spec.ts`
Expected: FAIL — `Cannot find module './fmcsa.client'`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/shield/fmcsa.client.ts
import { Injectable } from '@nestjs/common';
import type { AuthHistRow, MotusRow, QcCarrier } from './authority';

const SODA = 'https://data.transportation.gov/resource';
const QC = 'https://mobile.fmcsa.dot.gov/qc/services';
const TIMEOUT_MS = 5000;

// docket в SODA: 'MC' + цифры, дополненные нулями до 6 (FF000031, MC384859, MC1819236)
export function docketOf(mc: string): string {
  return 'MC' + String(Number(mc)).padStart(6, '0');
}

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`FMCSA HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

@Injectable()
export class FmcsaClient {
  // AuthHist — история лицензий, заморожена с 05.2026 (даты выдачи старых брокеров)
  async authHist(mc: string): Promise<AuthHistRow[]> {
    const rows = await getJson(`${SODA}/9mw4-x3tu.json?docket_number=${docketOf(mc)}&$limit=200`);
    return Array.isArray(rows) ? rows : [];
  }

  // Motus AuthHist — события после перехода FMCSA на Motus, обновляется ежедневно
  async motus(mc: string): Promise<MotusRow[]> {
    const rows = await getJson(`${SODA}/yu5v-wbh6.json?docket_number=${docketOf(mc)}&$limit=200`);
    return Array.isArray(rows) ? rows : [];
  }

  // Текущий статус. undefined — нет ключа (фича выключена), null — docket не найден.
  async qc(mc: string): Promise<QcCarrier | null | undefined> {
    const key = process.env.FMCSA_WEBKEY;
    if (!key) return undefined;
    const body = await getJson(`${QC}/carriers/docket-number/${Number(mc)}?webKey=${encodeURIComponent(key)}`);
    const first = Array.isArray(body?.content) ? body.content[0] : null;
    return first?.carrier ?? null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && npx jest src/shield/fmcsa.client.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add backend/src/shield/fmcsa.client.ts backend/src/shield/fmcsa.client.spec.ts
git commit -m "feat(shield): клиент FMCSA — SODA AuthHist/Motus и QCMobile под FMCSA_WEBKEY"
```

---

### Task 3: Счётчик перепостов (`repost.ts`) + индекс

**Files:**
- Create: `backend/src/shield/repost.ts`
- Modify: `backend/src/main.ts` (после строки `CREATE INDEX IF NOT EXISTS users_paddle_customer_id …`)
- Test: `backend/src/shield/repost.spec.ts` (реальный Postgres, иначе skip)

**Interfaces:**
- Produces:
  - `const REPOST_WINDOW_DAYS = 14`
  - `interface RepostStats { count: number; days: number; windowDays: number }`
  - `repostStats(sequelize: Sequelize, mc: string, o: string, d: string, e: string): Promise<RepostStats>` — `mc` уже нормализован (только цифры).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/shield/repost.spec.ts
import { Sequelize } from 'sequelize-typescript';
import { Load } from '../loads/load.model';
import { repostStats } from './repost';

// Реальный Postgres: cd backend && LL_TEST_DATABASE_URL=postgresql://loadlens:loadlens@localhost:5435/loadlens npx jest repost
const url = process.env.LL_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('repostStats', () => {
  let sequelize: Sequelize;
  const DAY = 86_400_000;
  const base = { board: 'dat', originMarket: 'RS_TEST_O', destMarket: 'RS_TEST_D', equipment: 'V',
    groupKey: 'dat|RS_TEST_O>RS_TEST_D|V', rate: 2000, loadedMiles: 700, deadheadMiles: 0 };

  beforeAll(async () => {
    sequelize = new Sequelize(url!, { dialect: 'postgres', logging: false, models: [Load] });
    await sequelize.sync();
    await Load.destroy({ where: { originMarket: 'RS_TEST_O' } });
    const now = Date.now();
    await Load.bulkCreate([
      // сырой формат MC из парсера — счётчик должен его нормализовать
      { ...base, loadId: 'RS1', brokerMc: 'MC-555000', firstSeen: new Date(now - 0 * DAY) },
      { ...base, loadId: 'RS2', brokerMc: '555000', firstSeen: new Date(now - 1 * DAY) },
      { ...base, loadId: 'RS3', brokerMc: '555000', firstSeen: new Date(now - 1 * DAY) },
      { ...base, loadId: 'RS4', brokerMc: '555000', firstSeen: new Date(now - 3 * DAY) },
      { ...base, loadId: 'RS5', brokerMc: '555000', firstSeen: new Date(now - 20 * DAY) }, // вне окна
      { ...base, loadId: 'RS6', brokerMc: '999999', firstSeen: new Date(now) },            // чужой брокер
      { ...base, loadId: 'RS7', brokerMc: '555000', equipment: 'R', firstSeen: new Date(now) }, // другой прицеп
    ] as any[]);
  });
  afterAll(async () => {
    await Load.destroy({ where: { originMarket: 'RS_TEST_O' } });
    await sequelize.close();
  });

  it('считает разные load_id и дни в окне 14 дней, нормализуя MC', async () => {
    expect(await repostStats(sequelize as any, '555000', 'RS_TEST_O', 'RS_TEST_D', 'V'))
      .toEqual({ count: 4, days: 3, windowDays: 14 });
  });
  it('нет данных → нули', async () => {
    expect(await repostStats(sequelize as any, '123', 'RS_TEST_O', 'RS_TEST_D', 'V'))
      .toEqual({ count: 0, days: 0, windowDays: 14 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Сначала поднять БД, если не поднята: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && docker compose -p loadlens up -d`
Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && LL_TEST_DATABASE_URL=postgresql://loadlens:loadlens@localhost:5435/loadlens npx jest src/shield/repost.spec.ts`
Expected: FAIL — `Cannot find module './repost'`. (Если БД недоступна — тест skip; тогда зафиксировать это в отчёте задачи и всё равно реализовать.)

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/shield/repost.ts
import { QueryTypes, Sequelize } from 'sequelize';

export const REPOST_WINDOW_DAYS = 14;
export interface RepostStats { count: number; days: number; windowDays: number }

// Перепосты: сколько разных постингов один брокер дал по одному lane+прицепу за окно и сколько
// разных дней они покрывают. broker_mc в loads сырой (MC-555000 / 555000) → сравниваем по цифрам.
// Наружу — только счётчики (без постингов и PII).
export async function repostStats(
  sequelize: Sequelize, mc: string, o: string, d: string, e: string,
): Promise<RepostStats> {
  const rows = await sequelize.query<{ count: number; days: number }>(
    `SELECT count(DISTINCT load_id)::int AS count, count(DISTINCT first_seen::date)::int AS days
       FROM loads
      WHERE regexp_replace(broker_mc, '\\D', '', 'g') = :mc
        AND origin_market = :o AND dest_market = :d AND equipment = :e
        AND first_seen > now() - interval '${REPOST_WINDOW_DAYS} days'`,
    { type: QueryTypes.SELECT, replacements: { mc, o, d, e } },
  );
  const r = rows[0] || { count: 0, days: 0 };
  return { count: Number(r.count) || 0, days: Number(r.days) || 0, windowDays: REPOST_WINDOW_DAYS };
}
```

В `backend/src/main.ts` сразу после строки
`await sequelize.query('CREATE INDEX IF NOT EXISTS users_paddle_customer_id ON users (paddle_customer_id)');` добавить:

```ts
  // Fraud Shield: перепосты ищутся по цифрам MC брокера + first_seen (repost.ts)
  await sequelize.query(
    "CREATE INDEX IF NOT EXISTS loads_broker_mc_digits_first_seen ON loads ((regexp_replace(broker_mc, '\\D', '', 'g')), first_seen)",
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && LL_TEST_DATABASE_URL=postgresql://loadlens:loadlens@localhost:5435/loadlens npx jest src/shield/repost.spec.ts && npm run build`
Expected: PASS (2 tests), build без ошибок.

- [ ] **Step 5: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add backend/src/shield/repost.ts backend/src/shield/repost.spec.ts backend/src/main.ts
git commit -m "feat(shield): счётчик перепостов брокера по lane из крауд-БД + индекс"
```

---

### Task 4: Кэш, сервис, контроллер, модуль

**Files:**
- Create: `backend/src/shield/fmcsa-authority.model.ts`, `backend/src/shield/shield.service.ts`, `backend/src/shield/shield.controller.ts`, `backend/src/shield/shield.module.ts`
- Modify: `backend/src/app.module.ts` (импорт модели в `models: [...]`, `ShieldModule` в `imports`), `backend/.env.example`
- Test: `backend/src/shield/shield.service.spec.ts`

**Interfaces:**
- Consumes: `deriveStatus`, `deriveHistory`, `Authority` (Task 1); `FmcsaClient` (Task 2); `repostStats`, `RepostStats` (Task 3); `normalizeMc` из `../brokers/brokers.service`.
- Produces:
  - `GET /api/v1/brokers/:mc/shield?o=&d=&e=` → `ShieldResponse { mc: string; authority: Authority | null; repost: RepostStats | null }`
  - `ShieldService.shield(mcRaw: string, o?: string, d?: string, e?: string, now?: Date): Promise<ShieldResponse>`
  - `ShieldService.authority(mc: string, now?: Date): Promise<Authority | null>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/shield/shield.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { ShieldService } from './shield.service';

const NOW = new Date('2026-10-07T12:00:00Z');
const HOUR = 3_600_000;

function setup(over: Partial<Record<'qc' | 'authHist' | 'motus', jest.Mock>> = {}, cached: any = null) {
  const store = new Map<string, any>(cached ? [[cached.mc, cached]] : []);
  const model = {
    findByPk: jest.fn(async (mc: string) => store.get(mc) ?? null),
    upsert: jest.fn(async (row: any) => { store.set(row.mc, row); }),
  };
  const fmcsa = {
    qc: over.qc ?? jest.fn().mockResolvedValue({ brokerAuthorityStatus: 'A', allowedToOperate: 'Y' }),
    authHist: over.authHist ?? jest.fn().mockResolvedValue([{ mod_col_1: 'PROPERTY BROKER', original_action_desc: 'GRANTED', orig_served_date: '07/12/2000' }]),
    motus: over.motus ?? jest.fn().mockResolvedValue([]),
  };
  const sequelize = { query: jest.fn().mockResolvedValue([{ count: 6, days: 4 }]) };
  return { svc: new ShieldService(model as any, fmcsa as any, sequelize as any), model, fmcsa, sequelize };
}

describe('ShieldService', () => {
  it('собирает статус + историю и кэширует полный результат', async () => {
    const { svc, model } = setup();
    const a = await svc.authority('384859', NOW);
    expect(a).toMatchObject({ status: 'active', allowedToOperate: true, grantedAt: '2000-07-12', incidents12m: 0 });
    expect(model.upsert).toHaveBeenCalledTimes(1);
  });
  it('без ключа status=null, история есть, кэшируется', async () => {
    const { svc, model } = setup({ qc: jest.fn().mockResolvedValue(undefined) });
    const a = await svc.authority('384859', NOW);
    expect(a).toMatchObject({ status: null, allowedToOperate: null, grantedAt: '2000-07-12' });
    expect(model.upsert).toHaveBeenCalled();
  });
  it('docket не найден → not_found', async () => {
    const { svc } = setup({ qc: jest.fn().mockResolvedValue(null), authHist: jest.fn().mockResolvedValue([]) });
    expect((await svc.authority('9999999', NOW))!.status).toBe('not_found');
  });
  it('свежий кэш — без сетевых запросов', async () => {
    const cached = { mc: '1', data: { status: 'active' }, fetchedAt: new Date(NOW.getTime() - 2 * HOUR) };
    const { svc, fmcsa } = setup({}, cached);
    expect(await svc.authority('1', NOW)).toEqual({ status: 'active' });
    expect(fmcsa.authHist).not.toHaveBeenCalled();
  });
  it('not_found живёт в кэше 6ч, а не 24ч', async () => {
    const cached = { mc: '1', data: { status: 'not_found' }, fetchedAt: new Date(NOW.getTime() - 7 * HOUR) };
    const { svc, fmcsa } = setup({}, cached);
    await svc.authority('1', NOW);
    expect(fmcsa.authHist).toHaveBeenCalled();
  });
  it('все источники упали → протухший кэш', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('FMCSA HTTP 503'));
    const cached = { mc: '1', data: { status: 'active', grantedAt: '2000-07-12' }, fetchedAt: new Date(NOW.getTime() - 48 * HOUR) };
    const { svc } = setup({ qc: boom, authHist: boom, motus: boom }, cached);
    expect(await svc.authority('1', NOW)).toEqual({ status: 'active', grantedAt: '2000-07-12' });
  });
  it('все источники упали и кэша нет → null', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('timeout'));
    const { svc } = setup({ qc: boom, authHist: boom, motus: boom });
    expect(await svc.authority('1', NOW)).toBeNull();
  });
  it('частичный сбой (QCMobile упал) — отдаём, но не кэшируем', async () => {
    const { svc, model } = setup({ qc: jest.fn().mockRejectedValue(new Error('x')) });
    const a = await svc.authority('384859', NOW);
    expect(a).toMatchObject({ status: null, grantedAt: '2000-07-12' });
    expect(model.upsert).not.toHaveBeenCalled();
  });
  it('параллельные запросы одного MC дедупятся', async () => {
    const { svc, fmcsa } = setup();
    await Promise.all([svc.authority('384859', NOW), svc.authority('384859', NOW)]);
    expect(fmcsa.authHist).toHaveBeenCalledTimes(1);
  });
  it('shield: нормализует MC, считает repost только при полном lane', async () => {
    const { svc, sequelize } = setup();
    const full = await svc.shield('MC-384859', 'A_TX', 'B_GA', 'V', NOW);
    expect(full.mc).toBe('384859');
    expect(full.repost).toEqual({ count: 6, days: 4, windowDays: 14 });
    const partial = await svc.shield('384859', 'A_TX', undefined, 'V', NOW);
    expect(partial.repost).toBeNull();
    expect(sequelize.query).toHaveBeenCalledTimes(1);
  });
  it('shield: нецифровой MC → 400', async () => {
    const { svc } = setup();
    await expect(svc.shield('abc')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && npx jest src/shield/shield.service.spec.ts`
Expected: FAIL — `Cannot find module './shield.service'`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/shield/fmcsa-authority.model.ts
import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Кэш ответа FMCSA по MC (Fraud Shield). data — Authority из authority.ts.
@Table({ tableName: 'fmcsa_authority', timestamps: false })
export class FmcsaAuthority extends Model {
  @Column({ type: DataType.TEXT, primaryKey: true })
  mc: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  data: object;

  @Column({ type: DataType.DATE, allowNull: false, field: 'fetched_at' })
  fetchedAt: Date;
}
```

```ts
// backend/src/shield/shield.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize';
import { normalizeMc } from '../brokers/brokers.service';
import { Authority, deriveHistory, deriveStatus } from './authority';
import { FmcsaClient } from './fmcsa.client';
import { FmcsaAuthority } from './fmcsa-authority.model';
import { repostStats, RepostStats } from './repost';

const HOUR = 3_600_000;
const TTL_FOUND = 24 * HOUR;
const TTL_NOT_FOUND = 6 * HOUR;

export interface ShieldResponse { mc: string; authority: Authority | null; repost: RepostStats | null }

@Injectable()
export class ShieldService {
  private readonly log = new Logger('ShieldService');
  private readonly inflight = new Map<string, Promise<Authority | null>>();

  constructor(
    @InjectModel(FmcsaAuthority) private readonly model: typeof FmcsaAuthority,
    private readonly fmcsa: FmcsaClient,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async shield(mcRaw: string, o?: string, d?: string, e?: string, now = new Date()): Promise<ShieldResponse> {
    const mc = normalizeMc(mcRaw);
    if (!/^\d{1,8}$/.test(mc)) throw new BadRequestException('invalid MC');
    const [authority, repost] = await Promise.all([
      this.authority(mc, now),
      o && d && e ? repostStats(this.sequelize, mc, o, d, e) : Promise.resolve(null),
    ]);
    return { mc, authority, repost };
  }

  // одновременные промахи по одному MC (много грузов брокера на странице) — один поход в FMCSA
  authority(mc: string, now = new Date()): Promise<Authority | null> {
    const hit = this.inflight.get(mc);
    if (hit) return hit;
    const p = this.load(mc, now).finally(() => this.inflight.delete(mc));
    this.inflight.set(mc, p);
    return p;
  }

  private async load(mc: string, now: Date): Promise<Authority | null> {
    const row = await this.model.findByPk(mc);
    if (row) {
      const ttl = (row.data as Authority).status === 'not_found' ? TTL_NOT_FOUND : TTL_FOUND;
      if (now.getTime() - new Date(row.fetchedAt).getTime() < ttl) return row.data as Authority;
    }
    const [qc, hist, motus] = await Promise.allSettled([
      this.fmcsa.qc(mc), this.fmcsa.authHist(mc), this.fmcsa.motus(mc),
    ]);
    const failed = [qc, hist, motus].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) this.log.warn(`FMCSA ${mc}: ${failed.map((f) => String(f.reason?.message || f.reason)).join('; ')}`);
    if (failed.length === 3) return row ? (row.data as Authority) : null;

    const carrier = qc.status === 'fulfilled' ? qc.value : undefined;
    const history = deriveHistory(
      hist.status === 'fulfilled' ? hist.value : [],
      motus.status === 'fulfilled' ? motus.value : [],
      now,
    );
    const authority: Authority = {
      status: carrier === undefined ? null : deriveStatus(carrier),
      allowedToOperate: carrier ? (carrier.allowedToOperate === 'Y' ? true : carrier.allowedToOperate === 'N' ? false : null) : null,
      ...history,
      checkedAt: now.toISOString(),
    };
    // частичный результат не кэшируем — иначе сутки показывали бы «нет статуса» из-за одного таймаута
    if (!failed.length) await this.model.upsert({ mc, data: authority, fetchedAt: now } as any);
    return authority;
  }
}
```

```ts
// backend/src/shield/shield.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShieldService } from './shield.service';

// Fraud Shield открыт всем (решение 2026-10-07, вариант B): без PremiumReadGuard.
// Свой лимит выше глобального: расширение спрашивает по каждой паре брокер+lane на странице.
@Controller('brokers')
export class ShieldController {
  constructor(private readonly service: ShieldService) {}

  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @Get(':mc/shield')
  shield(@Param('mc') mc: string, @Query('o') o?: string, @Query('d') d?: string, @Query('e') e?: string) {
    return this.service.shield(mc, o, d, e);
  }
}
```

```ts
// backend/src/shield/shield.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FmcsaAuthority } from './fmcsa-authority.model';
import { FmcsaClient } from './fmcsa.client';
import { ShieldController } from './shield.controller';
import { ShieldService } from './shield.service';

@Module({
  imports: [SequelizeModule.forFeature([FmcsaAuthority])],
  controllers: [ShieldController],
  providers: [ShieldService, FmcsaClient],
})
export class ShieldModule {}
```

`backend/src/app.module.ts`: добавить импорты
```ts
import { FmcsaAuthority } from './shield/fmcsa-authority.model';
import { ShieldModule } from './shield/shield.module';
```
в `models: [...]` дописать `FmcsaAuthority` последним элементом, в массив `imports` модуля — `ShieldModule` (рядом с `BrokersModule`).

`backend/.env.example`: в конец добавить
```
# Fraud Shield: ключ FMCSA QCMobile (бесплатно, mobile.fmcsa.dot.gov → Login.gov → My WebKeys).
# Без ключа нет текущего статуса лицензии брокера (флаги inactive/carrier_only/not_found); возраст и инциденты
# из открытых датасетов DOT и перепосты работают и так.
FMCSA_WEBKEY=
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && npx jest src/shield && npm run build`
Expected: PASS (все spec в shield/, repost — skip без БД), build без ошибок.

- [ ] **Step 5: Smoke против живого DOT (без ключа)**

Run:
```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield/backend && docker compose -p loadlens up -d && \
(PORT=3099 DATABASE_URL=postgresql://loadlens:loadlens@localhost:5435/loadlens JWT_SECRET=x node dist/main.js & echo $! > /tmp/ll-shield.pid) && \
sleep 8 && curl -s "http://localhost:3099/api/v1/brokers/MC-384859/shield?o=A&d=B&e=V"; echo; kill $(cat /tmp/ll-shield.pid)
```
Expected: JSON вида `{"mc":"384859","authority":{"status":null,"allowedToOperate":null,"grantedAt":"2000-07-12",...},"repost":{"count":0,"days":0,"windowDays":14}}`. Если `dist/main.js` лежит по другому пути — взять путь из `backend/package.json` `start:prod`.

- [ ] **Step 6: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add backend/src/shield backend/src/app.module.ts backend/.env.example
git commit -m "feat(shield): открытый GET /brokers/:mc/shield — лицензия FMCSA с кэшем и перепосты"
```

---

### Task 5: Флаги и чип в `shared/scoring.js`

**Files:**
- Modify: `shared/scoring.js` (функция `redFlags`, новая `shieldBadge`, строка `return { … }` экспорта)
- Test: `shared/scoring.test.js` (добавить в конец блока redFlags)
- Generated: `npm run sync:shared` → `extension/vendor/scoring.js`, `backend/shared/…`

**Interfaces:**
- Consumes: форма `ShieldResponse` из Task 4 (`{ mc, authority: {status, ageDays, incidents12m, …} | null, repost: {count, days, windowDays} | null }`).
- Produces:
  - `LLSCORE.redFlags(load, { laneMedian, reputation, shield }, opts)` — новые коды `authority_inactive`, `carrier_brokering`, `authority_not_found`, `new_authority`, `authority_incidents`, `reposted`
  - `LLSCORE.shieldBadge(shield)` → `{ level: 'good'|'warn'|'risk'|'unknown', text: string, title: string }`

- [ ] **Step 1: Write the failing test** (дописать в `shared/scoring.test.js` после теста «redFlags: чистый груз → нет флагов»)

```js
// ---------- Fraud Shield (FMCSA + перепосты) ----------
const SH = (authority, repost = null) => ({ mc: "1", authority, repost });
const A = (over = {}) => ({ status: "active", allowedToOperate: true, grantedAt: "2015-01-01", ageDays: 4000, incidents12m: 0, ...over });
const codes = (shield) => LLSCORE.redFlags({ brokerMc: "1", estimatedRatePerMile: 2.3, creditScore: 95 }, { laneMedian: 2.2, shield });

test("redFlags shield: активный старый брокер без перепостов → нет флагов", () => {
  assert.deepStrictEqual(codes(SH(A(), { count: 2, days: 2, windowDays: 14 })), []);
});

test("redFlags shield: статусы FMCSA → high", () => {
  const f1 = codes(SH(A({ status: "inactive" })));
  assert.ok(f1.some((x) => x.code === "authority_inactive" && x.sev === "high"));
  const f2 = codes(SH(A({ status: "carrier_only" })));
  assert.ok(f2.some((x) => x.code === "carrier_brokering" && x.sev === "high"));
  const f3 = codes(SH(A({ status: "not_found", ageDays: null })));
  assert.ok(f3.some((x) => x.code === "authority_not_found" && x.sev === "high"));
});

test("redFlags shield: status=null (нет ключа) — статусных флагов нет", () => {
  assert.deepStrictEqual(codes(SH(A({ status: null }))), []);
});

test("redFlags shield: молодая лицензия — med <180д, high <90д, null — без флага", () => {
  assert.ok(codes(SH(A({ ageDays: 120 }))).some((x) => x.code === "new_authority" && x.sev === "med" && /120 days/.test(x.label)));
  assert.ok(codes(SH(A({ ageDays: 45 }))).some((x) => x.code === "new_authority" && x.sev === "high"));
  assert.deepStrictEqual(codes(SH(A({ ageDays: null, grantedAt: null }))), []);
});

test("redFlags shield: инциденты за 12 мес → med", () => {
  const f = codes(SH(A({ incidents12m: 2 })));
  assert.ok(f.some((x) => x.code === "authority_incidents" && x.sev === "med" && /2 /.test(x.label)));
});

test("redFlags shield: перепосты — порог count>=4 и days>=3", () => {
  assert.ok(codes(SH(A(), { count: 6, days: 4, windowDays: 14 })).some((x) => x.code === "reposted" && x.label === "reposted 6× over 4 days"));
  assert.deepStrictEqual(codes(SH(A(), { count: 6, days: 2, windowDays: 14 })), []);
  assert.deepStrictEqual(codes(SH(A(), { count: 3, days: 3, windowDays: 14 })), []);
});

test("redFlags shield: authority=null (DOT лёг) и shield отсутствует — как раньше", () => {
  assert.deepStrictEqual(codes(SH(null)), []);
  assert.deepStrictEqual(codes(undefined), []);
});

test("shieldBadge: уровни и текст", () => {
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: 800 })))), { level: "good", text: "🛡 2y ✓" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: 45 })))), { level: "risk", text: "🛡 45d" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ ageDays: 200 })))), { level: "warn", text: "🛡 6mo" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ status: "inactive" })))), { level: "risk", text: "🛡 ✗" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ status: null, ageDays: 4000 })))), { level: "good", text: "🛡 10y" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(A({ incidents12m: 1 })))), { level: "warn", text: "🛡 10y" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(SH(null))), { level: "unknown", text: "🛡 ?" });
  assert.deepStrictEqual(pick(LLSCORE.shieldBadge(undefined)), { level: "unknown", text: "🛡 ?" });
  assert.ok(/FMCSA/.test(LLSCORE.shieldBadge(SH(A())).title));
});
function pick(b) { return { level: b.level, text: b.text }; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield && node --test shared/scoring.test.js`
Expected: FAIL — `LLSCORE.shieldBadge is not a function` и падения новых redFlags-тестов.

- [ ] **Step 3: Write minimal implementation**

В `shared/scoring.js` в `redFlags`: расширить дефолты `opts` и дописать блок перед `return flags;`:

```js
    const o = { aboveMarketX: 1.5, creditRisk: 75, newAuthMedDays: 180, newAuthHighDays: 90,
      repostMinCount: 4, repostMinDays: 3, ...opts };
```

```js
    // Fraud Shield: лицензия FMCSA (status — только из QCMobile; null = нет данных → молчим)
    const a = ctx.shield && ctx.shield.authority;
    if (a) {
      if (a.status === "inactive") flags.push({ code: "authority_inactive", sev: "high", label: "FMCSA: broker authority inactive" });
      if (a.status === "carrier_only") flags.push({ code: "carrier_brokering", sev: "high",
        label: "FMCSA: carrier authority only — possible double-brokering" });
      if (a.status === "not_found") flags.push({ code: "authority_not_found", sev: "high", label: "FMCSA: MC not found" });
      if (a.ageDays != null && a.ageDays < o.newAuthMedDays) flags.push({ code: "new_authority",
        sev: a.ageDays < o.newAuthHighDays ? "high" : "med", label: `new broker authority: ${a.ageDays} days` });
      if (a.incidents12m > 0) flags.push({ code: "authority_incidents", sev: "med",
        label: `FMCSA: ${a.incidents12m} suspension/revocation event${a.incidents12m > 1 ? "s" : ""} in 12 mo` });
    }
    const rp = ctx.shield && ctx.shield.repost;
    if (rp && rp.count >= o.repostMinCount && rp.days >= o.repostMinDays) flags.push({ code: "reposted", sev: "med",
      label: `reposted ${rp.count}× over ${rp.days} days` });
```

Сразу после функции `redFlagLevel` добавить:

```js
  // Чип 🛡 в полосе брокера: сводка Fraud Shield одним словом. risk — любой high-сигнал лицензии;
  // warn — лицензии < 1 года или были инциденты; good — есть возраст/статус и всё чисто.
  function shieldBadge(shield) {
    const a = shield && shield.authority;
    if (!a || (a.status == null && a.ageDays == null)) return { level: "unknown", text: "🛡 ?", title: "FMCSA data unavailable" };
    const age = a.ageDays == null ? null
      : a.ageDays >= 365 ? Math.floor(a.ageDays / 365) + "y"
      : a.ageDays >= 90 ? Math.floor(a.ageDays / 30) + "mo" : a.ageDays + "d";
    const bad = a.status === "inactive" || a.status === "carrier_only" || a.status === "not_found";
    const title = [
      a.status ? "FMCSA status: " + a.status.replace("_", " ") : "FMCSA status: n/a",
      a.grantedAt ? "broker authority since " + a.grantedAt : null,
      a.incidents12m ? `${a.incidents12m} suspension/revocation event(s) in 12 mo` : null,
    ].filter(Boolean).join("\n");
    if (bad) return { level: "risk", text: "🛡 ✗", title };
    if (a.ageDays != null && a.ageDays < 90) return { level: "risk", text: "🛡 " + age, title };
    if ((a.ageDays != null && a.ageDays < 365) || a.incidents12m > 0) return { level: "warn", text: "🛡 " + (age || "?"), title };
    return { level: "good", text: "🛡 " + (age || "") + (a.status === "active" ? " ✓" : ""), title };
  }
```

Расширить экспорт:

```js
  return { DEFAULTS, fuelCost, tollsCost, trueRpm, netRpm, targetForMiles, profitBadge, brokerBadge, redFlags, redFlagLevel, shieldBadge, counterOffer };
```

Проверка ожиданий теста: ageDays 800 → `2y`, status active → `🛡 2y ✓`; ageDays 4000 и status null → `🛡 10y` (без ✓); ageDays 200 → `6mo`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield && node --test shared/scoring.test.js && npm run sync:shared && npm run check:lang`
Expected: PASS всех тестов scoring, sync без ошибок, check:lang чисто.

- [ ] **Step 5: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add shared/scoring.js shared/scoring.test.js extension/vendor backend/shared
git commit -m "feat(scoring): флаги Fraud Shield (лицензия FMCSA, перепосты) и чип shieldBadge"
```

---

### Task 6: Расширение — `getShield`, кэш, чип 🛡, «N reports»

**Files:**
- Modify: `extension/api.js` (новая `getShield` рядом с `getBrokerReputation`, экспорт), `extension/content.js` (кэши ~строка 59–70, `fetchLanes` ~113, новая `fetchShields` после `fetchBrokerReps` ~146, `badgeRow` ~192–215, `look`/`detailFacts` ~443–470, `render` ~545), `extension/view-model.js` (`detail`, строка `RPM`)
- Test: `extension/api.test.js`, `extension/view-model.test.js`

**Interfaces:**
- Consumes: `GET /brokers/:mc/shield` (Task 4), `LLSCORE.redFlags(…, {shield})`, `LLSCORE.shieldBadge` (Task 5).
- Produces:
  - `LLAPI.getShield(mc, o, d, e): Promise<ShieldResponse | null>`
  - `detailFacts(load)` возвращает дополнительно `laneCount: number | null`, `shield: ShieldResponse | null`
  - строка RPM в карточке: `market $2.41 · 37 reports` (если `laneCount` есть)

- [ ] **Step 1: Write the failing tests**

В конец `extension/api.test.js`:

```js
test("getShield: открытый GET с lane-параметрами, null при ошибке", async () => {
  const origFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ mc: "555000", authority: null, repost: null }) }; };
  try {
    const r = await LLAPI.getShield("MC-555000", "CHICAGO_IL", "DALLAS_TX", "R");
    assert.deepStrictEqual(r, { mc: "555000", authority: null, repost: null });
    assert.ok(calls[0].endsWith("/brokers/MC-555000/shield?o=CHICAGO_IL&d=DALLAS_TX&e=R"), calls[0]);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.strictEqual(await LLAPI.getShield("1", "A", "B", "V"), null);
  } finally { globalThis.fetch = origFetch; }
});
```

В конец `extension/view-model.test.js` (хелперы `input`, `load`, `facts` уже есть в файле — использовать их):

```js
test("detail: размер крауда рядом с медианой рынка", () => {
  const l = load();
  const d = LLVIEW.build(input({ loads: [l], detailLoad: l, detailFacts: facts({ laneMedian: 2.41, laneCount: 37 }) })).detail;
  const rpm = d.rows.find((r) => r.k === "RPM").v;
  assert.ok(rpm.includes("market $2.41 · 37 reports"), rpm);
});

test("detail: без laneCount — прежний формат «market $X»", () => {
  const l = load();
  const d = LLVIEW.build(input({ loads: [l], detailLoad: l, detailFacts: facts({ laneMedian: 2.41 }) })).detail;
  const rpm = d.rows.find((r) => r.k === "RPM").v;
  assert.ok(rpm.includes("market $2.41") && !rpm.includes("reports"), rpm);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield && node --test extension/api.test.js extension/view-model.test.js`
Expected: FAIL — `LLAPI.getShield is not a function`; view-model: нет «37 reports».

- [ ] **Step 3: Implement**

`extension/api.js` — после `getBrokerReputation`:

```js
  // Fraud Shield: лицензия FMCSA + перепосты брокера по lane. Открыт всем планам (Bearer — если есть).
  async function getShield(mc, origin, dest, equipment) {
    try {
      const q = new URLSearchParams({ o: origin, d: dest, e: equipment });
      const res = await fetch(`${BASE}/brokers/${encodeURIComponent(mc)}/shield?${q.toString()}`, { headers: await authHeader() });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }
```
и добавить `getShield` в возвращаемый объект после `getBrokerReputation`.

`authHeader()` без логина возвращает `{}` — отдельной ветки для анонима не нужно.

`extension/view-model.js` — в `detail()` заменить элемент массива RPM

```js
      f.laneMedian != null ? `market $${f.laneMedian.toFixed(2)}` : null,
```
на
```js
      f.laneMedian != null ? `market $${f.laneMedian.toFixed(2)}${f.laneCount ? ` · ${f.laneCount} reports` : ""}` : null,
```

`extension/content.js`:

1. Рядом с `const repCache = new Map();` добавить
```js
  const laneCountCache = new Map(); // "O>D|E" -> n грузов за медианой (размер крауда, Pro)
  const shieldCache = new Map();    // "mc|O>D|E" -> Fraud Shield (FMCSA + перепосты), открыт всем
```
и рядом с `const repRequested = new Set();` — `const shieldRequested = new Set();`

2. В `fetchLanes` заменить тело `.then`:
```js
      LLAPI.getLane(l.originMarket, l.destMarket, l.equipment).then((s) => {
        laneCache.set(k, s && s.level === "lane" ? s.medianRpm : null);
        laneCountCache.set(k, s && s.level === "lane" ? s.n : null);
        schedule();
      }).catch(() => {});
```

3. После `refreshRep` добавить:
```js
  function shieldKeyOf(l) { return `${l.brokerMc}|${laneKeyOf(l)}`; }
  // Fraud Shield по паре брокер+lane; без MC/lane — не спрашиваем
  function fetchShields(loads) {
    if (typeof LLAPI === "undefined") return;
    loads.forEach((l) => {
      if (!l.brokerMc || !l.originMarket || !l.destMarket || !l.equipment) return;
      const k = shieldKeyOf(l);
      if (shieldRequested.has(k)) return;
      shieldRequested.add(k);
      LLAPI.getShield(l.brokerMc, l.originMarket, l.destMarket, l.equipment)
        .then((s) => { if (s) { shieldCache.set(k, s); schedule(); } }).catch(() => {});
    });
  }
```

4. В `render()` после `fetchBrokerReps(loads);` добавить `fetchShields(loads);`

5. В `badgeRow` заменить строку `const flags = LLSCORE.redFlags(...)` на
```js
    const shield = shieldCache.get(shieldKeyOf(load)) || null;
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: repCache.get(String(load.brokerMc)), shield });
```
и после строки `if (broker.level !== "unknown") host.appendChild(chip(brokerText(broker), …));` добавить
```js
    if (load.brokerMc && shield) {
      const sb = LLSCORE.shieldBadge(shield);
      const sc = chip(sb.text, "ll-broker ll-shield " + SHIELD_CLS[sb.level]);
      sc.title = sb.title;
      host.appendChild(sc);
    }
```
и над `function badgeRow` объявить
```js
  const SHIELD_CLS = { good: "ll-good", warn: "ll-ok", risk: "ll-risk", unknown: "ll-thin" };
```

6. В объекте `look` добавить
```js
    laneCountOf: (o, d, e) => { const v = laneCountCache.get(laneKeyOf({ originMarket: o, destMarket: d, equipment: e })); return v == null ? null : v; },
    shield: (l) => shieldCache.get(shieldKeyOf(l)) || null,
```

7. В `detailFacts` заменить вычисление флагов и дополнить возвращаемый объект:
```js
    const shield = load.brokerMc ? look.shield(load) : null;
    const flags = LLSCORE.redFlags(load, { laneMedian, reputation: rep, shield });
```
и в `return { laneMedian, rep, flags, offer, mail, …` добавить поля `laneCount: look.laneCountOf(load.originMarket, load.destMarket, load.equipment), shield,`

8. В `view-model.js` строка `Broker` в `detail()` — дописать сводку shield в конец массива перед `.filter(Boolean)`:
```js
      f.shield && f.shield.authority && typeof LLSCORE !== "undefined" ? LLSCORE.shieldBadge(f.shield).text : null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield && npm test`
Expected: всё зелёное (sync, build:landing, check:lang, scripts, shared, ext).

- [ ] **Step 5: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add extension/api.js extension/api.test.js extension/content.js extension/view-model.js extension/view-model.test.js
git commit -m "feat(ext): Fraud Shield — чип 🛡, флаги лицензии/перепостов, размер крауда в карточке"
```

---

### Task 7: Документация, полный прогон, ручная проверка

**Files:**
- Modify: `CLAUDE.md` (структура `backend/src/` — строка `shield/`; раздел «Конвенции» — пункт Fraud Shield; список env в «Деплой» — `FMCSA_WEBKEY`), `CHANGELOG.md` (секция `[Unreleased]`: строка `- Fraud Shield: broker authority check (FMCSA), repost detector, crowd size next to market rate.` — в стиле соседних записей)

- [ ] **Step 1: CLAUDE.md**

В блок структуры после строки `brokers/ …` добавить:
```
  shield/                   GET /brokers/:mc/shield — Fraud Shield (ОТКРЫТ всем, свой throttle 600/мин): лицензия FMCSA
                            (статус — QCMobile под FMCSA_WEBKEY; возраст/инциденты — SODA AuthHist+Motus) с кэшем
                            fmcsa_authority (24ч / not_found 6ч / частичный не кэшируется) + перепосты брокера по lane из loads
```
В «Конвенции» после пункта Crowd-репутации добавить:
```
- **Fraud Shield** (с 2026-10-07, `backend/src/shield/` + `LLSCORE.redFlags(ctx.shield)`/`shieldBadge`): чип `🛡` +
  флаги `authority_inactive`/`carrier_brokering`/`authority_not_found` (high, ТОЛЬКО из QCMobile — без `FMCSA_WEBKEY`
  их нет), `new_authority` (<180д med, <90д high), `authority_incidents`, `reposted` (≥4 постинга за ≥3 дня / 14д).
  **История FMCSA — журнал событий, не реестр:** нет брокерской записи ≠ нет лицензии → `null`, флага нет
  (у крупных брокеров в AuthHist бывают только перевозочные события). Бесплатно всем (acquisition); «N reports» — Pro.
  Спека — `docs/superpowers/specs/2026-10-07-fraud-shield-design.md`.
```
В абзаце Env (раздел «Деплой») дописать: «Опц. `FMCSA_WEBKEY` (без него у Fraud Shield нет текущего статуса лицензии)».

- [ ] **Step 2: Полный прогон**

Run:
```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield && npm test && \
cd backend && npm test && npm run build && \
LL_TEST_DATABASE_URL=postgresql://loadlens:loadlens@localhost:5435/loadlens npx jest src/shield/repost.spec.ts
```
Expected: всё зелёное; число тестов выросло (корень +~13, backend +~30).

- [ ] **Step 3: Ручная проверка расширения на фикстуре**

Run: `cd /Users/bogdan/work/startup/dat.com-fraud-shield && npm run e2e:popup`
Expected: зелёный (регрессия Settings не задета). Живую проверку чипа на DAT-вкладке оставить пользователю — записать в `tasks/0057`-подобный чеклист.

- [ ] **Step 4: Commit**

```bash
cd /Users/bogdan/work/startup/dat.com-fraud-shield
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: Fraud Shield в CLAUDE.md и CHANGELOG"
```

- [ ] **Step 5: Интеграция** — по скиллу superpowers:finishing-a-development-branch: ff-only мерж `fraud-shield` в main в основном каталоге, push = автодеплой; после деплоя `curl https://loadlens.krait.studio/api/v1/brokers/384859/shield` — `grantedAt: "2000-07-12"`. `FMCSA_WEBKEY` в Coolify — когда пользователь получит ключ.
