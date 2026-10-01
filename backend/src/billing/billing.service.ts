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
