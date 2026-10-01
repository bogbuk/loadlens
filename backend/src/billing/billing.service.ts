import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../users/user.model';
import { PaddleClient, PaddleError } from './paddle.client';
import {
  applySubscriptionEvent, billingConfigured, billingMode, billingVisible, hasLiveSubscription,
  PaddleSubEvent, priceIdFor, syncEventFor, verifySignature,
} from './billing';

// users.id — UUID: не-UUID в findByPk у Postgres — ошибка запроса (500 и бесконечные повторы Paddle).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  async createCheckout(userId: string, interval?: string): Promise<{ url: string }> {
    const user = await this.visibleUser(userId);
    const priceId = priceIdFor(process.env, interval);
    if (!priceId) throw new BadRequestException('this billing interval is not available');
    if (hasLiveSubscription(user)) throw new ConflictException('already subscribed');
    let customerId = user.paddleCustomerId;
    if (!customerId) {
      customerId = (await this.gateway(this.paddle.findCustomerByEmail(user.email)))
        ?? (await this.gateway(this.paddle.createCustomer(user.email)));
      await user.update({ paddleCustomerId: customerId });
    } else {
      // Покупатель уже есть → мог оплатить, а вебхук ещё в пути (или потерян): вторую подписку не продаём,
      // живую подтягиваем сами. Новому покупателю подписок быть не может — лишний вызов не делаем.
      const live = (await this.gateway(this.paddle.listLiveSubscriptions(customerId)))[0];
      if (live) {
        await this.applyEvent(user, syncEventFor(live));
        throw new ConflictException('already subscribed');
      }
    }
    const url = await this.gateway(this.paddle.createTransaction({
      priceId, customerId, userId: user.id,
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
    // Чужая подписка при живой сохранённой: событие не применяем (иначе canceled второй сбросил бы Pro).
    if (hasLiveSubscription(user) && user.paddleSubscriptionId && user.paddleSubscriptionId !== ev.data.id) {
      // Двойная покупка до вебхука: вторую отменяем сразу (деньги за неё возвращает админ в Paddle).
      // Отмена не удалась → 502: Paddle повторит событие, и мы попробуем ещё раз.
      if (hasLiveSubscription({ subscriptionStatus: ev.data.status })) {
        this.logger.error(`paddle: user ${user.id} bought a second subscription ${ev.data.id} while ${user.paddleSubscriptionId} is live — canceling ${ev.data.id}, refund it manually`);
        await this.gateway(this.paddle.cancelSubscription(ev.data.id));
      }
      return { ok: true };
    }
    await this.applyEvent(user, ev);
    return { ok: true };
  }

  private async applyEvent(user: User, ev: PaddleSubEvent): Promise<void> {
    const patch = applySubscriptionEvent(user, ev, Date.now());
    if (!patch) return;
    // Условный UPDATE: при параллельной доставке старое событие не перетрёт уже записанное новое.
    await this.userModel.update(patch, {
      where: { id: user.id, [Op.or]: [{ paddleEventAt: null }, { paddleEventAt: { [Op.lt]: patch.paddleEventAt } }] },
    });
  }

  private async findUser(ev: PaddleSubEvent): Promise<User | null> {
    const userId = ev.data?.custom_data?.userId;
    if (typeof userId === 'string' && UUID_RE.test(userId)) {
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
    try {
      await this.paddle.cancelSubscription(user.paddleSubscriptionId);
    } catch (e) {
      // 400/404/409/422 — подписки нет или она уже отменена (наш статус отстал): удалению не мешает.
      // 401/403 (ключи), 429 и 5xx/сеть — отмена не подтверждена → 502, аккаунт цел.
      if (e instanceof PaddleError && [400, 404, 409, 422].includes(e.status)) {
        this.logger.warn(`paddle cancel ${user.paddleSubscriptionId}: ${e.status} ${e.message} — treating as already canceled`);
        return;
      }
      await this.gateway(Promise.reject(e));
    }
  }
}
