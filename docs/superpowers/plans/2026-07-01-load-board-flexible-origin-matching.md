# Load Board Flexible Origin/Dest Matching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LoadLens `partnerSearch` resolve free-text origin/dest (state code, exact market, or city) instead of requiring byte-exact equality, tolerating both `City, ST` and `CITY_ST` stored formats.

**Architecture:** A new pure resolver `buildMarketMatch(raw)` maps a raw query string to a Sequelize case-insensitive POSIX-regex clause (`Op.iRegexp` → Postgres `~*`). `partnerSearch` calls it for `originMarket` (required) and `destMarket` (optional). No frontend change; Fenderr already sends free text.

**Tech Stack:** NestJS, Sequelize (Postgres), Jest.

## Global Constraints

- Repo: `dat.com/backend` (loadlens, GitHub `bogbuk/loadlens`, branch `main`).
- Sequelize `Op` imported from `sequelize` (existing convention, see `loads.service.ts:3`).
- `Op.iRegexp` → Postgres `~*` (case-insensitive POSIX regex).
- Commit messages: no AI/Claude co-author mentions.
- Out of scope (do NOT touch): ingest normalization, legacy demo-row cleanup, frontend autocomplete, `equipment` matching.

---

### Task 1: Pure `buildMarketMatch` resolver

**Files:**
- Create: `backend/src/loads/market-match.ts`
- Test: `backend/src/loads/market-match.spec.ts`

**Interfaces:**
- Consumes: `Op` from `sequelize`.
- Produces: `buildMarketMatch(raw: string): Record<symbol, string> | null` — returns `{ [Op.iRegexp]: <pattern> }` or `null` for empty input.

- [ ] **Step 1: Write the failing test**

Create `backend/src/loads/market-match.spec.ts`:

```ts
import { Op } from 'sequelize';
import { buildMarketMatch } from './market-match';

// Extract the ~* pattern and check it behaves like Postgres case-insensitive regex.
function pat(raw: string): string | null {
  const m = buildMarketMatch(raw);
  return m ? (m[Op.iRegexp] as string) : null;
}
const matches = (raw: string, market: string): boolean => {
  const p = pat(raw);
  return p != null && new RegExp(p, 'i').test(market);
};

describe('buildMarketMatch', () => {
  it('empty / whitespace → null', () => {
    expect(buildMarketMatch('')).toBeNull();
    expect(buildMarketMatch('   ')).toBeNull();
    expect(buildMarketMatch(undefined as any)).toBeNull();
  });

  it('2-letter state → trailing-state pattern (uppercased), both formats', () => {
    expect(pat('IL')).toBe('[,_ ]IL$');
    expect(pat('il')).toBe('[,_ ]IL$');
    expect(matches('IL', 'Chicago, IL')).toBe(true);
    expect(matches('IL', 'CHICAGO_IL')).toBe(true);
    expect(matches('IL', 'Atlanta, GA')).toBe(false);
  });

  it('City, ST → anchored city+state, both formats', () => {
    expect(pat('Atlanta, GA')).toBe('^Atlanta[,_ ]+GA$');
    expect(matches('Atlanta, GA', 'Atlanta, GA')).toBe(true);
    expect(matches('Atlanta, GA', 'ATLANTA_GA')).toBe(true);
    expect(matches('atlanta,ga', 'Atlanta, GA')).toBe(true); // case + no space
    expect(matches('Atlanta, GA', 'Atlanta, GX')).toBe(false);
  });

  it('multi-word city uses [ _]+ between words', () => {
    expect(pat('Fort Worth, TX')).toBe('^Fort[ _]+Worth[,_ ]+TX$');
    expect(matches('Fort Worth, TX', 'Fort Worth, TX')).toBe(true);
    expect(matches('Fort Worth, TX', 'FORT_WORTH_TX')).toBe(true);
  });

  it('city only → city-prefix pattern, both formats', () => {
    expect(pat('Atlanta')).toBe('^Atlanta[,_ ]');
    expect(matches('Atlanta', 'Atlanta, GA')).toBe(true);
    expect(matches('Atlanta', 'ATLANTA_GA')).toBe(true);
    expect(matches('Atlanta', 'Atlantic City, NJ')).toBe(false);
  });

  it('escapes regex metacharacters in city (e.g. St. Louis)', () => {
    expect(pat('St. Louis, MO')).toBe('^St\\.[ _]+Louis[,_ ]+MO$');
    expect(matches('St. Louis, MO', 'St. Louis, MO')).toBe(true);
    expect(matches('St. Louis, MO', 'StX Louis, MO')).toBe(false); // '.' not a wildcard
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/loads/market-match.spec.ts`
Expected: FAIL — `Cannot find module './market-match'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/loads/market-match.ts`:

