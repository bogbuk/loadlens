import { createHmac } from 'crypto';
import {
  applySubscriptionEvent, billingConfigured, billingMode, billingVisible, hasLiveSubscription,
  paddleApiBase, priceIdFor, subscriptionView, verifySignature, PaddleSubEvent,
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
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'live', PADDLE_ENV: 'production' }, user)).toBe(true);
    expect(billingVisible({ ...KEYS, BILLING_MODE: 'live', PADDLE_ENV: 'production' }, { role: 'user', blocked: true })).toBe(false);
  });
  it('live только с PADDLE_ENV=production — иначе sandbox-карта 4242 раздавала бы Pro', () => {
    for (const env of [undefined, 'sandbox', 'prod'])
      expect(billingConfigured({ ...KEYS, BILLING_MODE: 'live', PADDLE_ENV: env })).toBe(false);
    expect(billingConfigured({ ...KEYS, BILLING_MODE: 'live', PADDLE_ENV: 'production' })).toBe(true);
    expect(billingConfigured({ ...KEYS, BILLING_MODE: 'test', PADDLE_ENV: 'sandbox' })).toBe(true);
  });
  it('без любого ключа — никому даже в live', () => {
    for (const k of Object.keys(KEYS)) {
      const env = { ...KEYS, BILLING_MODE: 'live', PADDLE_ENV: 'production', [k]: '' };
      expect(billingConfigured(env)).toBe(false);
      expect(billingVisible(env, admin)).toBe(false);
    }
  });
});

describe('priceIdFor', () => {
  it('month — PADDLE_PRICE_ID, по умолчанию тоже месяц', () => {
    expect(priceIdFor({ ...KEYS }, 'month')).toBe('pri_1');
    expect(priceIdFor({ ...KEYS }, undefined)).toBe('pri_1');
  });
  it('year — PADDLE_PRICE_ID_YEARLY; без него null', () => {
    expect(priceIdFor({ ...KEYS, PADDLE_PRICE_ID_YEARLY: 'pri_y' }, 'year')).toBe('pri_y');
    expect(priceIdFor({ ...KEYS }, 'year')).toBeNull();
    expect(priceIdFor({ ...KEYS, PADDLE_PRICE_ID_YEARLY: '  ' }, 'year')).toBeNull();
  });
  it('неизвестный период — null', () => {
    expect(priceIdFor({ ...KEYS, PADDLE_PRICE_ID_YEARLY: 'pri_y' }, 'week')).toBeNull();
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
