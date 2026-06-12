import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

const ctxWithKey = (key?: string): any => ({
  switchToHttp: () => ({ getRequest: () => ({ headers: key ? { 'x-admin-key': key } : {} }) }),
});

describe('AdminGuard', () => {
  afterEach(() => { delete process.env.ADMIN_KEY; });

  it('без ADMIN_KEY в env — всегда 403 (fail closed)', () => {
    expect(() => new AdminGuard().canActivate(ctxWithKey('anything'))).toThrow(ForbiddenException);
  });

  it('неверный ключ — 403', () => {
    process.env.ADMIN_KEY = 'secret';
    expect(() => new AdminGuard().canActivate(ctxWithKey('wrong'))).toThrow(ForbiddenException);
  });

  it('верный ключ — пропускает', () => {
    process.env.ADMIN_KEY = 'secret';
    expect(new AdminGuard().canActivate(ctxWithKey('secret'))).toBe(true);
  });
});
