import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';

describe('ClientIpThrottlerGuard', () => {
  const tracker = (req: any) => (ClientIpThrottlerGuard.prototype as any).getTracker.call({}, req);
  it('за Cloudflare считает по CF-Connecting-IP, а не по IP прокси', async () => {
    expect(await tracker({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '203.0.113.7' } })).toBe('203.0.113.7');
  });
  it('без заголовка — req.ip', async () => {
    expect(await tracker({ ip: '10.0.0.5', headers: {} })).toBe('10.0.0.5');
  });
});
