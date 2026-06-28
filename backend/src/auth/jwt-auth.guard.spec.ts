import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

const jwt = new JwtService({ secret: 'test-secret' });
const ctx = (token?: string): any => ({
  switchToHttp: () => ({ getRequest: () => ({ headers: token ? { authorization: 'Bearer ' + token } : {} }) }),
});
const make = (user: any) =>
  new JwtAuthGuard(jwt, { findByPk: jest.fn(() => Promise.resolve(user)) } as any);

describe('JwtAuthGuard', () => {
  it('валидный access, tv совпадает, не blocked → true', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 2 });
    await expect(make({ id: 'u1', tokenVersion: 2, blocked: false }).canActivate(ctx(t))).resolves.toBe(true);
  });

  it('tv не совпадает → 401', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 1 });
    await expect(make({ id: 'u1', tokenVersion: 2, blocked: false }).canActivate(ctx(t))).rejects.toThrow(UnauthorizedException);
  });

  it('blocked → 403', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 0 });
    await expect(make({ id: 'u1', tokenVersion: 0, blocked: true }).canActivate(ctx(t))).rejects.toThrow(ForbiddenException);
  });

  it('юзера нет → 401', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access', tv: 0 });
    await expect(make(null).canActivate(ctx(t))).rejects.toThrow(UnauthorizedException);
  });

  it('токен без tv при tokenVersion=0 → проходит (обратная совместимость)', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'access' });
    await expect(make({ id: 'u1', tokenVersion: 0, blocked: false }).canActivate(ctx(t))).resolves.toBe(true);
  });

  it('refresh-токен не принимается → 401', async () => {
    const t = jwt.sign({ sub: 'u1', type: 'refresh', tv: 0 });
    await expect(make({ id: 'u1', tokenVersion: 0, blocked: false }).canActivate(ctx(t))).rejects.toThrow(UnauthorizedException);
  });

  it('нет Bearer-токена → 401', async () => {
    await expect(make({ id: 'u1', tokenVersion: 0 }).canActivate(ctx(undefined))).rejects.toThrow(UnauthorizedException);
  });
});
