import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let users: Record<string, any>;
  let service: AdminService;

  const lanes: any = { overview: jest.fn(() => Promise.resolve({ loads: 10, lanes: 4, markets: 2, medianRpm: 2.1 })) };

  beforeEach(() => {
    users = {
      'a@b.md': { email: 'a@b.md', plan: 'free', role: 'user', blocked: false, telegramChatId: null, alertsEnabled: false, createdAt: new Date('2026-01-01') },
      'pro@b.md': { email: 'pro@b.md', plan: 'pro', role: 'user', blocked: false, telegramChatId: 'c1', alertsEnabled: true, createdAt: new Date('2026-02-01') },
      'boss@b.md': { email: 'boss@b.md', plan: 'pro', role: 'admin', blocked: false, telegramChatId: null, alertsEnabled: false, createdAt: new Date('2026-03-01') },
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
    };
    service = new AdminService(userModel, lanes);
  });

  it('listUsers: без passwordHash, поля-вьюхи', async () => {
    const list = await service.listUsers();
    expect(list).toHaveLength(3);
    expect(JSON.stringify(list)).not.toContain('passwordHash');
    expect(list.find((u) => u.email === 'pro@b.md')).toMatchObject({ plan: 'pro', telegramLinked: true, alertsEnabled: true });
    expect(list.find((u) => u.email === 'a@b.md')).toMatchObject({ telegramLinked: false });
  });

  it('listUsers: поиск по подстроке email', async () => {
    const list = await service.listUsers('pro');
    expect(list.map((u) => u.email)).toEqual(['pro@b.md']);
  });

  it('stats: счётчики юзеров + overview lane', async () => {
    const s = await service.stats();
    expect(s).toMatchObject({ users: 3, proUsers: 2, blockedUsers: 0, loads: 10, lanes: 4, markets: 2, medianRpm: 2.1 });
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
});
