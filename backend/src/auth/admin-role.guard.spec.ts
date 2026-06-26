import { ForbiddenException } from '@nestjs/common';
import { AdminRoleGuard } from './admin-role.guard';

const ctx = (userId?: string): any => ({
  switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined }) }),
});

describe('AdminRoleGuard', () => {
  const make = (user: any) =>
    new AdminRoleGuard({ findByPk: jest.fn(() => Promise.resolve(user)) } as any);

  it('role=admin -> пропускает', async () => {
    await expect(make({ id: 'u1', role: 'admin' }).canActivate(ctx('u1'))).resolves.toBe(true);
  });

  it('role=user -> 403', async () => {
    await expect(make({ id: 'u1', role: 'user' }).canActivate(ctx('u1'))).rejects.toThrow(ForbiddenException);
  });

  it('юзер не найден -> 403', async () => {
    await expect(make(null).canActivate(ctx('u1'))).rejects.toThrow(ForbiddenException);
  });

  it('нет req.user -> 403', async () => {
    await expect(make({ role: 'admin' }).canActivate(ctx(undefined))).rejects.toThrow(ForbiddenException);
  });
});
