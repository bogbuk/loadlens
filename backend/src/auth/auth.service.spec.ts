import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { sha256 } from './reset-code';

describe('AuthService', () => {
  let service: AuthService;
  let users: Record<string, any>;
  const jwt = new JwtService({ secret: 'test-secret' });

  let telegram: { sendMessageTo: jest.Mock };

  beforeEach(() => {
    users = {};
    telegram = { sendMessageTo: jest.fn(() => Promise.resolve(true)) };
    const userModel: any = {
      findOne: jest.fn(({ where }) => {
        if (where.email) return Promise.resolve(users[where.email] ?? null);
        if (where.passwordResetTokenHash)
          return Promise.resolve(
            Object.values(users).find((u: any) => u.passwordResetTokenHash === where.passwordResetTokenHash) ?? null,
          );
        return Promise.resolve(null);
      }),
      create: jest.fn((data) => {
        if (users[data.email]) return Promise.reject(new Error('unique'));
        users[data.email] = {
          id: 'u-' + data.email, plan: 'free', role: 'user', blocked: false,
          telegramChatId: null, passwordResetTokenHash: null, passwordResetExpires: null, tokenVersion: 0,
          save: jest.fn(function (this: any) { return Promise.resolve(this); }),
          ...data,
        };
        return Promise.resolve(users[data.email]);
      }),
      findByPk: jest.fn((id) =>
        Promise.resolve(Object.values(users).find((u: any) => u.id === id) ?? null)),
      update: jest.fn((vals, { where: { email } }) => {
        if (users[email]) Object.assign(users[email], vals);
        return Promise.resolve([1]);
      }),
    };
    const devicesStub = { registerOnAuth: jest.fn(), verifyOnRefresh: jest.fn() } as any;
    service = new AuthService(userModel, jwt, telegram as any, devicesStub);
  });

  it('register: хеширует пароль и возвращает токены без hash', async () => {
    const res = await service.register('A@b.MD', 'password1', null);
    expect(res.user).toEqual({ email: 'a@b.md', plan: 'free' });
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(users['a@b.md'].passwordHash).not.toBe('password1');
    expect(JSON.stringify(res)).not.toContain(users['a@b.md'].passwordHash);
  });

  it('register: дубль email -> ConflictException', async () => {
    await service.register('a@b.md', 'password1', null);
    await expect(service.register('a@b.md', 'password2', null)).rejects.toThrow(ConflictException);
  });

  it('login: неверный пароль -> UnauthorizedException', async () => {
    await service.register('a@b.md', 'password1', null);
    await expect(service.login('a@b.md', 'wrong-pass', null)).rejects.toThrow(UnauthorizedException);
  });

  it('login: несуществующий email -> UnauthorizedException (без различения)', async () => {
    await expect(service.login('no@b.md', 'password1', null)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: access-токен не принимается', async () => {
    const { accessToken } = await service.register('a@b.md', 'password1', null);
    await expect(service.refresh(accessToken, null)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: валидный refresh выдаёт новую пару', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1', null);
    const res = await service.refresh(refreshToken, null);
    expect(res.accessToken).toBeTruthy();
    expect(jwt.verify(res.accessToken)).toMatchObject({ type: 'access' });
  });

  it('login: email из ADMIN_EMAIL -> апгрейд role=admin', async () => {
    process.env.ADMIN_EMAIL = 'a@b.md';
    await service.register('a@b.md', 'password1', null);
    await service.login('a@b.md', 'password1', null);
    expect(users['a@b.md'].role).toBe('admin');
    delete process.env.ADMIN_EMAIL;
  });

  it('login: blocked юзер -> ForbiddenException', async () => {
    await service.register('a@b.md', 'password1', null);
    users['a@b.md'].blocked = true;
    await expect(service.login('a@b.md', 'password1', null)).rejects.toThrow(ForbiddenException);
  });

  it('refresh: blocked юзер -> ForbiddenException', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1', null);
    users['a@b.md'].blocked = true;
    await expect(service.refresh(refreshToken, null)).rejects.toThrow(ForbiddenException);
  });

  it('forgot: привязанный Telegram → код отправлен, поля записаны, {ok:true}', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    await service.register('a@b.md', 'password1', null);
    users['a@b.md'].telegramChatId = 'chat-1';
    const res = await service.forgot('A@B.md');
    expect(res).toEqual({ ok: true });
    expect(telegram.sendMessageTo).toHaveBeenCalledWith('chat-1', expect.stringContaining('LoadLens password reset code'));
    expect(users['a@b.md'].passwordResetTokenHash).toBeTruthy();
    expect(Number(users['a@b.md'].passwordResetExpires)).toBeGreaterThan(Date.now());
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('forgot: нет привязки Telegram → не шлёт, всё равно {ok:true}', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    await service.register('a@b.md', 'password1', null);
    const res = await service.forgot('a@b.md');
    expect(res).toEqual({ ok: true });
    expect(telegram.sendMessageTo).not.toHaveBeenCalled();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('forgot: нет юзера → не шлёт, {ok:true}', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    const res = await service.forgot('nobody@b.md');
    expect(res).toEqual({ ok: true });
    expect(telegram.sendMessageTo).not.toHaveBeenCalled();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('forgot: ошибка отправки в Telegram не ломает ответ ({ok:true})', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    await service.register('a@b.md', 'password1', null);
    users['a@b.md'].telegramChatId = 'chat-1';
    telegram.sendMessageTo.mockRejectedValueOnce(new Error('tg down'));
    const res = await service.forgot('a@b.md');
    expect(res).toEqual({ ok: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('reset: валидный код → меняет пароль, чистит reset-поля', async () => {
    await service.register('a@b.md', 'password1', null);
    const before = users['a@b.md'].passwordHash;
    users['a@b.md'].passwordResetTokenHash = sha256('CODE1234');
    users['a@b.md'].passwordResetExpires = Date.now() + 60000;
    const res = await service.reset('CODE1234', 'new-password');
    expect(res).toEqual({ ok: true });
    expect(users['a@b.md'].passwordHash).not.toBe(before);
    expect(users['a@b.md'].passwordResetTokenHash).toBeNull();
    expect(users['a@b.md'].passwordResetExpires).toBeNull();
    expect(users['a@b.md'].tokenVersion).toBe(1);
  });

  it('reset: неизвестный код → BadRequestException', async () => {
    await expect(service.reset('NOPE0000', 'new-password')).rejects.toThrow(BadRequestException);
  });

  it('reset: истёкший код → BadRequestException', async () => {
    await service.register('a@b.md', 'password1', null);
    users['a@b.md'].passwordResetTokenHash = sha256('CODE1234');
    users['a@b.md'].passwordResetExpires = Date.now() - 1000;
    await expect(service.reset('CODE1234', 'new-password')).rejects.toThrow(BadRequestException);
  });

  it('login: access-токен несёт tv текущей версии', async () => {
    await service.register('a@b.md', 'password1', null);
    const { accessToken } = await service.login('a@b.md', 'password1', null);
    expect(jwt.verify(accessToken)).toMatchObject({ type: 'access', tv: 0 });
  });

  it('refresh: устаревший tv → UnauthorizedException', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1', null);
    users['a@b.md'].tokenVersion = 1;          // версия выросла после выпуска токена
    await expect(service.refresh(refreshToken, null)).rejects.toThrow(UnauthorizedException);
  });

  it('refresh: совпадающий tv → новая пара токенов', async () => {
    const { refreshToken } = await service.register('a@b.md', 'password1', null);
    const res = await service.refresh(refreshToken, null);
    expect(res.accessToken).toBeTruthy();
  });
});
