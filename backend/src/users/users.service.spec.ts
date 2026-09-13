import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let user: any;
  let userModel: any;
  let cloud: any;

  beforeEach(async () => {
    user = {
      id: 'u1',
      passwordHash: await bcrypt.hash('old-password', 10),
      tokenVersion: 0,
      save: jest.fn(function (this: any) { return Promise.resolve(this); }),
    };
    userModel = {
      findByPk: jest.fn((id) => Promise.resolve(id === 'u1' ? user : null)),
      destroy: jest.fn(() => Promise.resolve(1)),
    };
    cloud = { purgeForUser: jest.fn(() => Promise.resolve()) };
    service = new UsersService(userModel, cloud);
  });

  it('changePassword: неверный текущий пароль -> BadRequestException', async () => {
    await expect(service.changePassword('u1', 'wrong-pass', 'new-password')).rejects.toThrow(BadRequestException);
    expect(user.save).not.toHaveBeenCalled();
  });

  it('changePassword: новый совпадает со старым -> BadRequestException', async () => {
    await expect(service.changePassword('u1', 'old-password', 'old-password')).rejects.toThrow(BadRequestException);
    expect(user.save).not.toHaveBeenCalled();
  });

  it('changePassword: успех -> хеш меняется, save вызван, { ok: true }', async () => {
    const before = user.passwordHash;
    const res = await service.changePassword('u1', 'old-password', 'new-password');
    expect(res).toEqual({ ok: true });
    expect(user.save).toHaveBeenCalled();
    expect(user.passwordHash).not.toBe(before);
    expect(user.passwordHash).not.toBe('new-password');
    expect(await bcrypt.compare('new-password', user.passwordHash)).toBe(true);
  });

  it('changePassword: инкрементит tokenVersion (инвалидация сессий)', async () => {
    await service.changePassword('u1', 'old-password', 'new-password');
    expect(user.tokenVersion).toBe(1);
  });

  it('deleteMe: вызывает destroy и возвращает { ok: true }', async () => {
    const res = await service.deleteMe('u1');
    expect(res).toEqual({ ok: true });
    expect(userModel.destroy).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('deleteMe: сносит облачный браузер ДО удаления юзера (иначе строка уйдёт каскадом)', async () => {
    await service.deleteMe('u1');
    expect(cloud.purgeForUser).toHaveBeenCalledWith('u1');
    expect(cloud.purgeForUser.mock.invocationCallOrder[0])
      .toBeLessThan(userModel.destroy.mock.invocationCallOrder[0]);
  });
});
