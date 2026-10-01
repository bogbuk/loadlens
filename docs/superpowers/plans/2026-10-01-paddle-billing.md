# Paddle Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пользователь сам покупает Pro ($24/мес) из Settings расширения через Paddle; Pro включается/выключается вебхуком; до запуска live кнопку видят только админы.

**Architecture:** Новый модуль `backend/src/billing/` — чистые функции в `billing.ts` (режим, видимость, подпись, маппинг события → patch пользователя), тонкий `PaddleClient` на fetch, `BillingService`/`BillingController`. Checkout — статическая `backend/public/checkout.html` с Paddle.js (в MV3-расширение удалённый скрипт грузить нельзя). Расширение показывает Upgrade/Manage только при `user.billing === true` из `/auth/me`.

**Tech Stack:** NestJS 10 + Sequelize (Postgres, `synchronize:true` + идемпотентные `ALTER TABLE` в `main.ts`), Jest (backend), `node:test` (extension, landing), Paddle Billing API v1 (REST, fetch), Paddle.js v2.

**Spec:** `docs/superpowers/specs/2026-10-01-paddle-billing-design.md`

## Global Constraints

- `BILLING_MODE`: `off` | `test` | `live`; пусто/неизвестное значение = `off`. `test` → только `role === 'admin'`; `live` → все не заблокированные.
- Без любого из `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_ID` оплата невидима при любом режиме.
- `PADDLE_ENV`: `production` → `https://api.paddle.com`; всё остальное → `https://sandbox-api.paddle.com` (безопасный дефолт).
- Цена Pro: **$24/мес** (задаётся в Paddle, в коде только `PADDLE_PRICE_ID`). Только месячный тариф.
- Подпись вебхука: `Paddle-Signature: ts=<unix sec>;h1=<hex>`, `h1 = HMAC-SHA256(PADDLE_WEBHOOK_SECRET, ts + ':' + rawBody)`, окно 5 минут.
- Статусы → план: `active`/`trialing`/`past_due` → `pro`; `paused`/`canceled` → `free`.
- Все метки времени в БД — BIGINT epoch ms; pg отдаёт BIGINT строкой → всегда `Number()`.
- `checkout.html`: `noindex`, не в sitemap, без Метрики, без ссылок на неё.
- Значения ключей Paddle не попадают в репозиторий/чат; `.env.example` — только имена.
- Коммиты — без упоминаний AI/Claude, без `Co-Authored-By`.
- Пуш в `main` = автодеплой в прод: пушить только с `BILLING_MODE` не заданным в Coolify (= off) и после зелёных тестов.

## Review Focus

1. **Повтор и перестановка вебхуков** — Paddle шлёт `subscription.updated` после `subscription.canceled` с более ранним `occurred_at`: план не должен «воскреснуть» в pro. Тест в Task 1 (`applySubscriptionEvent` игнорирует старое) и Task 4 (сервис не сохраняет).
2. **Вебхук до того, как мы узнали подписку** — первый `subscription.created` находит пользователя только по `custom_data.userId`; если `custom_data` нет (подписка создана в дашборде Paddle) — поиск по `paddle_customer_id`, иначе 200 + warn, без 500-цикла повторов. Тест в Task 4.
3. **Повторный клик Upgrade у действующего подписчика** — не должен создавать вторую подписку: 409. Тест в Task 4.
4. **Неадмин при `BILLING_MODE=test`** — не видит `billing:true` в `/auth/me` и получает 403 на `/billing/checkout`, даже если знает URL. Тесты в Task 1 и Task 4.
5. **Удаление аккаунта подписчика при недоступном Paddle** — аккаунт не удаляется (502), подписка не «осиротеет». Тест в Task 5.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `backend/src/billing/billing.ts` (new) | Чистые функции: `billingMode`, `billingConfigured`, `billingVisible`, `paddleApiBase`, `verifySignature`, `applySubscriptionEvent`, `hasLiveSubscription`, `subscriptionView` |
| `backend/src/billing/billing.spec.ts` (new) | Юнит-тесты чистых функций |
| `backend/src/billing/paddle.client.ts` (new) | fetch-клиент Paddle API: `findCustomerByEmail`, `createCustomer`, `createTransaction`, `createPortalSession`, `cancelSubscription` |
| `backend/src/billing/paddle.client.spec.ts` (new) | Тесты клиента с моком `fetch` |
| `backend/src/billing/billing.service.ts` (new) | Сценарии: `clientConfig`, `createCheckout`, `createPortal`, `handleWebhook`, `cancelForUser` |
| `backend/src/billing/billing.service.spec.ts` (new) | Тесты сервиса с моками модели и клиента |
| `backend/src/billing/billing.controller.ts` (new) | Маршруты `/billing/*` |
| `backend/src/billing/billing.module.ts` (new) | Модуль; экспортирует `BillingService` |
| `backend/src/users/user.model.ts` | +6 колонок подписки |
| `backend/src/main.ts` | `ALTER TABLE` новых колонок + индекс; `rawBody` в `json({verify})` |
| `backend/src/app.module.ts` | Подключить `BillingModule` |
| `backend/src/auth/auth.service.ts` | `publicUser` → `billing`, `subscription` |
| `backend/src/users/users.service.ts`, `users.module.ts` | `deleteMe` отменяет подписку |
| `backend/src/auth/admin.service.ts`, `backend/public/admin.html` | Статус подписки и число подписчиков |
| `backend/.env.example` | Имена env Paddle |
| `backend/public/checkout.html` (new) | Страница Paddle.js overlay |
| `scripts/landing-i18n.test.js` | Тест: checkout noindex, вне sitemap |
| `extension/plan-view.js`, `plan-view.test.js` | Поле `action`: `upgrade`/`manage`/`contact` |
| `extension/api.js` | `billingCheckout`, `billingPortal`; `billing`/`subscription` в кэше `ll_auth` |
| `extension/popup.js` | Кнопки Upgrade/Manage в `planNote` |
| `extension/manifest.json`, `CHANGELOG.md` | 0.9.4 |
| `CLAUDE.md` | Строка про billing в структуре/конвенциях/env |

---

### Task 1: Чистые функции биллинга

**Files:**
- Create: `backend/src/billing/billing.ts`
- Test: `backend/src/billing/billing.spec.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `type BillingMode = 'off' | 'test' | 'live'`
  - `billingMode(raw: string | undefined): BillingMode`
  - `billingConfigured(env: NodeJS.ProcessEnv): boolean`
  - `billingVisible(env: NodeJS.ProcessEnv, u: { role: string; blocked: boolean }): boolean`
  - `paddleApiBase(env: NodeJS.ProcessEnv): string`
  - `verifySignature(header: string | undefined, rawBody: Buffer | string, secret: string, nowMs: number): boolean`
  - `interface SubFields { plan: 'free'|'pro'; trialStartedAt?: number|string|null; paddleEventAt?: number|string|null }`
  - `interface PaddleSubEvent { event_type: string; occurred_at: string; data: { id: string; status: string; customer_id: string; custom_data?: Record<string, unknown> | null; next_billed_at?: string | null; scheduled_change?: { action: string; effective_at: string } | null } }`
  - `interface SubPatch { plan: 'free'|'pro'; paddleSubscriptionId: string; paddleCustomerId: string; subscriptionStatus: string; subscriptionRenewsAt: number|null; subscriptionEndsAt: number|null; paddleEventAt: number; trialStartedAt?: number }`
  - `applySubscriptionEvent(u: SubFields, ev: PaddleSubEvent, now: number): SubPatch | null` — `null` = событие старее уже применённого
  - `LIVE_STATUSES: readonly string[]` = `['active', 'trialing', 'past_due', 'paused']`
  - `hasLiveSubscription(u: { subscriptionStatus?: string | null }): boolean`
  - `subscriptionView(u: { subscriptionStatus?: string|null; subscriptionRenewsAt?: number|string|null; subscriptionEndsAt?: number|string|null }): { status: string; renewsAt: number|null; endsAt: number|null } | null`

- [ ] **Step 1: Write the failing test**

`backend/src/billing/billing.spec.ts`:

```ts
import { createHmac } from 'crypto';
import {
  applySubscriptionEvent, billingConfigured, billingMode, billingVisible, hasLiveSubscription,
  paddleApiBase, subscriptionView, verifySignature, PaddleSubEvent,
} from './billing';

const KEYS = { PADDLE_API_KEY: 'k', PADDLE_CLIENT_TOKEN: 't', PADDLE_PRICE_ID: 'pri_1' };
const admin = { role: 'admin', blocked: false };
const user = { role: 'user', blocked: false };

describe('billingMode', () => {
  it('off по умолчанию, при пустом и неизвестном значении', () => {
    expect(billingMode(undefined)).toBe('off');
    expect(billingMode('')).toBe('off');
    expect(billingMode('Live ')).toBe('live');
    expect(billingMode('prod')).toBe('off');
    expect(billingMode('test')).toBe('test');
  });
});

