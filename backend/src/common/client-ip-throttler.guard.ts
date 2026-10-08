import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BlockList, isIP, isIPv6 } from 'net';

// Опубликованные диапазоны Cloudflare (https://www.cloudflare.com/ips/), стабильны годами.
const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32'];
const cloudflare = new BlockList();
for (const c of CF_V4) { const [a, p] = c.split('/'); cloudflare.addSubnet(a, Number(p), 'ipv4'); }
for (const c of CF_V6) { const [a, p] = c.split('/'); cloudflare.addSubnet(a, Number(p), 'ipv6'); }

// Кому считать лимит. Бэкенд за Cloudflare → Traefik: req.ip — адрес Traefik, и все делили бы один бакет.
// CF-Connecting-IP доверяем ТОЛЬКО если ближайший к Traefik отправитель (правая запись X-Forwarded-For,
// её дописывает сам Traefik) — Cloudflare: origin доступен и напрямую по IP, там заголовок подделывается.
export function clientIp(req: Record<string, any>): string {
  const xff = String(req.headers?.['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const peer = xff[xff.length - 1];
  if (!peer || !isIP(peer)) return req.ip;
  const viaCf = cloudflare.check(peer, isIPv6(peer) ? 'ipv6' : 'ipv4');
  const cf = req.headers?.['cf-connecting-ip'];
  return viaCf && typeof cf === 'string' && cf ? cf : peer;
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return clientIp(req);
  }
}
