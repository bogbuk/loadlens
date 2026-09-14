import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let users: Record<string, any>;
  let service: AdminService;

  const lanes: any = { overview: jest.fn(() => Promise.resolve({ loads: 10, lanes: 4, markets: 2, medianRpm: 2.1 })) };
  let devicesModel: any;
  let cloudInstances: any;
  let cloud: any;

  beforeEach(() => {
    users = {
      'a@b.md': { id: 'u1', email: 'a@b.md', plan: 'free', role: 'user', blocked: false, telegramChatId: null, alertsEnabled: false, deviceEvictions: 0, cloudEnabled: false, createdAt: new Date('2026-01-01') },
      'pro@b.md': { id: 'u2', email: 'pro@b.md', plan: 'pro', role: 'user', blocked: false, telegramChatId: 'c1', alertsEnabled: true, deviceEvictions: 3, cloudEnabled: false, createdAt: new Date('2026-02-01') },
      'boss@b.md': { id: 'u3', email: 'boss@b.md', plan: 'pro', role: 'admin', blocked: false, telegramChatId: null, alertsEnabled: false, deviceEvictions: 0, cloudEnabled: false, createdAt: new Date('2026-03-01') },
    };
    for (const u of Object.values(users)) (u as any).save = jest.fn(function (this: any) { return Promise.resolve(this); });
    const userModel: any = {
      findAll: jest.fn(({ where }: any = {}) => {
        let list = Object.values(users);
        const like = where?.email?.[Op.iLike];
        if (like) {
          const sub = String(like).replace(/%/g, '').toLowerCase();
          list = list.filter((u: any) => u.email.includes(sub));
        }
        return Promise.resolve(list);
      }),
      findOne: jest.fn(({ where: { email } }: any) => Promise.resolve(users[email] ?? null)),
      count: jest.fn(({ where }: any = {}) => {
        let list = Object.values(users) as any[];
        if (where?.plan) list = list.filter((u) => u.plan === where.plan);
        if (where?.blocked !== undefined) list = list.filter((u) => u.blocked === where.blocked);
        return Promise.resolve(list.length);
      }),
      // sum по deviceEvictions для сводки вытеснений
      sum: jest.fn((field: string) => {
        if (field !== 'deviceEvictions') return Promise.resolve(null);
        const list = Object.values(users) as any[];
        return Promise.resolve(list.reduce((acc, u) => acc + (u.deviceEvictions ?? 0), 0));
      }),
    };
    // устройства: pro@b.md — 2 активных, у остальных нет
    devicesModel = { findAll: jest.fn(() => Promise.resolve([{ userId: 'u2', n: '2' }])) };
    cloudInstances = { findAll: jest.fn(() => Promise.resolve([])) };
    cloud = { disableForUser: jest.fn(() => Promise.resolve()), enable: jest.fn(() => Promise.resolve({ enabled: true, status: 'starting' })), screen: jest.fn(() => Promise.resolve({ url: 'https://d/vnc.html', password: 'p' })) };
    service = new AdminService(userModel, devicesModel, lanes, cloudInstances, cloud);
  });

  it('listUsers: без passwordHash, поля-вьюхи', async () => {
    const list = await service.listUsers();
    expect(list).toHaveLength(3);
    expect(JSON.stringify(list)).not.toContain('passwordHash');
    expect(list.find((u) => u.email === 'pro@b.md')).toMatchObject({ plan: 'pro', telegramLinked: true, alertsEnabled: true, devices: 2, deviceEvictions: 3 });
    expect(list.find((u) => u.email === 'a@b.md')).toMatchObject({ telegramLinked: false, devices: 0, deviceEvictions: 0 });
  });

  it('listUsers: поиск по подстроке email', async () => {
    const list = await service.listUsers('pro');
    expect(list.map((u) => u.email)).toEqual(['pro@b.md']);
  });

  it('listUsers: счётчик устройств одним GROUP BY запросом, не N+1', async () => {
    await service.listUsers();
    expect(devicesModel.findAll).toHaveBeenCalledTimes(1);
  });

  it('stats: счётчики юзеров + overview lane + вытеснения', async () => {
    const s = await service.stats();
    expect(s).toMatchObject({ users: 3, proUsers: 2, blockedUsers: 0, evictions: 3, loads: 10, lanes: 4, markets: 2, medianRpm: 2.1 });
  });

  it('setPlan: меняет план', async () => {
    const r = await service.setPlan('a@b.md', 'pro');
    expect(r).toEqual({ email: 'a@b.md', plan: 'pro' });
    expect(users['a@b.md'].plan).toBe('pro');
  });

  it('setPlan: нет юзера -> 404', async () => {
    await expect(service.setPlan('no@b.md', 'pro')).rejects.toThrow(NotFoundException);
  });

  it('setBlocked: ставит флаг', async () => {
    const r = await service.setBlocked('a@b.md', true);
    expect(r).toEqual({ email: 'a@b.md', blocked: true });
    expect(users['a@b.md'].blocked).toBe(true);
  });

  it('setBlocked: нельзя блокировать админа -> 403', async () => {
    await expect(service.setBlocked('boss@b.md', true)).rejects.toThrow(ForbiddenException);
  });

  it('setBlocked: нет юзера -> 404', async () => {
    await expect(service.setBlocked('no@b.md', true)).rejects.toThrow(NotFoundException);
  });

  it('setCloudEnabled(false) выключает флаг и останавливает браузер; true — только флаг', async () => {
    users['pro@b.md'].cloudEnabled = true;
    await expect(service.setCloudEnabled('pro@b.md', false)).resolves.toEqual({ email: 'pro@b.md', cloudEnabled: false });
    expect(cloud.disableForUser).toHaveBeenCalledWith('u2');
    await service.setCloudEnabled('pro@b.md', true);
    expect(cloud.disableForUser).toHaveBeenCalledTimes(1);
    expect(users['pro@b.md'].cloudEnabled).toBe(true);
  });

  it('setCloudEnabled(false): если браузер не остановился, флаг НЕ снимается; при успехе — сначала стоп, потом save', async () => {
    users['pro@b.md'].cloudEnabled = true;
    cloud.disableForUser.mockRejectedValueOnce(new Error('boom'));
    await expect(service.setCloudEnabled('pro@b.md', false)).rejects.toThrow('boom');
    expect(users['pro@b.md'].cloudEnabled).toBe(true);

    await expect(service.setCloudEnabled('pro@b.md', false)).resolves.toEqual({ email: 'pro@b.md', cloudEnabled: false });
    const disableOrder = cloud.disableForUser.mock.invocationCallOrder[cloud.disableForUser.mock.invocationCallOrder.length - 1];
    const saveOrder = users['pro@b.md'].save.mock.invocationCallOrder[users['pro@b.md'].save.mock.invocationCallOrder.length - 1];
    expect(disableOrder).toBeLessThan(saveOrder);
  });
  it('cloudEnable: ставит cloud_enabled (если ещё нет) и поднимает браузер от имени юзера; нет юзера → 404', async () => {
    await expect(service.cloudEnable('pro@b.md')).resolves.toEqual({ email: 'pro@b.md', cloudEnabled: true, status: 'starting' });
    expect(users['pro@b.md'].cloudEnabled).toBe(true);
    expect(users['pro@b.md'].save).toHaveBeenCalled();
    expect(cloud.enable).toHaveBeenCalledWith('u2');
    await expect(service.cloudEnable('no@b.md')).rejects.toThrow(NotFoundException);
  });

  it('cloudEnable: флаг сохраняется ДО старта браузера (иначе CloudGuard режет heartbeat инстанса)', async () => {
    cloud.enable.mockRejectedValueOnce(new Error('coolify down'));
    await expect(service.cloudEnable('a@b.md')).rejects.toThrow('coolify down');
    expect(users['a@b.md'].cloudEnabled).toBe(true);
  });

  it('cloudScreen: отдаёт url+пароль экрана юзера; нет юзера → 404', async () => {
    await expect(service.cloudScreen('pro@b.md')).resolves.toEqual({ url: 'https://d/vnc.html', password: 'p' });
    expect(cloud.screen).toHaveBeenCalledWith('u2');
    await expect(service.cloudScreen('no@b.md')).rejects.toThrow(NotFoundException);
  });

  it('listUsers: подмешивает cloudStatus/cloudHeartbeatAt из cloud_instances', async () => {
    const hb = new Date();
    users['pro@b.md'].cloudEnabled = true;
    cloudInstances.findAll.mockResolvedValue([{ userId: 'u2', status: 'ok', lastHeartbeatAt: hb }]);
    const v = (await service.listUsers()).find((u) => u.email === 'pro@b.md')!;
    expect(v).toEqual(expect.objectContaining({ cloudEnabled: true, cloudStatus: 'ok', cloudHeartbeatAt: hb }));
    const free = (await service.listUsers()).find((u) => u.email === 'a@b.md')!;
    expect(free).toEqual(expect.objectContaining({ cloudEnabled: false, cloudStatus: null, cloudHeartbeatAt: null }));
  });
});