describe('billingVisible', () => {
  it('off — никому', () => {
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'off' }, admin)).toBe(false);
  });
  it('test — только админу', () => {
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'test' }, admin)).toBe(true);
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'test' }, user)).toBe(false);
  });
  it('live — всем, кроме заблокированных', () => {
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'live' }, user)).toBe(true);
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'live' }, { role: 'user', blocked: true })).toBe(false);
  });
  it('без любого ключа — никому даже в live', () => {
    for (const k of Object.keys(KEYS)) {
      const env = { ...KEYS, BILLING_MODE: 'live', [k]: '' };
      expect(billingConfigured(env)).toBe(false);
      expect(billingVisible(env, admin)).toBe(false);
    }
  });
});

describe('paddleApiBase', () => {
  it('production только явно, иначе sandbox', () => {
    expect(paddleApiBase({ PADDLE_ENV: 'production' })).toBe('https://api.paddle.com');
    expect(paddleApiBase({ PADDLE_ENV: 'sandbox' })).toBe('https://sandbox-api.paddle.com');
    expect(paddleApiBase({})).toBe('https://sandbox-api.paddle.com');
  });
});

describe('verifySignature', () => {
  const secret = 'pdl_ntfset_secret';
  const body = '{"event_type":"subscription.created"}';
  const now = 1_790_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const h1 = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');

  it('верная подпись', () => {
    expect(verifySignature(`ts=${ts};h1=${h1}`, Buffer.from(body), secret, now)).toBe(true);
  });
  it('чужое тело или секрет', () => {
    expect(verifySignature(`ts=${ts};h1=${h1}`, body + ' ', secret, now)).toBe(false);
    expect(verifySignature(`ts=${ts};h1=${h1}`, body, 'other', now)).toBe(false);
  });
  it('старше 5 минут — отказ', () => {
    expect(verifySignature(`ts=${ts};h1=${h1}`, body, secret, now + 5 * 60_000 + 1000)).toBe(false);
  });
  it('битый/пустой заголовок и пустой секрет — отказ, без исключений', () => {
    expect(verifySignature(undefined, body, secret, now)).toBe(false);
    expect(verifySignature('garbage', body, secret, now)).toBe(false);
    expect(verifySignature(`ts=${ts};h1=abc`, body, secret, now)).toBe(false);
    expect(verifySignature(`ts=${ts};h1=${h1}`, body, '', now)).toBe(false);
  });
});

const ev = (status: string, occurred: string, extra: Partial<PaddleSubEvent['data']> = {}): PaddleSubEvent => ({
  event_type: 'subscription.updated',
  occurred_at: occurred,
  data: { id: 'sub_1', status, customer_id: 'ctm_1', custom_data: { userId: 'u1' },
          next_billed_at: '2026-11-01T10:00:00Z', scheduled_change: null, ...extra },
});

describe('applySubscriptionEvent', () => {
  const NOW = Date.parse('2026-10-01T12:00:00Z');
  it('active → pro, поля подписки, триал помечен использованным', () => {
    const p = applySubscriptionEvent({ plan: 'free', trialStartedAt: null, paddleEventAt: null },
      ev('active', '2026-10-01T10:00:00Z'), NOW)!;
    expect(p.plan).toBe('pro');
    expect(p.paddleSubscriptionId).toBe('sub_1');
    expect(p.paddleCustomerId).toBe('ctm_1');
    expect(p.subscriptionStatus).toBe('active');
    expect(p.subscriptionRenewsAt).toBe(Date.parse('2026-11-01T10:00:00Z'));
    expect(p.subscriptionEndsAt).toBeNull();
    expect(p.paddleEventAt).toBe(Date.parse('2026-10-01T10:00:00Z'));
    expect(p.trialStartedAt).toBe(NOW);
  });
  it('уже был триал — trialStartedAt не трогаем', () => {
    const p = applySubscriptionEvent({ plan: 'free', trialStartedAt: '123' }, ev('active', '2026-10-01T10:00:00Z'), NOW)!;
    expect(p.trialStartedAt).toBeUndefined();
  });
  it('past_due и trialing → pro; paused и canceled → free', () => {
    for (const [s, plan] of [['past_due', 'pro'], ['trialing', 'pro'], ['paused', 'free'], ['canceled', 'free']])
      expect(applySubscriptionEvent({ plan: 'pro' }, ev(s, '2026-10-01T10:00:00Z'), NOW)!.plan).toBe(plan);
  });
  it('запланированная отмена — endsAt из scheduled_change, renewsAt null', () => {
    const p = applySubscriptionEvent({ plan: 'pro' }, ev('active', '2026-10-01T10:00:00Z', {
      next_billed_at: null, scheduled_change: { action: 'cancel', effective_at: '2026-11-01T10:00:00Z' },
    }), NOW)!;
    expect(p.subscriptionRenewsAt).toBeNull();
    expect(p.subscriptionEndsAt).toBe(Date.parse('2026-11-01T10:00:00Z'));
  });
  it('событие не новее применённого — null (BIGINT строкой тоже)', () => {
    const at = String(Date.parse('2026-10-01T10:00:00Z'));
    expect(applySubscriptionEvent({ plan: 'free', paddleEventAt: at }, ev('active', '2026-10-01T10:00:00Z'), NOW)).toBeNull();
    expect(applySubscriptionEvent({ plan: 'free', paddleEventAt: at }, ev('active', '2026-10-01T09:00:00Z'), NOW)).toBeNull();
  });
  it('битый occurred_at — null', () => {
    expect(applySubscriptionEvent({ plan: 'free' }, ev('active', 'nope'), NOW)).toBeNull();
  });
});

