import { ForbiddenException } from '@nestjs/common';
import { PremiumReadGuard } from './premium-read.guard';

const ctx = (headers: any): any => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
});
const usersWith = (user: any): any => ({ findByPk: jest.fn().mockResolvedValue(user) });
const jwtVerifying = (payload: any): any => ({ verifyAsync: jest.fn().mockResolvedValue(payload) });
const jwtRejecting = (): any => ({ verifyAsync: jest.fn().mockRejectedValue(new Error('bad')) });

describe('PremiumReadGuard', () => {
  afterEach(() => { delete process.env.API_KEYS; });

  it('валидный X-API-Key → пропуск (JWT не трогаем)', async () => {
    process.env.API_KEYS = 'good-key';
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({ 'x-api-key': 'good-key' }))).resolves.toBe(true);
  });

  it('неизвестный X-API-Key без Bearer → 403', async () => {
    process.env.API_KEYS = 'good-key';
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({ 'x-api-key': 'nope' }))).rejects.toThrow(ForbiddenException);
  });

  it('Pro-JWT без ключа → пропуск, req.user выставлен', async () => {
    const req: any = { headers: { authorization: 'Bearer t' } };
    const g = new PremiumReadGuard(usersWith({ plan: 'pro' }), jwtVerifying({ sub: 'u1', type: 'access' }));
    const c: any = { switchToHttp: () => ({ getRequest: () => req }) };
    await expect(g.canActivate(c)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'u1' });
  });

  it('access-JWT, но план не pro → 403', async () => {
    const g = new PremiumReadGuard(usersWith({ plan: 'free' }), jwtVerifying({ sub: 'u1', type: 'access' }));
    await expect(g.canActivate(ctx({ authorization: 'Bearer t' }))).rejects.toThrow(ForbiddenException);
  });

  it('refresh-токен (type!=access) → 403', async () => {
    const g = new PremiumReadGuard(usersWith({ plan: 'pro' }), jwtVerifying({ sub: 'u1', type: 'refresh' }));
    await expect(g.canActivate(ctx({ authorization: 'Bearer t' }))).rejects.toThrow(ForbiddenException);
  });

  it('пустой API_KEYS + любой X-API-Key → 403', async () => {
    process.env.API_KEYS = '';
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({ 'x-api-key': 'whatever' }))).rejects.toThrow(ForbiddenException);
  });

  it('ни ключа, ни токена → 403', async () => {
    const g = new PremiumReadGuard(usersWith(null), jwtRejecting());
    await expect(g.canActivate(ctx({}))).rejects.toThrow(ForbiddenException);
  });
});
