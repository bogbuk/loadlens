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

// live — только с боевым Paddle: иначе любой «оплатил» бы sandbox-картой 4242 и получил Pro.
export function billingConfigured(env: Env): boolean {
  if (!(env.PADDLE_API_KEY && env.PADDLE_CLIENT_TOKEN && env.PADDLE_PRICE_ID)) return false;
  return billingMode(env.BILLING_MODE) !== 'live' || env.PADDLE_ENV === 'production';
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