```ts
import { Op } from 'sequelize';

// POSIX ERE metacharacters to escape in literal city/state text.
const RE_META = /[.^$*+?()[\]{}|\\]/g;
const escapeRe = (s: string): string => s.replace(RE_META, '\\$&');

// City fragment: escape metachars, then turn whitespace runs into `[ _]+`
// so a multi-word city matches both "Fort Worth" and "FORT_WORTH".
const cityPat = (city: string): string => escapeRe(city.trim()).replace(/\s+/g, '[ _]+');

/**
 * Resolve a free-text market query to a Sequelize case-insensitive regex clause
 * (`Op.iRegexp` → Postgres `~*`). Tolerates both stored formats: "City, ST" and "CITY_ST".
 * Returns null for empty input (caller omits the filter).
 */
export function buildMarketMatch(raw: string): Record<symbol, string> | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // 2-letter token → state search: trailing state after any separator.
  if (/^[A-Za-z]{2}$/.test(s)) {
    return { [Op.iRegexp]: `[,_ ]${s.toUpperCase()}$` };
  }

  // "City, ST" → anchored city + state.
  const comma = s.indexOf(',');
  if (comma >= 0) {
    const city = s.slice(0, comma);
    const state = s.slice(comma + 1).trim();
    return { [Op.iRegexp]: `^${cityPat(city)}[,_ ]+${escapeRe(state)}$` };
  }

  // City only → prefix on the city part.
  return { [Op.iRegexp]: `^${cityPat(s)}[,_ ]` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/loads/market-match.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/loads/market-match.ts src/loads/market-match.spec.ts
git commit -m "feat(load-board): pure buildMarketMatch resolver (state/market/city, both formats)"
```

---

### Task 2: Wire resolver into `partnerSearch` (origin + dest)

**Files:**
- Modify: `backend/src/loads/loads.service.ts` (`partnerSearch`, ~lines 102-122; add import)
- Test: `backend/src/loads/loads.service.spec.ts` (update existing `partnerSearch` test + add cases)

**Interfaces:**
- Consumes: `buildMarketMatch` from `./market-match` (Task 1).
- Produces: `partnerSearch` now builds `where.originMarket` / `where.destMarket` as `{ [Op.iRegexp]: string }` clauses instead of exact strings.

- [ ] **Step 1: Update the existing test to expect regex clauses + add coverage**

In `backend/src/loads/loads.service.spec.ts`, replace the whole `describe('LoadsService.partnerSearch', …)` block (currently lines ~69-87) with:

```ts
describe('LoadsService.partnerSearch', () => {
  it('фильтрует по origin+dest (регекс-матч) и отдаёт rpmCents/ageMinutes', async () => {
    const lastSeen = new Date(Date.now() - 30 * 60 * 1000); // 30 мин назад
    const findAll = jest.fn().mockResolvedValue([
      { board: 'dat', loadId: 'L1', originMarket: 'Atlanta, GA', destMarket: 'Dallas, TX',
        equipment: 'V', groupKey: 'g', rate: 2000, loadedMiles: 780, deadheadMiles: 20,
        rpmCents: 250, weight: 42000, brokerMc: '123', brokerName: 'ACME', lastSeen },
    ]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    const res = await svc.partnerSearch('Atlanta, GA', { dest: 'Dallas, TX', equipment: 'V' });
    const whereArg = findAll.mock.calls[0][0].where;
    expect(whereArg.originMarket[Op.iRegexp]).toBe('^Atlanta[,_ ]+GA$');
    expect(whereArg.destMarket[Op.iRegexp]).toBe('^Dallas[,_ ]+TX$');
    expect(whereArg.equipment).toBe('V');
    expect(res[0].rpmCents).toBe(250);
    expect(typeof res[0].ageMinutes).toBe('number');
    expect(res[0].lastSeen).toBe(lastSeen.toISOString());
  });

  it('origin по коду штата → трейлинг-стейт паттерн; без dest — нет destMarket фильтра', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    await svc.partnerSearch('IL', {});
    const whereArg = findAll.mock.calls[0][0].where;
    expect(whereArg.originMarket[Op.iRegexp]).toBe('[,_ ]IL$');
    expect(whereArg.destMarket).toBeUndefined();
    expect(whereArg.equipment).toBeUndefined();
  });

  it('origin по городу → префиксный паттерн', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    await svc.partnerSearch('Atlanta', {});
    expect(findAll.mock.calls[0][0].where.originMarket[Op.iRegexp]).toBe('^Atlanta[,_ ]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/loads/loads.service.spec.ts`
