import { createHmac } from 'crypto';
import { Op } from 'sequelize';
import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException, BadGatewayException, BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PaddleError } from './paddle.client';

const SECRET = 'whsec';
const U1 = '11111111-1111-4111-8111-111111111111';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sign = (body: string, now = Date.now()) => {
  const ts = String(Math.floor(now / 1000));
  return `ts=${ts};h1=${createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')}`;
};
const mkUser = (over: any = {}) => ({
  id: U1, email: 'a@b.co', role: 'admin', blocked: false, plan: 'free', trialStartedAt: '1',
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
      PADDLE_PRICE_ID: 'pri_1', PADDLE_PRICE_ID_YEARLY: 'pri_y', PADDLE_WEBHOOK_SECRET: SECRET,
    });
    users = { u1: mkUser() };
    userModel = {
      // Как Postgres: не-UUID в первичном ключе — ошибка запроса, а не «не найдено».
      findByPk: jest.fn((id) => UUID_RE.test(String(id))
        ? Promise.resolve(Object.values(users).find((u: any) => u.id === id) ?? null)
        : Promise.reject(new Error('invalid input syntax for type uuid'))),
      // Условный UPDATE: patch применяется, только если строка подходит под where (id + paddle_event_at).
      update: jest.fn((patch, { where }) => {
        const row: any = Object.values(users).find((u: any) => u.id === where.id);
        const at = where[Op.or]?.[1]?.paddleEventAt?.[Op.lt];
        const fresh = row && (row.paddleEventAt == null || (at !== undefined && Number(row.paddleEventAt) < at));
        if (fresh) Object.assign(row, patch);
        return Promise.resolve([fresh ? 1 : 0]);
      }),
      findOne: jest.fn(({ where }) => Promise.resolve(Object.values(users).find((u: any) =>
        Object.entries(where).every(([k, v]) => u[k] === v)) ?? null)),
    };
    paddle = {
      findCustomerByEmail: jest.fn(() => Promise.resolve(null)),
      createCustomer: jest.fn(() => Promise.resolve('ctm_new')),
      createTransaction: jest.fn(() => Promise.resolve('https://loadlens.krait.studio/checkout.html?_ptxn=txn_1')),
      createPortalSession: jest.fn(() => Promise.resolve('https://portal/x')),
      cancelSubscription: jest.fn(() => Promise.resolve()),
      listLiveSubscriptions: jest.fn(() => Promise.resolve([])),
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
      const r = await service.createCheckout(U1);
      expect(r.url).toContain('_ptxn=txn_1');
      expect(paddle.createCustomer).toHaveBeenCalledWith('a@b.co');
      expect(paddle.createTransaction).toHaveBeenCalledWith({ priceId: 'pri_1', customerId: 'ctm_new', userId: U1 });
      expect(users.u1.paddleCustomerId).toBe('ctm_new');
    });
    it('interval year — годовая цена', async () => {
      await service.createCheckout(U1, 'year');
      expect(paddle.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ priceId: 'pri_y' }));
    });
    it('year без PADDLE_PRICE_ID_YEARLY или неизвестный период → 400, транзакции нет', async () => {
      process.env.PADDLE_PRICE_ID_YEARLY = '';
      await expect(service.createCheckout(U1, 'year')).rejects.toThrow(BadRequestException);
      await expect(service.createCheckout(U1, 'week')).rejects.toThrow(BadRequestException);
      expect(paddle.createTransaction).not.toHaveBeenCalled();
    });
    it('находит существующего покупателя по email', async () => {
      paddle.findCustomerByEmail.mockReturnValue(Promise.resolve('ctm_old'));
      await service.createCheckout(U1);
      expect(paddle.createCustomer).not.toHaveBeenCalled();
      expect(paddle.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'ctm_old' }));
    });
    it('сохранённый customer id — без поиска', async () => {
      users.u1.paddleCustomerId = 'ctm_saved';
      await service.createCheckout(U1);
      expect(paddle.findCustomerByEmail).not.toHaveBeenCalled();
    });
    it('test-режим, не админ → 403', async () => {
      users.u1.role = 'user';
      await expect(service.createCheckout(U1)).rejects.toThrow(ForbiddenException);
      expect(paddle.createTransaction).not.toHaveBeenCalled();
    });
    it('уже подписан → 409', async () => {
      users.u1.subscriptionStatus = 'active';
      await expect(service.createCheckout(U1)).rejects.toThrow(ConflictException);
    });
    it('Paddle упал → 502', async () => {
      paddle.createTransaction.mockReturnValue(Promise.reject(new PaddleError(500, 'boom')));
      await expect(service.createCheckout(U1)).rejects.toThrow(BadGatewayException);
    });
    it('у Paddle уже есть живая подписка (вебхук не дошёл) → применяем её и 409, транзакции нет', async () => {
      users.u1.paddleCustomerId = 'ctm_saved';
      paddle.listLiveSubscriptions.mockReturnValue(Promise.resolve([{
        id: 'sub_live', status: 'active', customer_id: 'ctm_saved', custom_data: { userId: U1 },
        next_billed_at: '2026-11-01T10:00:00Z', scheduled_change: null, updated_at: '2026-10-01T10:00:00Z',
      }]));
      await expect(service.createCheckout(U1)).rejects.toThrow(ConflictException);
      expect(paddle.listLiveSubscriptions).toHaveBeenCalledWith('ctm_saved');
      expect(paddle.createTransaction).not.toHaveBeenCalled();
      expect(users.u1.plan).toBe('pro');
      expect(users.u1.paddleSubscriptionId).toBe('sub_live');
      expect(users.u1.subscriptionStatus).toBe('active');
    });
    it('новый покупатель — список подписок не спрашиваем', async () => {
      await service.createCheckout(U1);
      expect(paddle.listLiveSubscriptions).not.toHaveBeenCalled();
    });
  });

  describe('createPortal', () => {
    it('ссылка портала по customer/subscription', async () => {
      Object.assign(users.u1, { paddleCustomerId: 'ctm_1', paddleSubscriptionId: 'sub_1', subscriptionStatus: 'active' });
      expect(await service.createPortal(U1)).toEqual({ url: 'https://portal/x' });
      expect(paddle.createPortalSession).toHaveBeenCalledWith('ctm_1', 'sub_1');
    });
    it('без покупателя → 409', async () => {
      await expect(service.createPortal(U1)).rejects.toThrow(ConflictException);
    });
  });

  describe('handleWebhook', () => {
    const event = (over: any = {}) => ({
      event_type: 'subscription.created', occurred_at: '2026-10-01T10:00:00Z',
      data: { id: 'sub_1', status: 'active', customer_id: 'ctm_1', custom_data: { userId: U1 },
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
    it('вторая живая подписка при живой сохранённой — отменяем новую, сохранённую не трогаем', async () => {
      await send(event());
      await send(event({ data: { ...event().data, id: 'sub_2' }, occurred_at: '2026-10-01T10:05:00Z' }));
      expect(paddle.cancelSubscription).toHaveBeenCalledWith('sub_2');
      expect(users.u1.paddleSubscriptionId).toBe('sub_1');
      expect(users.u1.plan).toBe('pro');
    });
    it('canceled чужой (второй) подписки не сбрасывает живую сохранённую', async () => {
      await send(event());
      await send(event({ event_type: 'subscription.canceled', data: { ...event().data, id: 'sub_2', status: 'canceled' },
                         occurred_at: '2026-10-01T10:06:00Z' }));
      expect(paddle.cancelSubscription).not.toHaveBeenCalled();
      expect(users.u1.paddleSubscriptionId).toBe('sub_1');
      expect(users.u1.subscriptionStatus).toBe('active');
    });
    it('после отмены сохранённой — новая подписка применяется', async () => {
      await send(event());
      await send(event({ data: { ...event().data, status: 'canceled' }, occurred_at: '2026-10-02T10:00:00Z' }));
      await send(event({ data: { ...event().data, id: 'sub_3' }, occurred_at: '2026-10-03T10:00:00Z' }));
      expect(users.u1.paddleSubscriptionId).toBe('sub_3');
      expect(users.u1.plan).toBe('pro');
    });
    it('отмена второй подписки упала в Paddle → 502 (Paddle повторит событие), сохранённая цела', async () => {
      await send(event());
      paddle.cancelSubscription.mockReturnValue(Promise.reject(new PaddleError(500, 'boom')));
      await expect(send(event({ data: { ...event().data, id: 'sub_2' }, occurred_at: '2026-10-01T10:05:00Z' }))).rejects.toThrow(BadGatewayException);
      expect(users.u1.paddleSubscriptionId).toBe('sub_1');
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
  describe('ревью: важные замечания', () => {
    const base = () => ({
      event_type: 'subscription.created', occurred_at: '2026-10-01T10:00:00Z',
      data: { id: 'sub_1', status: 'active', customer_id: 'ctm_1', custom_data: { userId: U1 } as any,
              next_billed_at: '2026-11-01T10:00:00Z', scheduled_change: null },
    });
    const send = (body: any) => {
      const raw = JSON.stringify(body);
      return service.handleWebhook(sign(raw), Buffer.from(raw), body);
    };

    it('не-UUID в custom_data.userId — фолбэк по subscription id, без 500', async () => {
      users.u1.paddleSubscriptionId = 'sub_1';
      const ev = base(); ev.data.custom_data = { userId: 'not-a-uuid' };
      await expect(send(ev)).resolves.toEqual({ ok: true });
      expect(users.u1.plan).toBe('pro');
    });

    it('параллельная доставка: устаревшее чтение не перетирает более новое событие', async () => {
      Object.assign(users.u1, { plan: 'free', subscriptionStatus: 'canceled', paddleEventAt: Date.parse('2026-10-05T10:00:00Z') });
      // findByPk отдаёт снимок, прочитанный до записи canceled
      userModel.findByPk.mockImplementationOnce(() => Promise.resolve({ ...users.u1, paddleEventAt: null, plan: 'pro', subscriptionStatus: 'active',
        update: jest.fn(function (this: any, patch: any) { Object.assign(users.u1, patch); return Promise.resolve(this); }) }));
      await send({ ...base(), event_type: 'subscription.updated', occurred_at: '2026-10-04T10:00:00Z' });
      expect(users.u1.plan).toBe('free');
      expect(users.u1.subscriptionStatus).toBe('canceled');
    });

    it('вторая живая подписка того же пользователя — logger.error с обоими id', async () => {
      Object.assign(users.u1, { paddleSubscriptionId: 'sub_old', subscriptionStatus: 'active', paddleEventAt: Date.parse('2026-09-01T10:00:00Z') });
      const err = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await send(base());
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/sub_old.*sub_1|sub_1.*sub_old/));
    });

    it('live без PADDLE_ENV=production — оплата выключена (503), checkout недоступен', async () => {
      process.env.BILLING_MODE = 'live';
      process.env.PADDLE_ENV = 'sandbox';
      expect(() => service.clientConfig()).toThrow(ServiceUnavailableException);
      await expect(service.createCheckout(U1)).rejects.toThrow(ServiceUnavailableException);
    });

    it('удаление: Paddle 404/400 на отмену (уже отменена) — не блокирует удаление', async () => {
      paddle.cancelSubscription.mockReturnValue(Promise.reject(new PaddleError(404, 'not found')));
      await expect(service.cancelForUser(mkUser({ paddleSubscriptionId: 'sub_1', subscriptionStatus: 'active' }) as any)).resolves.toBeUndefined();
      paddle.cancelSubscription.mockReturnValue(Promise.reject(new PaddleError(400, 'subscription is canceled')));
      await expect(service.cancelForUser(mkUser({ paddleSubscriptionId: 'sub_1', subscriptionStatus: 'active' }) as any)).resolves.toBeUndefined();
    });

    it('удаление: Paddle 401/429 — 502 (ключи или лимит, отмена не подтверждена)', async () => {
      for (const st of [401, 429]) {
        paddle.cancelSubscription.mockReturnValue(Promise.reject(new PaddleError(st, 'x')));
        await expect(service.cancelForUser(mkUser({ paddleSubscriptionId: 'sub_1', subscriptionStatus: 'active' }) as any))
          .rejects.toThrow(BadGatewayException);
      }
    });
  });
});
