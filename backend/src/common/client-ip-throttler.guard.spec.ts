import { ClientIpThrottlerGuard, clientIp } from './client-ip-throttler.guard';

describe('clientIp (трекер лимита за Cloudflare → Traefik)', () => {
  it('ближайший отправитель — Cloudflare → доверяем CF-Connecting-IP', () => {
    expect(clientIp({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7, 172.68.10.1' } }))
      .toBe('203.0.113.7');
  });
  it('IPv6-адрес Cloudflare тоже доверенный', () => {
    expect(clientIp({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '2606:4700:10::ac43:1' } }))
      .toBe('198.51.100.9');
  });
  it('прямой заход на origin с подделанным CF-Connecting-IP — лимит по реальному отправителю', () => {
    expect(clientIp({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4, 45.83.1.1' } }))
      .toBe('45.83.1.1');
  });
  it('без X-Forwarded-For — req.ip, заголовок CF игнорируется', () => {
    expect(clientIp({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '1.2.3.4' } })).toBe('10.0.0.5');
  });
  it('мусор в X-Forwarded-For не роняет запрос — req.ip', () => {
    expect(clientIp({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': 'not-an-ip' } })).toBe('10.0.0.5');
  });
  it('гард использует clientIp', async () => {
    const req = { ip: '10.0.0.5', headers: {} };
    expect(await (ClientIpThrottlerGuard.prototype as any).getTracker.call({}, req)).toBe('10.0.0.5');
  });
});