describe('hasLiveSubscription / subscriptionView', () => {
  it('живые статусы', () => {
    expect(hasLiveSubscription({ subscriptionStatus: 'active' })).toBe(true);
    expect(hasLiveSubscription({ subscriptionStatus: 'paused' })).toBe(true);
    expect(hasLiveSubscription({ subscriptionStatus: 'canceled' })).toBe(false);
    expect(hasLiveSubscription({ subscriptionStatus: null })).toBe(false);
  });
  it('view: null без подписки, числа из строк', () => {
    expect(subscriptionView({ subscriptionStatus: null })).toBeNull();
    expect(subscriptionView({ subscriptionStatus: 'active', subscriptionRenewsAt: '5', subscriptionEndsAt: null }))
      .toEqual({ status: 'active', renewsAt: 5, endsAt: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/billing/billing.spec.ts`
Expected: FAIL — `Cannot find module './billing'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/billing/billing.ts`:

```ts
// Оплата Pro через Paddle (спека docs/superpowers/specs/2026-10-01-paddle-billing-design.md).
// Чистые функции без Nest/Sequelize — как users/plan.ts. BIGINT из pg приходит строкой → num().
import { createHmac, timingSafeEqual } from 'crypto';

export type BillingMode = 'off' | 'test' | 'live';
type Env = Record<string, string | undefined>;

const num = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

// Опечатка в env не должна открыть оплату: всё, кроме test/live, — off.
export function billingMode(raw: string | undefined): BillingMode {
  const m = (raw ?? '').trim().toLowerCase();
  return m === 'test' || m === 'live' ? m : 'off';
}

export function billingConfigured(env: Env): boolean {
  return !!(env.PADDLE_API_KEY && env.PADDLE_CLIENT_TOKEN && env.PADDLE_PRICE_ID);
}

// test — только админы (проверка на проде с sandbox-ключами), live — все не заблокированные.
export function billingVisible(env: Env, u: { role: string; blocked: boolean }): boolean {
  if (!billingConfigured(env) || u.blocked) return false;
  const mode = billingMode(env.BILLING_MODE);
  return mode === 'live' || (mode === 'test' && u.role === 'admin');
}

// Боевой API — только явно; по умолчанию sandbox, чтобы недонастроенный env не списывал деньги.
export function paddleApiBase(env: Env): string {
  return env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
}

const SIGNATURE_WINDOW_MS = 5 * 60_000;

// Paddle-Signature: "ts=<unix sec>;h1=<hex>", h1 = HMAC-SHA256(secret, ts + ':' + rawBody).
export function verifySignature(header: string | undefined, rawBody: Buffer | string, secret: string, nowMs: number): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(';').map((kv) => kv.split('=') as [string, string]));
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!Number.isFinite(ts) || !h1 || !/^[0-9a-f]+$/i.test(h1)) return false;
  if (Math.abs(nowMs - ts * 1000) > SIGNATURE_WINDOW_MS) return false;
  const expected = createHmac('sha256', secret).update(`${parts.ts}:`).update(rawBody).digest();
  const got = Buffer.from(h1, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export interface SubFields {
  plan: 'free' | 'pro';
  trialStartedAt?: number | string | null;
  paddleEventAt?: number | string | null;
}

export interface PaddleSubEvent {
  event_type: string;
  occurred_at: string;
  data: {
    id: string;
    status: string;
    customer_id: string;
    custom_data?: Record<string, unknown> | null;
    next_billed_at?: string | null;
    scheduled_change?: { action: string; effective_at: string } | null;
  };
}

export interface SubPatch {
  plan: 'free' | 'pro';
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  subscriptionStatus: string;
  subscriptionRenewsAt: number | null;
  subscriptionEndsAt: number | null;
  paddleEventAt: number;
  trialStartedAt?: number;
}

const PRO_STATUSES = new Set(['active', 'trialing', 'past_due']);
// Подписка «существует» (нельзя покупать вторую, при удалении аккаунта — отменить).
export const LIVE_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'paused'];

// null — событие не новее уже применённого: Paddle не гарантирует порядок доставки.
export function applySubscriptionEvent(u: SubFields, ev: PaddleSubEvent, now: number): SubPatch | null {
  const at = ms(ev.occurred_at);
  if (at == null) return null;
  const last = num(u.paddleEventAt);
  if (last != null && at <= last) return null;
  const d = ev.data;
  const plan: 'free' | 'pro' = PRO_STATUSES.has(d.status) ? 'pro' : 'free';
  const cancelAt = d.scheduled_change?.action === 'cancel' ? ms(d.scheduled_change.effective_at) : null;
  const patch: SubPatch = {
    plan,
    paddleSubscriptionId: d.id,
    paddleCustomerId: d.customer_id,
    subscriptionStatus: d.status,
    subscriptionRenewsAt: ms(d.next_billed_at ?? null),
    subscriptionEndsAt: cancelAt,
    paddleEventAt: at,
  };
  // Оплата = триал использован (как AdminService.setPlan), иначе после отмены ensureTrial выдал бы 14 дней.
  if (plan === 'pro' && num(u.trialStartedAt) == null) patch.trialStartedAt = now;
  return patch;
}

export function hasLiveSubscription(u: { subscriptionStatus?: string | null }): boolean {
  return !!u.subscriptionStatus && LIVE_STATUSES.includes(u.subscriptionStatus);
}

export function subscriptionView(u: {
  subscriptionStatus?: string | null;
  subscriptionRenewsAt?: number | string | null;
  subscriptionEndsAt?: number | string | null;
}): { status: string; renewsAt: number | null; endsAt: number | null } | null {
  if (!u.subscriptionStatus) return null;
  return { status: u.subscriptionStatus, renewsAt: num(u.subscriptionRenewsAt), endsAt: num(u.subscriptionEndsAt) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/billing/billing.spec.ts`
Expected: PASS (все тесты).

- [ ] **Step 5: Commit**

```bash
git add backend/src/billing/billing.ts backend/src/billing/billing.spec.ts
git commit -m "feat(billing): чистые функции — режим BILLING_MODE, подпись Paddle, маппинг событий подписки"
```

---

### Task 2: Колонки подписки и сырое тело запроса

**Files:**
- Modify: `backend/src/users/user.model.ts` (после поля `trialNotice`)
- Modify: `backend/src/main.ts:21` (json) и после строки `trial_notice` (~63)
- Modify: `backend/.env.example` (в конец)

**Interfaces:**
- Consumes: —
- Produces: поля `User`: `paddleCustomerId: string|null`, `paddleSubscriptionId: string|null`, `subscriptionStatus: string|null`, `subscriptionRenewsAt: number|null`, `subscriptionEndsAt: number|null`, `paddleEventAt: number|null`; `req.rawBody: Buffer` на всех JSON-запросах.

Тестов на этот шаг нет (декларации модели/SQL); проверяется сборкой и тестами Task 4/5, которые читают эти поля.

- [ ] **Step 1: Добавить поля модели**

В `backend/src/users/user.model.ts` перед закрывающей `}` класса:

```ts
  // Подписка Paddle (спека 2026-10-01-paddle-billing-design): пишет только вебхук. Статус — как у Paddle
  // (active/trialing/past_due/paused/canceled); метки — epoch ms, pg отдаёт BIGINT строкой.
  @Column({ type: DataType.TEXT, allowNull: true, field: 'paddle_customer_id' })
  paddleCustomerId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'paddle_subscription_id' })
  paddleSubscriptionId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'subscription_status' })
  subscriptionStatus: string | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'subscription_renews_at' })
  subscriptionRenewsAt: number | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'subscription_ends_at' })
  subscriptionEndsAt: number | null;

  // occurred_at последнего применённого события: старые/повторные вебхуки игнорируются.
  @Column({ type: DataType.BIGINT, allowNull: true, field: 'paddle_event_at' })
  paddleEventAt: number | null;
