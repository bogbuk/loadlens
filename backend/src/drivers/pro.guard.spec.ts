import { ForbiddenException } from '@nestjs/common';
import { ProGuard } from './pro.guard';

const ctx = (userId: string | undefined): any => ({
  switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined }) }),
});
const usersWith = (user: any): any => ({ findByPk: jest.fn().mockResolvedValue(user) });

describe('ProGuard', () => {
  it('постоянный Pro → пропуск', async () => {
    await expect(new ProGuard(usersWith({ plan: 'pro' })).canActivate(ctx('u1'))).resolves.toBe(true);
  });
  it('Free на активном триале → пропуск', async () => {
    const g = new ProGuard(usersWith({ plan: 'free', proUntil: String(Date.now() + 86_400_000) }));
    await expect(g.canActivate(ctx('u1'))).resolves.toBe(true);
  });
  it('Free с истёкшим триалом → 403', async () => {
    const g = new ProGuard(usersWith({ plan: 'free', proUntil: Date.now() - 1 }));
    await expect(g.canActivate(ctx('u1'))).rejects.toThrow(ForbiddenException);
  });
  it('Free без триала и без пользователя → 403', async () => {
    await expect(new ProGuard(usersWith({ plan: 'free' })).canActivate(ctx('u1'))).rejects.toThrow(ForbiddenException);
    await expect(new ProGuard(usersWith(null)).canActivate(ctx(undefined))).rejects.toThrow(ForbiddenException);
  });
});
