import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let users: Record<string, any>;
  const jwt = new JwtService({ secret: 'test-secret' });

  beforeEach(() => {
    users = {};
    const userModel: any = {
      findOne: jest.fn(({ where: { email } }) => Promise.resolve(users[email] ?? null)),
      create: jest.fn((data) => {
        if (users[data.email]) return Promise.reject(new Error('unique'));
        users[data.email] = { id: 'u-' + data.email, plan: 'free', role: 'user', blocked: false, ...data };
        return Promise.resolve(users[data.email]);
      }),
      findByPk: jest.fn((id) =>
        Promise.resolve(Object.values(users).find((u: any) => u.id === id) ?? null)),
      update: jest.fn((vals, { where: { email } }) => {
        if (users[email]) Object.assign(users[email], vals);
        return Promise.resolve([1]);
      }),
    };
    service = new AuthService(userModel, jwt);
  });

  it('register: хеширует пароль и возвращает токены без hash', async () => {
    const res = await service.register('A@b.MD', 'password1');
    expect(res.user).toEqual({ email: 'a@b.md', plan: 'free' });
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(users['a@b.md'].passwordHash).not.toBe('password1');
    expect(JSON.stringify(res)).not.toContain(users['a@b.md'].passwordHash);
  });

  it('register: дубль email -> ConflictException', async () => {
    await service.register('a@b.md', 'password1');
    await expect(service.register('a@b.md', 'password2')).rejects.toThrow(ConflictException);
  });

  it('login: неверный пароль -> UnauthorizedException', async () => {
    await service.register('a@b.md', 'password1');
    await expect(service.login('a@b.md', 'wrong-pass')).rejects.toThrow(UnauthorizedException);
  });

  it('login: несуществующий email -> UnauthorizedException (без различения)', async () => {
    await expect(service.login('no@b.md', 'password1')).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: access-токен не принимается', async () => {
    const { accessToken } = await service.register('a@b.md', 'password1');
    await expect(service.refresh(accessToken)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: валидный refresh выдаёт новую пару', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1');
    const res = await service.refresh(refreshToken);
    expect(res.accessToken).toBeTruthy();
    expect(jwt.verify(res.accessToken)).toMatchObject({ type: 'access' });
  });

  it('login: email из ADMIN_EMAIL -> апгрейд role=admin', async () => {
    process.env.ADMIN_EMAIL = 'a@b.md';
    await service.register('a@b.md', 'password1');
    await service.login('a@b.md', 'password1');
    expect(users['a@b.md'].role).toBe('admin');
    delete process.env.ADMIN_EMAIL;
  });

  it('login: blocked юзер -> ForbiddenException', async () => {
    await service.register('a@b.md', 'password1');
    users['a@b.md'].blocked = true;
    await expect(service.login('a@b.md', 'password1')).rejects.toThrow(ForbiddenException);
  });

  it('refresh: blocked юзер -> ForbiddenException', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1');
    users['a@b.md'].blocked = true;
    await expect(service.refresh(refreshToken)).rejects.toThrow(ForbiddenException);
  });
});