```

- [ ] **Step 2: ALTER TABLE и rawBody в main.ts**

Заменить `app.use(json({ limit: '2mb' }));` на:

```ts
  // rawBody — для проверки подписи вебхука Paddle (HMAC считается по байтам тела, не по JSON).
  app.use(json({ limit: '2mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
```

После строки с `trial_notice`:

```ts
  // Подписка Paddle (2026-10-01).
  for (const [col, type] of [
    ['paddle_customer_id', 'TEXT'], ['paddle_subscription_id', 'TEXT'], ['subscription_status', 'TEXT'],
    ['subscription_renews_at', 'BIGINT'], ['subscription_ends_at', 'BIGINT'], ['paddle_event_at', 'BIGINT'],
  ])
    await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS users_paddle_subscription_id ON users (paddle_subscription_id)',
  );
```

- [ ] **Step 3: .env.example**

В конец `backend/.env.example`:

```
# Оплата Pro через Paddle (спека 2026-10-01). BILLING_MODE: off (пусто) | test (видят только админы) | live.
# PADDLE_ENV: sandbox | production (всё, кроме production, — sandbox). Без API_KEY/CLIENT_TOKEN/PRICE_ID оплата скрыта.
BILLING_MODE=
PADDLE_ENV=sandbox
PADDLE_API_KEY=
PADDLE_CLIENT_TOKEN=
PADDLE_PRICE_ID=
PADDLE_WEBHOOK_SECRET=
```

- [ ] **Step 4: Сборка и тесты**

Run: `cd backend && npm run build && npx jest`
Expected: build без ошибок; все существующие тесты PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/users/user.model.ts backend/src/main.ts backend/.env.example
git commit -m "feat(billing): колонки подписки Paddle в users и сырое тело запроса для подписи вебхука"
```

---

### Task 3: PaddleClient

**Files:**
- Create: `backend/src/billing/paddle.client.ts`
- Test: `backend/src/billing/paddle.client.spec.ts`

**Interfaces:**
- Consumes: `paddleApiBase(env)` из Task 1.
- Produces: `class PaddleClient` (Injectable), методы:
  - `findCustomerByEmail(email: string): Promise<string | null>` — id `ctm_…`
  - `createCustomer(email: string): Promise<string>`
  - `createTransaction(input: { priceId: string; customerId: string; userId: string }): Promise<string>` — `checkout.url`
  - `createPortalSession(customerId: string, subscriptionId: string | null): Promise<string>` — URL
  - `cancelSubscription(subscriptionId: string): Promise<void>` — немедленно
  - Любой не-2xx → `throw new PaddleError(status, message)`; `class PaddleError extends Error { status: number }`.

- [ ] **Step 1: Write the failing test**

`backend/src/billing/paddle.client.spec.ts`:

```ts
import { PaddleClient, PaddleError } from './paddle.client';

const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) });
const fail = (status: number, detail: string) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve({ error: { detail } }) });

describe('PaddleClient', () => {
  let fetchMock: jest.Mock;
  let client: PaddleClient;
  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    process.env.PADDLE_ENV = 'sandbox';
    process.env.PADDLE_API_KEY = 'key_1';
    client = new PaddleClient();
  });

  it('findCustomerByEmail: GET /customers?email= с Bearer, sandbox-хост', async () => {
    fetchMock.mockReturnValue(ok([{ id: 'ctm_1' }]));
    expect(await client.findCustomerByEmail('a@b.co')).toBe('ctm_1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sandbox-api.paddle.com/customers?email=a%40b.co');
    expect(opts.headers.Authorization).toBe('Bearer key_1');
  });

  it('findCustomerByEmail: пусто — null', async () => {
    fetchMock.mockReturnValue(ok([]));
    expect(await client.findCustomerByEmail('a@b.co')).toBeNull();
  });

  it('createTransaction: items, customer_id, custom_data.userId → checkout.url', async () => {
    fetchMock.mockReturnValue(ok({ id: 'txn_1', checkout: { url: 'https://x/checkout.html?_ptxn=txn_1' } }));
    const url = await client.createTransaction({ priceId: 'pri_1', customerId: 'ctm_1', userId: 'u1' });
    expect(url).toBe('https://x/checkout.html?_ptxn=txn_1');
    const [u, opts] = fetchMock.mock.calls[0];
    expect(u).toBe('https://sandbox-api.paddle.com/transactions');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      items: [{ price_id: 'pri_1', quantity: 1 }], customer_id: 'ctm_1', custom_data: { userId: 'u1' },
    });
  });

  it('createPortalSession: ссылка overview', async () => {
    fetchMock.mockReturnValue(ok({ urls: { general: { overview: 'https://portal/x' } } }));
    expect(await client.createPortalSession('ctm_1', 'sub_1')).toBe('https://portal/x');
    const [u, opts] = fetchMock.mock.calls[0];
    expect(u).toBe('https://sandbox-api.paddle.com/customers/ctm_1/portal-sessions');
    expect(JSON.parse(opts.body)).toEqual({ subscription_ids: ['sub_1'] });
  });

  it('cancelSubscription: effective_from immediately', async () => {
    fetchMock.mockReturnValue(ok({ id: 'sub_1', status: 'canceled' }));
    await client.cancelSubscription('sub_1');
    const [u, opts] = fetchMock.mock.calls[0];
    expect(u).toBe('https://sandbox-api.paddle.com/subscriptions/sub_1/cancel');
    expect(JSON.parse(opts.body)).toEqual({ effective_from: 'immediately' });
  });

  it('не-2xx → PaddleError со статусом и detail', async () => {
    fetchMock.mockReturnValue(fail(400, 'bad price'));
    await expect(client.createCustomer('a@b.co')).rejects.toMatchObject({ status: 400, message: 'bad price' });
    fetchMock.mockReturnValue(fail(500, 'boom'));
    await expect(client.cancelSubscription('sub_1')).rejects.toBeInstanceOf(PaddleError);
  });

  it('сеть упала → PaddleError 502', async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error('ECONNRESET')));
    await expect(client.findCustomerByEmail('a@b.co')).rejects.toMatchObject({ status: 502 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/billing/paddle.client.spec.ts`
Expected: FAIL — `Cannot find module './paddle.client'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/billing/paddle.client.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { paddleApiBase } from './billing';

export class PaddleError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// Три-пять вызовов Paddle Billing API — fetch без SDK (как EIA/OSRM). Env читаем на каждый вызов:
// ключи меняются деплоем, а тесты подставляют process.env.
@Injectable()
export class PaddleClient {
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: { ok: boolean; status: number; json: () => Promise<any> };
    try {
      res = await fetch(`${paddleApiBase(process.env)}${path}`, {
        method,
        headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new PaddleError(502, `paddle unreachable: ${(e as Error).message}`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new PaddleError(res.status, json?.error?.detail || `paddle error ${res.status}`);
    return json.data as T;
  }

  async findCustomerByEmail(email: string): Promise<string | null> {
    const list = await this.call<Array<{ id: string }>>('GET', `/customers?email=${encodeURIComponent(email)}`);
    return list[0]?.id ?? null;
  }

  async createCustomer(email: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/customers', { email })).id;
  }

  // custom_data ставит сервер — получателя Pro из браузера подменить нельзя.
  async createTransaction(input: { priceId: string; customerId: string; userId: string }): Promise<string> {
    const txn = await this.call<{ checkout: { url: string } }>('POST', '/transactions', {
      items: [{ price_id: input.priceId, quantity: 1 }],
      customer_id: input.customerId,
      custom_data: { userId: input.userId },
    });
    return txn.checkout.url;
  }

  async createPortalSession(customerId: string, subscriptionId: string | null): Promise<string> {
    const s = await this.call<{ urls: { general: { overview: string } } }>(
      'POST', `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      { subscription_ids: subscriptionId ? [subscriptionId] : [] },
    );
    return s.urls.general.overview;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: 'immediately' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/billing/paddle.client.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/billing/paddle.client.ts backend/src/billing/paddle.client.spec.ts
git commit -m "feat(billing): клиент Paddle API — покупатель, транзакция, портал, отмена подписки"
```

---

### Task 4: BillingService, контроллер, модуль

**Files:**
- Create: `backend/src/billing/billing.service.ts`, `backend/src/billing/billing.controller.ts`, `backend/src/billing/billing.module.ts`
- Modify: `backend/src/app.module.ts` (импорт + `BillingModule` в `imports`)
- Test: `backend/src/billing/billing.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`billingMode`, `billingConfigured`, `billingVisible`, `verifySignature`, `applySubscriptionEvent`, `hasLiveSubscription`, `PaddleSubEvent`), Task 2 (поля `User`), Task 3 (`PaddleClient`, `PaddleError`).
- Produces:
  - `BillingService.clientConfig(): { env: 'sandbox' | 'production'; clientToken: string }` (503, если off/не настроено)
  - `BillingService.createCheckout(userId: string): Promise<{ url: string }>`
  - `BillingService.createPortal(userId: string): Promise<{ url: string }>`
  - `BillingService.handleWebhook(signature: string | undefined, rawBody: Buffer | undefined, body: any): Promise<{ ok: true }>`
  - `BillingService.cancelForUser(user: User): Promise<void>` — для Task 5
  - Маршруты: `GET /billing/client-config`, `POST /billing/checkout` (Jwt), `POST /billing/portal` (Jwt), `POST /billing/paddle/webhook`
  - `BillingModule` экспортирует `BillingService`.

- [ ] **Step 1: Write the failing test**

`backend/src/billing/billing.service.spec.ts`:

```ts
import { createHmac } from 'crypto';
import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException, BadGatewayException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PaddleError } from './paddle.client';

const SECRET = 'whsec';
const sign = (body: string, now = Date.now()) => {
  const ts = String(Math.floor(now / 1000));
  return `ts=${ts};h1=${createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')}`;
};
const mkUser = (over: any = {}) => ({
  id: 'u1', email: 'a@b.co', role: 'admin', blocked: false, plan: 'free', trialStartedAt: '1',
  paddleCustomerId: null, paddleSubscriptionId: null, subscriptionStatus: null, paddleEventAt: null,
  update: jest.fn(function (this: any, patch: any) { Object.assign(this, patch); return Promise.resolve(this); }),
  ...over,
});

