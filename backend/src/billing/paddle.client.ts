import { Injectable } from '@nestjs/common';
import { LIVE_STATUSES, paddleApiBase, PaddleSubscription } from './billing';

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

  // Живые подписки покупателя — страховка от двойной покупки, когда вебхук первой ещё не дошёл (или потерялся).
  async listLiveSubscriptions(customerId: string): Promise<PaddleSubscription[]> {
    const q = `customer_id=${encodeURIComponent(customerId)}&status=${encodeURIComponent(LIVE_STATUSES.join(','))}`;
    return this.call<PaddleSubscription[]>('GET', `/subscriptions?${q}`);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: 'immediately' });
  }
}
