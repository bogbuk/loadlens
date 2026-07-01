# Design: Flexible origin/dest matching in LoadLens `partnerSearch`

Date: 2026-07-01
Status: approved
Repo: loadlens (`dat.com/backend`)

## Problem

The partner load-board search (`GET /api/v1/loads/partner`, consumed by the Fenderr
TMS `/load-board/search` proxy) filters `origin_market` / `dest_market` with **exact
equality**:

```ts
const where: any = { originMarket: origin, lastSeen: { [Op.gt]: … } };
if (opts.dest) where.destMarket = opts.dest;
```

Fenderr sends a **free-text** origin/dest (the UI field is a text input, placeholder
`e.g. Atlanta, GA`). Any input that isn't byte-identical to the stored market string
returns `[]`. Concretely:

- `origin=IL` (a state code) matches nothing — the user expects "loads out of Illinois".
- `origin=atlanta, ga` (different case) matches nothing.
- `origin=Atlanta` (city only) matches nothing.

Additionally the stored data uses **two formats**:
- Display format `Atlanta, GA` — what the DAT/Truckstop scraper writes (production reality).
- Legacy key format `CHICAGO_IL` — the geo canon (`shared/markets.seed.json`, used by the
  `near` subsystem) and older synthetic rows in the demo DB.

## Goal

Make origin/dest search resolve a free-text query to the right rows, supporting **state
code**, **exact market**, and **city** inputs, case-insensitively, tolerating **both**
stored formats (`City, ST` and `CITY_ST`).

Non-goal (explicit follow-ups, not in this change):
- Normalizing `origin_market`/`dest_market` on ingest.
- Cleaning up legacy `CHICAGO_IL` demo rows.
- Market autocomplete in the Fenderr frontend.
- Changing `equipment` matching (Fenderr and LoadLens already share DAT codes `V/R/F/…`).

## Design

### Pure resolver: `buildMarketMatch(raw) → { [Op.iRegexp]: string } | null`

A single pure function (new file `backend/src/loads/market-match.ts`) that maps a raw
user string to a Sequelize case-insensitive POSIX-regex clause (`Op.iRegexp` → Postgres
`~*`). Regex is required (not `iLike`) to tolerate both `,`/space and `_` separators in
one pattern.

Rules (applied in order), after `raw.trim()`:

1. **empty** → return `null` (caller omits the filter).
2. **state code** — `/^[A-Za-z]{2}$/` (e.g. `IL`, `ga`) → `{ [Op.iRegexp]: `[,_ ]${ST}$` }`.
   Matches a trailing state after any separator: `Chicago, IL` (`, IL`) and `CHICAGO_IL` (`_IL`).
3. **market** — contains a comma → split into `city, state`, trim both →
   `{ [Op.iRegexp]: `^${cityPat}[,_ ]+${statePat}$` }`. Matches `Atlanta, GA` and `ATLANTA_GA`.
4. **city only** — otherwise → `{ [Op.iRegexp]: `^${cityPat}[,_ ]` }`. Prefix on the city
   part: matches `Atlanta, GA` and `ATLANTA_GA`.

**Pattern building helpers:**
- `escapeRe(s)` — escape POSIX ERE metachars: `. ^ $ * + ? ( ) [ ] { } | \`.
- `cityPat(city)` = `escapeRe(city)` with runs of whitespace replaced by `[ _]+`, so a
  multi-word city matches both `Fort Worth` and `FORT_WORTH`.
- `statePat(state)` = `escapeRe(state)` (2 letters, no whitespace).

### Wiring in `partnerSearch`

```ts
const where: any = { lastSeen: { [Op.gt]: … } };
const originMatch = buildMarketMatch(origin);
if (originMatch) where.originMarket = originMatch;
if (opts.dest) {
  const destMatch = buildMarketMatch(opts.dest);
  if (destMatch) where.destMarket = destMatch;
}
```

`origin` is still required by the controller (`BadRequestException` if absent). If a
non-empty origin resolves to `null` (only possible for whitespace, already guarded
upstream) the filter is simply omitted — acceptable, origin is validated non-empty at the
controller.

`buildMarketMatch` knows nothing about Sequelize models — it only returns an `Op` clause,
so it is unit-tested in isolation (input string → expected pattern).

### Performance note

`~*` will not use a btree index on `origin_market`. `partnerSearch` already bounds the
scan by `lastSeen > now - 72h` and a `LIMIT` (≤200), so a sequential scan over the fresh
window is acceptable at this scale. Documented, not optimized now.

## Testing

Unit tests for `buildMarketMatch` (new `market-match.spec.ts`) — pure, no DB:
- empty / whitespace → `null`.
- `IL`, `il` → pattern `[,_ ]IL$` (uppercased state).
- `Atlanta, GA`, `atlanta,ga` (no space) → `^Atlanta[,_ ]+GA$` (case handled by `~*`).
- `Fort Worth, TX` → city part uses `[ _]+` between words.
- `Atlanta` → `^Atlanta[,_ ]`.
- `St. Louis, MO` → `.` in city escaped.
- assert each returned pattern actually matches both `Atlanta, GA` and `ATLANTA_GA`
  (and rejects an unrelated market) by running `new RegExp(pattern, 'i')` in the test.

Regression test in `loads.service.spec.ts` (or a focused integration spec) — seed rows in
both formats, assert:
- `partnerSearch('IL')` returns the Illinois rows (`Chicago, IL` and `CHICAGO_IL`).
- `partnerSearch('Atlanta')` returns the Atlanta rows.
- `partnerSearch('atlanta, ga')` returns the `Atlanta, GA` rows.
- dest filter narrows correctly with the same semantics.

## Files

- `backend/src/loads/market-match.ts` — new pure resolver.
- `backend/src/loads/market-match.spec.ts` — new unit tests.
- `backend/src/loads/loads.service.ts` — wire resolver into `partnerSearch` (origin + dest).
- `backend/src/loads/loads.service.spec.ts` — regression cases (or a new spec file).
