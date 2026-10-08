import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Бэкенд стоит за Cloudflare → Traefik: req.ip — адрес прокси, и без этого все пользователи
// делили бы ОДИН бакет лимита. Cloudflare кладёт адрес клиента в CF-Connecting-IP.
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const cf = req.headers?.['cf-connecting-ip'];
    return (typeof cf === 'string' && cf) || req.ip;
  }
}