Expected: FAIL — `whereArg.originMarket[Op.iRegexp]` is undefined (still exact-string `'Atlanta, GA'`).

- [ ] **Step 3: Wire the resolver into `partnerSearch`**

In `backend/src/loads/loads.service.ts`, add the import near the other local imports (after line 5, `import { IngestLoadsDto } from './dto/ingest.dto';`):

```ts
import { buildMarketMatch } from './market-match';
```

Then in `partnerSearch`, replace the current `where` construction:

```ts
    const where: any = {
      originMarket: origin,
      lastSeen: { [Op.gt]: new Date(Date.now() - CROWD_WINDOW_HOURS * 3600 * 1000) },
    };
    if (opts.dest) where.destMarket = opts.dest;
    if (opts.equipment) where.equipment = opts.equipment;
```

with:

```ts
    const where: any = {
      lastSeen: { [Op.gt]: new Date(Date.now() - CROWD_WINDOW_HOURS * 3600 * 1000) },
    };
    const originMatch = buildMarketMatch(origin);
    if (originMatch) where.originMarket = originMatch;
    if (opts.dest) {
      const destMatch = buildMarketMatch(opts.dest);
      if (destMatch) where.destMarket = destMatch;
    }
    if (opts.equipment) where.equipment = opts.equipment;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/loads/loads.service.spec.ts src/loads/market-match.spec.ts`
Expected: PASS (all partnerSearch cases + Task 1 tests).

- [ ] **Step 5: Verify the full build + suite**

Run: `cd backend && npx nest build && npx jest src/loads`
Expected: build succeeds; all `src/loads` specs pass.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/loads/loads.service.ts src/loads/loads.service.spec.ts
git commit -m "feat(load-board): flexible origin/dest matching in partnerSearch"
```

---

### Task 3: End-to-end verification against the running stack

**Files:** none (manual verification; LoadLens on :3100, Fenderr on :3333 already running from this session).

- [ ] **Step 1: Restart LoadLens to load the new code**

LoadLens `nest start` does NOT auto-load `.env` — source it explicitly:

```bash
cd /Users/bogdan/work/startup/dat.com/backend
pkill -f 'dat.com/backend'; sleep 2
set -a; . ./.env; set +a
nohup npm run start:dev > /tmp/loadlens-backend.log 2>&1 &
```

Wait ~14s, confirm: `lsof -nP -iTCP:3100 -sTCP:LISTEN | grep node`.

- [ ] **Step 2: Verify state-code search end-to-end through Fenderr**

```bash
BASE=http://127.0.0.1:3333/api/v1
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.test","password":"admin12345"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
curl -s -G "$BASE/load-board/search" --data-urlencode "origin=GA" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 200 with the 4 `Atlanta, GA` loads (state `GA` matches them).

- [ ] **Step 3: Verify city + case-insensitive searches**

Repeat Step 2 with `origin=atlanta` and `origin=Atlanta, GA` — both expected to return the same 4 Atlanta loads. Confirms city-prefix and case-insensitive market matching.

---

## Self-Review

**Spec coverage:**
- Resolver rules 1-4 (empty/state/market/city) → Task 1 (impl + unit tests). ✓
- Both-format tolerance (`~*`) → Task 1 regex + `matches()` assertions for `CITY_ST`. ✓
- Wiring into `partnerSearch` origin+dest → Task 2. ✓
- Regression/updated tests → Task 2 Step 1. ✓
- Performance note (`~*` seq scan, bounded window) → documented in spec; no code action (correct). ✓
- Out-of-scope items untouched → not referenced in any task. ✓

**Placeholder scan:** none — all steps carry full code and exact commands.

**Type consistency:** `buildMarketMatch` signature (`(raw: string) => Record<symbol, string> | null`) is identical in Task 1 (produces) and Task 2 (consumes). Pattern strings asserted in Task 2 (`^Atlanta[,_ ]+GA$`, `[,_ ]IL$`, `^Atlanta[,_ ]`) match the exact outputs asserted in Task 1.
