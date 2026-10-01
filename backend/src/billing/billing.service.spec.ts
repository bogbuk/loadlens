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