describe('BillingService', () => {
  let users: Record<string, any>;
  let userModel: any;
  let paddle: any;
  let service: BillingService;

  beforeEach(() => {
    Object.assign(process.env, {
      BILLING_MODE: 'test', PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'k', PADDLE_CLIENT_TOKEN: 'test_tok',
      PADDLE_PRICE_ID: 'pri_1', PADDLE_WEBHOOK_SECRET: SECRET,
    });
    users = { u1: mkUser() };
    userModel = {
      findByPk: jest.fn((id) => Promise.resolve(users[id] ?? null)),
      findOne: jest.fn(({ where }) => Promise.resolve(Object.values(users).find((u: any) =>
        Object.entries(where).every(([k, v]) => u[k] === v)) ?? null)),
    };
    paddle = {
      findCustomerByEmail: jest.fn(() => Promise.resolve(null)),
      createCustomer: jest.fn(() => Promise.resolve('ctm_new')),
      createTransaction: jest.fn(() => Promise.resolve('https://loadlens.krait.studio/checkout.html?_ptxn=txn_1')),
      createPortalSession: jest.fn(() => Promise.resolve('https://portal/x')),
      cancelSubscription: jest.fn(() => Promise.resolve()),
    };
    service = new BillingService(userModel, paddle);
  });

  describe('clientConfig', () => {
    it('отдаёт env и client token', () => {
      expect(service.clientConfig()).toEqual({ env: 'sandbox', clientToken: 'test_tok' });
    });
    it('off → 503', () => {
      process.env.BILLING_MODE = 'off';
      expect(() => service.clientConfig()).toThrow(ServiceUnavailableException);
    });
  });

  describe('createCheckout', () => {
    it('создаёт покупателя и транзакцию с userId, запоминает customer id', async () => {
      const r = await service.createCheckout('u1');
      expect(r.url).toContain('_ptxn=txn_1');
      expect(paddle.createCustomer).toHaveBeenCalledWith('a@b.co');
      expect(paddle.createTransaction).toHaveBeenCalledWith({ priceId: 'pri_1', customerId: 'ctm_new', userId: 'u1' });
      expect(users.u1.paddleCustomerId).toBe('ctm_new');
    });
    it('находит существующего покупателя по email', async () => {
      paddle.findCustomerByEmail.mockReturnValue(Promise.resolve('ctm_old'));
      await service.createCheckout('u1');
      expect(paddle.createCustomer).not.toHaveBeenCalled();
      expect(paddle.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'ctm_old' }));
    });
    it('сохранённый customer id — без поиска', async () => {
      users.u1.paddleCustomerId = 'ctm_saved';
      await service.createCheckout('u1');
      expect(paddle.findCustomerByEmail).not.toHaveBeenCalled();
    });
    it('test-режим, не админ → 403', async () => {
      users.u1.role = 'user';
      await expect(service.createCheckout('u1')).rejects.toThrow(ForbiddenException);
      expect(paddle.createTransaction).not.toHaveBeenCalled();
    });
    it('уже подписан → 409', async () => {
      users.u1.subscriptionStatus = 'active';
      await expect(service.createCheckout('u1')).rejects.toThrow(ConflictException);
    });
    it('Paddle упал → 502', async () => {
      paddle.createTransaction.mockReturnValue(Promise.reject(new PaddleError(500, 'boom')));
      await expect(service.createCheckout('u1')).rejects.toThrow(BadGatewayException);
    });
  });

  describe('createPortal', () => {
    it('ссылка портала по customer/subscription', async () => {
      Object.assign(users.u1, { paddleCustomerId: 'ctm_1', paddleSubscriptionId: 'sub_1', subscriptionStatus: 'active' });
      expect(await service.createPortal('u1')).toEqual({ url: 'https://portal/x' });
      expect(paddle.createPortalSession).toHaveBeenCalledWith('ctm_1', 'sub_1');
    });
    it('без покупателя → 409', async () => {
      await expect(service.createPortal('u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('handleWebhook', () => {
    const event = (over: any = {}) => ({
      event_type: 'subscription.created', occurred_at: '2026-10-01T10:00:00Z',
      data: { id: 'sub_1', status: 'active', customer_id: 'ctm_1', custom_data: { userId: 'u1' },
              next_billed_at: '2026-11-01T10:00:00Z', scheduled_change: null },
      ...over,
    });
    const send = (body: any, sig?: string) => {
      const raw = JSON.stringify(body);
      return service.handleWebhook(sig ?? sign(raw), Buffer.from(raw), body);
    };

    it('active по custom_data.userId → pro', async () => {
      await send(event());
      expect(users.u1.plan).toBe('pro');
      expect(users.u1.paddleSubscriptionId).toBe('sub_1');
    });
    it('неверная подпись → 401, без изменений', async () => {
      await expect(send(event(), 'ts=1;h1=00')).rejects.toThrow(UnauthorizedException);
      expect(users.u1.update).not.toHaveBeenCalled();
    });
    it('off → 503 (Paddle повторит)', async () => {
      process.env.BILLING_MODE = 'off';
      await expect(send(event())).rejects.toThrow(ServiceUnavailableException);
    });
    it('чужие события — 200 без изменений', async () => {
      await send(event({ event_type: 'transaction.completed' }));
      expect(users.u1.update).not.toHaveBeenCalled();
    });
    it('без custom_data — находит по subscription id, затем по customer id', async () => {
      users.u1.paddleSubscriptionId = 'sub_1';
      await send(event({ data: { ...event().data, custom_data: null, status: 'canceled' }, occurred_at: '2026-10-02T10:00:00Z' }));
      expect(users.u1.plan).toBe('free');
      users.u1.paddleSubscriptionId = null;
      users.u1.paddleCustomerId = 'ctm_1';
      await send(event({ data: { ...event().data, custom_data: null }, occurred_at: '2026-10-03T10:00:00Z' }));
      expect(users.u1.plan).toBe('pro');
    });
    it('пользователь не найден — 200, без исключения', async () => {
      await expect(send(event({ data: { ...event().data, custom_data: { userId: 'ghost' }, customer_id: 'ctm_x', id: 'sub_x' } })))
        .resolves.toEqual({ ok: true });
    });
    it('canceled, затем запоздалый updated(active) — остаётся free', async () => {
      await send(event({ data: { ...event().data, status: 'canceled' }, occurred_at: '2026-10-05T10:00:00Z' }));
      await send(event({ event_type: 'subscription.updated', occurred_at: '2026-10-04T10:00:00Z' }));
      expect(users.u1.plan).toBe('free');
      expect(users.u1.subscriptionStatus).toBe('canceled');
    });
  });

  describe('cancelForUser', () => {
    it('живая подписка — отменяет немедленно', async () => {
      await service.cancelForUser(mkUser({ paddleSubscriptionId: 'sub_1', subscriptionStatus: 'past_due' }) as any);
      expect(paddle.cancelSubscription).toHaveBeenCalledWith('sub_1');
    });
    it('нет подписки или уже canceled — ничего', async () => {
      await service.cancelForUser(mkUser() as any);
      await service.cancelForUser(mkUser({ paddleSubscriptionId: 'sub_1', subscriptionStatus: 'canceled' }) as any);
      expect(paddle.cancelSubscription).not.toHaveBeenCalled();
    });
    it('Paddle упал → 502', async () => {
      paddle.cancelSubscription.mockReturnValue(Promise.reject(new PaddleError(500, 'boom')));
      await expect(service.cancelForUser(mkUser({ paddleSubscriptionId: 'sub_1', subscriptionStatus: 'active' }) as any))
        .rejects.toThrow(BadGatewayException);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/billing/billing.service.spec.ts`
Expected: FAIL — `Cannot find module './billing.service'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/billing/billing.service.ts`:

```ts
import {
  BadGatewayException, ConflictException, ForbiddenException, Injectable, Logger,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { PaddleClient, PaddleError } from './paddle.client';
import {
  applySubscriptionEvent, billingConfigured, billingMode, billingVisible, hasLiveSubscription,
  PaddleSubEvent, verifySignature,
} from './billing';

const SUB_EVENTS = new Set([
  'subscription.created', 'subscription.updated', 'subscription.activated', 'subscription.canceled',
  'subscription.past_due', 'subscription.paused', 'subscription.resumed',
]);

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly paddle: PaddleClient,
  ) {}

  private assertOn() {
    if (billingMode(process.env.BILLING_MODE) === 'off' || !billingConfigured(process.env))
      throw new ServiceUnavailableException('billing is not available');
  }

  private async visibleUser(userId: string): Promise<User> {
    this.assertOn();
    const user = await this.userModel.findByPk(userId);
    if (!user || !billingVisible(process.env, user)) throw new ForbiddenException('billing is not available for this account');
    return user;
  }

  private gateway<T>(p: Promise<T>): Promise<T> {
    return p.catch((e) => {
      if (e instanceof PaddleError) {
        this.logger.warn(`paddle ${e.status}: ${e.message}`);
        throw new BadGatewayException('payment service is unavailable');
      }
      throw e;
    });
  }

  // Client-side token Paddle публичен по природе (им инициализируется Paddle.js в браузере).
  clientConfig(): { env: 'sandbox' | 'production'; clientToken: string } {
    this.assertOn();
    return {
      env: process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox',
      clientToken: process.env.PADDLE_CLIENT_TOKEN as string,
    };
  }

  async createCheckout(userId: string): Promise<{ url: string }> {
    const user = await this.visibleUser(userId);
    if (hasLiveSubscription(user)) throw new ConflictException('already subscribed');
    let customerId = user.paddleCustomerId;
    if (!customerId) {
      customerId = (await this.gateway(this.paddle.findCustomerByEmail(user.email)))
        ?? (await this.gateway(this.paddle.createCustomer(user.email)));
      await user.update({ paddleCustomerId: customerId });
    }
    const url = await this.gateway(this.paddle.createTransaction({
      priceId: process.env.PADDLE_PRICE_ID as string, customerId, userId: user.id,
    }));
    return { url };
  }

  async createPortal(userId: string): Promise<{ url: string }> {
    const user = await this.visibleUser(userId);
    if (!user.paddleCustomerId) throw new ConflictException('no subscription yet');
    const url = await this.gateway(this.paddle.createPortalSession(user.paddleCustomerId, user.paddleSubscriptionId));
    return { url };
  }

  // Вебхук работает и в test, и в live; в off — 503, Paddle повторит доставку позже.
  async handleWebhook(signature: string | undefined, rawBody: Buffer | undefined, body: any): Promise<{ ok: true }> {
    this.assertOn();
    if (!rawBody || !verifySignature(signature, rawBody, process.env.PADDLE_WEBHOOK_SECRET ?? '', Date.now()))
      throw new UnauthorizedException('bad signature');
    if (!SUB_EVENTS.has(body?.event_type)) return { ok: true };
    const ev = body as PaddleSubEvent;
    const user = await this.findUser(ev);
    if (!user) {
      // Удалённый аккаунт или подписка из дашборда без custom_data — повтор не поможет.
      this.logger.warn(`paddle ${ev.event_type} ${ev.data?.id}: user not found`);
      return { ok: true };
    }
    const patch = applySubscriptionEvent(user, ev, Date.now());
    if (patch) await user.update(patch);
    return { ok: true };
  }

  private async findUser(ev: PaddleSubEvent): Promise<User | null> {
    const userId = ev.data?.custom_data?.userId;
    if (typeof userId === 'string') {
      const u = await this.userModel.findByPk(userId);
      if (u) return u;
    }
    if (ev.data?.id) {
      const u = await this.userModel.findOne({ where: { paddleSubscriptionId: ev.data.id } });
      if (u) return u;
    }
    if (ev.data?.customer_id) return this.userModel.findOne({ where: { paddleCustomerId: ev.data.customer_id } });
    return null;
  }

  // Перед удалением аккаунта: иначе удалённый пользователь продолжал бы платить.
  async cancelForUser(user: User): Promise<void> {
    if (!user.paddleSubscriptionId || !hasLiveSubscription(user)) return;
    await this.gateway(this.paddle.cancelSubscription(user.paddleSubscriptionId));
  }
}
```

`backend/src/billing/billing.controller.ts`:

```ts
import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  // Для checkout.html (без JWT): окружение и client-side token Paddle.js.
  @Get('client-config')
  clientConfig() { return this.service.clientConfig(); }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Req() req: { user: { userId: string } }) { return this.service.createCheckout(req.user.userId); }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  portal(@Req() req: { user: { userId: string } }) { return this.service.createPortal(req.user.userId); }

  @Post('paddle/webhook')
  @HttpCode(200)
  webhook(@Headers('paddle-signature') sig: string | undefined, @Req() req: { rawBody?: Buffer }, @Body() body: unknown) {
    return this.service.handleWebhook(sig, req.rawBody, body);
  }
}
```

`backend/src/billing/billing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaddleClient } from './paddle.client';

// Не импортирует UsersModule: UsersModule сам импортирует этот модуль (отмена подписки при удалении).
@Module({
  imports: [
    SequelizeModule.forFeature([User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [BillingController],
  providers: [BillingService, PaddleClient, JwtAuthGuard],
  exports: [BillingService],
})
export class BillingModule {}
```

В `backend/src/app.module.ts`: `import { BillingModule } from './billing/billing.module';` и `BillingModule,` последним в `imports`.

- [ ] **Step 4: Run tests and build**

Run: `cd backend && npx jest src/billing && npm run build`
Expected: PASS; build без ошибок.

- [ ] **Step 5: Commit**

```bash
git add backend/src/billing backend/src/app.module.ts
git commit -m "feat(billing): checkout, портал и вебхук Paddle — подписка включает и выключает Pro"
```

---

### Task 5: `/auth/me` отдаёт billing, удаление аккаунта отменяет подписку

**Files:**
- Modify: `backend/src/auth/auth.service.ts:35-37` (`publicUser`)
- Modify: `backend/src/users/users.service.ts` (`deleteMe`), `backend/src/users/users.module.ts`
- Test: `backend/src/auth/auth.service.spec.ts`, `backend/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `billingVisible`, `subscriptionView` (Task 1); `BillingService.cancelForUser` (Task 4).
- Produces: ответы `register`/`login`/`refresh`/`me` содержат `billing: boolean` и `subscription: {status, renewsAt, endsAt} | null`.

- [ ] **Step 1: Write the failing tests**

В `backend/src/auth/auth.service.spec.ts` найти существующий тест `me` (по `service.me(`) и рядом добавить (переиспользовать фабрику пользователя/модели из этого файла; если `userModel.findByPk` уже мокается — подставить пользователя с нужными полями):

```ts
  describe('publicUser: billing', () => {
    const KEYS = { PADDLE_API_KEY: 'k', PADDLE_CLIENT_TOKEN: 't', PADDLE_PRICE_ID: 'p' };
    afterEach(() => { for (const k of ['BILLING_MODE', ...Object.keys(KEYS)]) delete process.env[k]; });

    it('off — billing false, subscription null', async () => {
      const me = await service.me(user.id);
      expect(me.billing).toBe(false);
      expect(me.subscription).toBeNull();
    });
    it('test — true только админу', async () => {
      Object.assign(process.env, KEYS, { BILLING_MODE: 'test' });
      user.role = 'user';
      expect((await service.me(user.id)).billing).toBe(false);
      user.role = 'admin';
      expect((await service.me(user.id)).billing).toBe(true);
    });
    it('подписка видна в ответе', async () => {
      Object.assign(user, { subscriptionStatus: 'active', subscriptionRenewsAt: '1790000000000', subscriptionEndsAt: null });
      expect((await service.me(user.id)).subscription).toEqual({ status: 'active', renewsAt: 1790000000000, endsAt: null });
    });
  });
```

(Имя переменной пользователя — как в файле; если там другое, использовать его. `me` возвращает `publicUser` — проверить в `auth.service.ts`.)

В `backend/src/users/users.service.spec.ts`: в `beforeEach` добавить `billing = { cancelForUser: jest.fn(() => Promise.resolve()) };` (объявить `let billing: any;`), `userModel.findByPk` уже есть; конструктор → `new UsersService(userModel, cloud, billing)`. Добавить:

```ts
  it('deleteMe: сначала отменяет подписку Paddle, потом удаляет', async () => {
    await service.deleteMe('u1');
    expect(billing.cancelForUser).toHaveBeenCalledWith(user);
    expect(userModel.destroy).toHaveBeenCalled();
  });

  it('deleteMe: отмена в Paddle упала — аккаунт не удаляется', async () => {
    billing.cancelForUser.mockReturnValue(Promise.reject(new BadGatewayException('payment service is unavailable')));
    await expect(service.deleteMe('u1')).rejects.toThrow(BadGatewayException);
    expect(userModel.destroy).not.toHaveBeenCalled();
    expect(cloud.purgeForUser).not.toHaveBeenCalled();
  });
```

(импорт `BadGatewayException` из `@nestjs/common`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/auth/auth.service.spec.ts src/users/users.service.spec.ts`
Expected: FAIL — `billing` undefined / `cancelForUser` не вызван.

- [ ] **Step 3: Implement**

`auth.service.ts`: импорт `import { billingVisible, subscriptionView } from '../billing/billing';`, `publicUser`:

```ts
  private publicUser(u: User) {
    return {
      email: u.email, plan: effectivePlan(u, Date.now()), trialEndsAt: trialEndsAt(u), cloudEnabled: !!u.cloudEnabled,
      // Кнопка оплаты в расширении — только при billing:true (BILLING_MODE, спека 2026-10-01).
      billing: billingVisible(process.env, u), subscription: subscriptionView(u),
    };
  }
```

`users.service.ts`:

```ts
import { BillingService } from '../billing/billing.service';
// ...
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly cloud: CloudService,
    private readonly billing: BillingService,
  ) {}
// ...
  // Подписку Paddle отменяем первой: если Paddle недоступен — 502 и аккаунт цел, иначе удалённый
  // пользователь продолжал бы платить (спека 2026-10-01 §4).
  async deleteMe(userId: string) {
    const user = await this.userModel.findByPk(userId);
    if (user) await this.billing.cancelForUser(user);
    await this.cloud.purgeForUser(userId);
    await this.userModel.destroy({ where: { id: userId } });
    return { ok: true };
  }
```

`users.module.ts`: `import { BillingModule } from '../billing/billing.module';` и добавить `BillingModule` в `imports` (комментарий: «Удаление аккаунта отменяет подписку Paddle»).

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest && npm run build`
Expected: все PASS, build OK. (Если `AuthModule`/другие спеки создают `UsersService` вручную — дописать третий аргумент-мок.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts backend/src/users
git commit -m "feat(billing): /auth/me отдаёт billing и подписку; удаление аккаунта отменяет подписку Paddle"
```

---

### Task 6: Админка — статус подписки

**Files:**
- Modify: `backend/src/auth/admin.service.ts` (`view`, `stats`)
- Modify: `backend/public/admin.html` (сводка + колонка плана)
- Test: `backend/src/auth/admin.service.spec.ts`

**Interfaces:**
- Consumes: поля `User` (Task 2).
- Produces: `AdminUserView.subscriptionStatus: string | null`; `stats().subscribers: number`.

- [ ] **Step 1: Write the failing test**

В `admin.service.spec.ts` рядом с тестами `stats`/`listUsers` (использовать существующие моки; в мок `userModel.count` добавить ветку):

```ts
  it('stats: число подписчиков — живые статусы Paddle', async () => {
    const s = await service.stats();
    expect(s).toHaveProperty('subscribers');
    expect(userModel.count).toHaveBeenCalledWith({ where: { subscriptionStatus: ['active', 'trialing', 'past_due', 'paused'] } });
  });

  it('listUsers: статус подписки в строке', async () => {
    // пользователь из существующего мока findAll с subscriptionStatus: 'active'
    const [row] = await service.listUsers();
    expect(row).toHaveProperty('subscriptionStatus');
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && npx jest src/auth/admin.service.spec.ts`
Expected: FAIL — нет `subscribers`/`subscriptionStatus`.

- [ ] **Step 3: Implement**

`admin.service.ts`: импорт `import { LIVE_STATUSES } from '../billing/billing';`; в `view` после `cloudEnabled`: `subscriptionStatus: u.subscriptionStatus ?? null,` (и поле в интерфейсе `AdminUserView`); в `stats` добавить в `Promise.all` седьмым `this.userModel.count({ where: { subscriptionStatus: [...LIVE_STATUSES] } })`, деструктуризация `subscribers`, вернуть `subscribers`.

`admin.html`: в массив сводки после `['На триале', …]` добавить `['Подписчиков', s.subscribers ?? '—'],`; в ячейке плана перед итоговым выражением добавить префикс подписки:

```js
          <td>${u.subscriptionStatus ? '<span class="badge pro">paddle: ' + esc(u.subscriptionStatus) + '</span> ' : ''}${u.plan === 'pro' ? '<span class="badge pro">pro</span>'
```

(остаток выражения — без изменений).

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest src/auth/admin.service.spec.ts && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/admin.service.ts backend/src/auth/admin.service.spec.ts backend/public/admin.html
git commit -m "feat(admin): статус подписки Paddle у пользователя и число подписчиков"
```

---

### Task 7: Страница checkout.html

**Files:**
- Create: `backend/public/checkout.html`
- Test: `scripts/landing-i18n.test.js` (добавить тест в конец)

**Interfaces:**
- Consumes: `GET /api/v1/billing/client-config` (Task 4).
- Produces: страница по default payment link Paddle: `https://loadlens.krait.studio/checkout.html?_ptxn=txn_…`.

- [ ] **Step 1: Write the failing test**

В конец `scripts/landing-i18n.test.js`:

```js
test("checkout.html: noindex, вне sitemap, без Метрики, Paddle.js с CDN Paddle", () => {
  const page = fs.readFileSync(path.join(PUB, "checkout.html"), "utf8");
  assert.match(page, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(page, /<script src="https:\/\/cdn\.paddle\.com\/paddle\/v2\/paddle\.js"><\/script>/);
  assert.match(page, /\/api\/v1\/billing\/client-config/);
  assert.doesNotMatch(page, /site\.js|mc\.yandex|ym\(/);
  const sitemap = fs.readFileSync(path.join(PUB, "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /checkout/);
  assert.doesNotMatch(html, /checkout\.html/);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test scripts/landing-i18n.test.js`
Expected: FAIL — ENOENT checkout.html.

- [ ] **Step 3: Implement**

`backend/public/checkout.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>LoadLens — Checkout</title>
  <style>
    :root { --blue:#1d4ed8; --ink:#0f1720; --mut:#64748b; --line:#e2e8f0; }
    * { box-sizing: border-box; }
    body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
           max-width: 560px; margin: 0 auto; padding: 64px 16px; background: #fff; text-align: center; }
    h1 { font-size: 26px; margin: 0 0 8px; } h1 b { color: var(--blue); }
    p { color: var(--mut); } a { color: var(--blue); text-decoration: none; }
  </style>
</head>
<body>
  <h1>Load<b>Lens</b> Pro</h1>
  <p id="msg">Opening secure checkout…</p>
  <!-- Страница = default payment link Paddle: Paddle.js сам открывает оплату по ?_ptxn=. Без Метрики.
       Без SRI осознанно: Paddle обновляет v2/paddle.js по тому же URL и хешей не публикует — integrity сломал бы оплату. -->
  <script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
  <script>
    (function () {
      var msg = document.getElementById("msg");
      var say = function (html) { msg.innerHTML = html; };
      if (!/[?&]_ptxn=txn_/.test(location.search)) {
        say('Start checkout from the LoadLens extension: Settings → Upgrade to Pro. <a href="/">LoadLens home</a>');
        return;
      }
      fetch("/api/v1/billing/client-config").then(function (r) {
        if (!r.ok) throw new Error("unavailable");
        return r.json();
      }).then(function (cfg) {
        if (cfg.env !== "production") Paddle.Environment.set("sandbox");
        Paddle.Initialize({
          token: cfg.clientToken,
          eventCallback: function (e) {
            if (e.name === "checkout.completed")
              say("Payment received — Pro is on. You can close this tab and reopen the LoadLens panel.");
            if (e.name === "checkout.closed" && !/Pro is on/.test(msg.textContent))
              say('Checkout closed. You can start it again from the LoadLens extension, or email <a href="mailto:hello@krait.studio">hello@krait.studio</a>.');
          },
        });
      }).catch(function () {
        say('Checkout is unavailable right now. Please try again later or email <a href="mailto:hello@krait.studio">hello@krait.studio</a>.');
      });
    })();
  </script>
</body>
</html>
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: все `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/public/checkout.html scripts/landing-i18n.test.js
git commit -m "feat(billing): страница оплаты checkout.html с Paddle.js — noindex, без Метрики"
```

---

### Task 8: Расширение — Upgrade и Manage subscription

**Files:**
- Modify: `extension/plan-view.js`, `extension/plan-view.test.js`
- Modify: `extension/api.js` (`credsCall`, `getMe`, `meFrom`, новые `billingCheckout`/`billingPortal`, экспорт)
- Modify: `extension/popup.js` (`planNote`, `accRow`, `acctKey`)
- Modify: `extension/manifest.json` (`version` → `0.9.4`), `CHANGELOG.md`

**Interfaces:**
- Consumes: `/auth/me` → `billing`, `subscription` (Task 5); `POST /billing/checkout|portal` → `{ url }` (Task 4).
- Produces: `LLPLANVIEW.view(user, now)` → добавляет `action: 'upgrade' | 'manage' | 'contact'` и `subLine: string | null`; `LLAPI.billingCheckout(): Promise<{url}>`, `LLAPI.billingPortal(): Promise<{url}>`.

- [ ] **Step 1: Write the failing test**

В `extension/plan-view.test.js`: существующие `deepStrictEqual` расширить полями `action: "contact", subLine: null` (поведение без billing не меняется), и добавить:

```js
test("billing выключен — всегда contact (старое поведение)", () => {
  for (const u of [{ plan: "free" }, { plan: "pro", trialEndsAt: NOW + DAY }, { plan: "free", trialEndsAt: NOW - DAY }])
    assert.strictEqual(LLPLANVIEW.view(u, NOW).action, "contact");
});

test("billing включён: Free/триал/конец триала — upgrade", () => {
  for (const u of [{ plan: "free" }, { plan: "pro", trialEndsAt: NOW + DAY }, { plan: "free", trialEndsAt: NOW - DAY }])
    assert.strictEqual(LLPLANVIEW.view({ ...u, billing: true }, NOW).action, "upgrade");
});

test("подписчик — manage и строка продления/окончания", () => {
  const renews = Date.UTC(2026, 10, 1);
  const v = LLPLANVIEW.view({ plan: "pro", billing: true, subscription: { status: "active", renewsAt: renews, endsAt: null } }, NOW);
  assert.strictEqual(v.action, "manage");
  assert.match(v.subLine, /^Renews on /);
  const e = LLPLANVIEW.view({ plan: "pro", billing: true, subscription: { status: "active", renewsAt: null, endsAt: renews } }, NOW);
  assert.match(e.subLine, /^Ends on /);
  const pd = LLPLANVIEW.view({ plan: "pro", billing: true, subscription: { status: "past_due", renewsAt: null, endsAt: null } }, NOW);
  assert.strictEqual(pd.subLine, "Payment failed — update your card");
});

test("постоянный Pro без подписки при billing — без кнопок", () => {
  assert.strictEqual(LLPLANVIEW.view({ plan: "pro", billing: true, subscription: null }, NOW).action, "contact");
});

test("подписка canceled — снова upgrade", () => {
  assert.strictEqual(LLPLANVIEW.view({ plan: "free", billing: true, subscription: { status: "canceled", renewsAt: null, endsAt: null } }, NOW).action, "upgrade");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test extension/plan-view.test.js`
Expected: FAIL — нет `action`.

- [ ] **Step 3: Implement**

`extension/plan-view.js` — заменить `view`:

```js
  const LIVE = ["active", "trialing", "past_due", "paused"];
  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // action: upgrade — кнопка оплаты; manage — портал Paddle; contact — прежние mailto-ссылки.
  // Оплату показываем только при user.billing (сервер решает по BILLING_MODE): до запуска её не видит никто.
  function billingAction(user, base) {
    const sub = user && user.subscription;
    const live = !!(sub && LIVE.includes(sub.status));
    if (!user || !user.billing) return { action: "contact", subLine: null };
    if (live) {
      const subLine = sub.status === "past_due" ? "Payment failed — update your card"
        : sub.endsAt ? "Ends on " + day(Number(sub.endsAt))
        : sub.renewsAt ? "Renews on " + day(Number(sub.renewsAt)) : null;
      return { action: "manage", subLine };
    }
    // Постоянный Pro, выданный руками, оплачивать нечего.
    if (base.pro && base.note === null) return { action: "contact", subLine: null };
    return { action: "upgrade", subLine: null };
  }

  function view(user, now) {
    const end = user && user.trialEndsAt != null ? Number(user.trialEndsAt) : null;
    let base;
    if (end != null && end > now && user.plan === "pro")
      base = { badge: "PRO TRIAL", pro: true, note: "trial", daysLeft: Math.ceil((end - now) / DAY) };
    else if (end != null && end <= now) base = { badge: "FREE", pro: false, note: "ended", daysLeft: null };
    else if (user && user.plan === "pro") base = { badge: "PRO", pro: true, note: null, daysLeft: null };
    else base = { badge: "FREE", pro: false, note: "upsell", daysLeft: null };
    return { ...base, ...billingAction(user, base) };
  }
```

Порядок проверки в тесте «подписчик — manage»: у пользователя `plan: "pro"` без `trialEndsAt` → base PRO/note null, но `live` проверяется раньше → manage. ✔

`extension/api.js`:
- в `credsCall` в объект `setAuth({...})` добавить `billing: !!data.user.billing, subscription: data.user.subscription ?? null,`
- в `getMe` в `next` добавить `billing: !!user.billing, subscription: user.subscription ?? null,`
- `meFrom`:

```js
  const meFrom = (a) => ({ email: a.email, plan: a.plan, trialEndsAt: a.trialEndsAt ?? null, cloudEnabled: !!a.cloudEnabled,
                           billing: !!a.billing, subscription: a.subscription ?? null });
```

- после `deleteAccount`:

```js
  // Оплата Pro (Paddle): сервер отдаёт URL оплаты/портала, вкладку открывает Settings.
  async function billingCall(path) {
    const res = await authedFetch(path, { method: "POST" });
    if (!res) throw new Error("sign in required");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 502 || res.status === 503
      ? "Payment service is unavailable, try later or email " + (globalThis.LLCONTACT ? LLCONTACT.EMAIL : "us")
      : data.message || `error ${res.status}`);
    return data; // { url }
  }
  const billingCheckout = () => billingCall("/billing/checkout");
  const billingPortal = () => billingCall("/billing/portal");
```

- в `return { … }` добавить `billingCheckout, billingPortal`.

`extension/popup.js`:
- `acctKey`: `[u.email, u.plan, !!u.cloudEnabled, u.trialEndsAt ?? "", !!u.billing, u.subscription ? u.subscription.status + ":" + (u.subscription.endsAt ?? u.subscription.renewsAt ?? "") : ""].join("|")`
- `planNote(pv, email)` — в начало функции:

```js
  if (pv.action === "manage")
    return '<div class="note">' + (pv.subLine ? escA(pv.subLine) + " · " : "") +
      '<a href="#" id="acc-manage">Manage subscription</a></div>';
  if (pv.action === "upgrade") {
    const lead = pv.note === "trial" ? "Pro trial: " + pv.daysLeft + (pv.daysLeft === 1 ? " day" : " days") + " left. "
      : pv.note === "ended" ? "Your Pro trial has ended. " : "";
    return '<div class="note get-pro">' + lead + '<button id="acc-upgrade" class="primary">Upgrade to Pro — $24/mo</button>' +
      '<div id="acc-bill-err" class="err"></div></div>';
  }
```

- в `accRow` после назначения `acc-out.onclick`:

```js
  const openBilling = (fn) => async (e) => {
    e.preventDefault();
    const err = document.getElementById("acc-bill-err");
    try { const r = await fn(); if (r.url) chrome.tabs.create({ url: r.url }); }
    catch (x) { if (err) err.textContent = x.message; else alert(x.message); }
  };
  const up = document.getElementById("acc-upgrade");
  if (up) up.onclick = openBilling(LLAPI.billingCheckout);
  const man = document.getElementById("acc-manage");
  if (man) man.onclick = openBilling(LLAPI.billingPortal);
```

(`alert` для manage-ветки допустим — это панель расширения, не страница DAT; если в Settings уже есть общий тост/ошибка — использовать его.)

`manifest.json`: `"version": "0.9.4"`. `CHANGELOG.md` под `## [Unreleased]`:

```
### Added
- **Upgrade to Pro from Settings** (rolling out gradually). Where available, the Settings tab shows an "Upgrade to Pro — $24/mo" button that opens a secure checkout, and subscribers get "Manage subscription" to update the card, see receipts or cancel. Deleting your account also cancels the subscription.
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"` и `npm run e2e:popup`
Expected: `fail 0` везде; e2e:popup проходит (поведение без billing не менялось).

- [ ] **Step 5: Commit**

```bash
git add extension/plan-view.js extension/plan-view.test.js extension/api.js extension/popup.js extension/manifest.json CHANGELOG.md
git commit -m "feat(extension): кнопки Upgrade to Pro и Manage subscription в Settings — только при billing с сервера (0.9.4)"
```

---

### Task 9: Документация, деплой с выключенным флагом, живой sandbox-прогон

**Files:**
- Modify: `CLAUDE.md` (структура `backend/src/` + конвенции + env)

**Interfaces:**
- Consumes: всё выше.
- Produces: прод с billing-кодом и `BILLING_MODE` не заданным (= off); затем — sandbox-проверка под админом.

- [ ] **Step 1: CLAUDE.md**

В блок структуры `backend/src/` после строки `cloud/`:

```
  billing/                  оплата Pro через Paddle (MoR): billing.ts (чистые: BILLING_MODE off|test|live, подпись, событие→план),
                            paddle.client (fetch), checkout/portal (Jwt) + paddle/webhook; checkout.html в public/ (Paddle.js, noindex)
```

В «Конвенции» новый пункт:

```
- **Оплата Pro — Paddle (с 2026-10-01).** Stripe в Молдове нет; Paddle — Merchant of Record. **Кнопку оплаты видит только
  тот, кому `billingVisible`**: `BILLING_MODE` off (дефолт, опечатка = off) | test (только админы, sandbox-ключи) | live.
  План меняет ТОЛЬКО вебхук (`active/trialing/past_due` → pro, `paused/canceled` → free; старые события по `paddle_event_at`
  игнорируются). `DELETE /users/me` сначала отменяет подписку (Paddle недоступен → 502, аккаунт цел). Спека —
  `docs/superpowers/specs/2026-10-01-paddle-billing-design.md`.
```

В абзац «Env в Coolify» добавить: `Оплата: BILLING_MODE, PADDLE_ENV, PADDLE_API_KEY, PADDLE_CLIENT_TOKEN, PADDLE_PRICE_ID, PADDLE_WEBHOOK_SECRET (без BILLING_MODE оплата скрыта).`

- [ ] **Step 2: Полная проверка**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)" && cd backend && npx jest && npm run build`
Expected: всё PASS.

- [ ] **Step 3: Commit; push — только после подтверждения пользователя**

```bash
git add CLAUDE.md
git commit -m "docs: оплата Pro через Paddle — BILLING_MODE, вебхук, env"
```

Перед `git push origin main` убедиться, что в Coolify `BILLING_MODE` не задан (`coolify --context yoolip999 app env list hiooby9kgzj8i79ycl33drec` → нет `BILLING_MODE` или `off`), и спросить пользователя. После деплоя: `curl -s -o /dev/null -w "%{http_code}" https://loadlens.krait.studio/api/v1/billing/client-config` → `503`.

- [ ] **Step 4: Sandbox-прогон (с пользователем)**

Пользователь в Paddle sandbox: продукт «LoadLens Pro», цена $24/month → `pri_…`; Developer tools → Notifications → URL `https://loadlens.krait.studio/api/v1/billing/paddle/webhook`, события `subscription.*` → секрет; Checkout settings → default payment link `https://loadlens.krait.studio/checkout.html`; client-side token. Значения — в Coolify env (пользователь сам или `app env sync` из локального файла, не через чат), `BILLING_MODE=test`, `PADDLE_ENV=sandbox`; деплой пушем/рестартом по скиллу `coolify-deploy`.

Проверки:
1. Обычный аккаунт: Settings без кнопки Upgrade; `POST /billing/checkout` → 403.
2. Админ: Upgrade → вкладка checkout → тестовая карта `4242 4242 4242 4242`, любой CVC/будущая дата → «Pro is on»; Settings (после повторного открытия) → PRO + «Renews on …»; админка → `paddle: active`, Подписчиков 1.
3. Manage subscription → портал Paddle → Cancel → в sandbox отмена в конце периода: `Ends on …`; немедленная проверка `canceled`: удалить тестовый аккаунт админа-дубля (`DELETE /users/me`) → в Paddle подписка canceled.
4. Логи: `coolify --context yoolip999 app logs hiooby9kgzj8i79ycl33drec | grep -i paddle` — нет 401/500 по вебхукам.

После прогона `BILLING_MODE` вернуть в `off` или оставить `test` (кнопку всё равно видят только админы) — решение пользователя.
