import { UnauthorizedException } from '@nestjs/common';
import { DevicesService } from './devices.service';

const proUser = () => ({ id: 'u1', plan: 'pro', deviceEvictions: 0 }) as any;
const freeUser = () => ({ id: 'u1', plan: 'free', deviceEvictions: 0 }) as any;

function makeService(rows: any[]) {
  const model = {
    findAll: jest.fn().mockResolvedValue(rows),
    upsert: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(rows.length),
    findOne: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(rows.find((r) => r.clientId === where.clientId) ?? null)),
  };
  const users = { increment: jest.fn().mockResolvedValue(undefined) };
  return { svc: new DevicesService(model as any, users as any), model, users };
}

const row = (clientId: string, minutesAgo: number) =>
  ({ clientId, lastSeenAt: new Date(Date.now() - minutesAgo * 60000) });

describe('DevicesService.registerOnAuth', () => {
  it('pro без clientId — 401 client_id_required', async () => {
    const { svc } = makeService([]);
    await expect(svc.registerOnAuth(proUser(), null)).rejects.toMatchObject({
      response: { reason: 'client_id_required' },
    });
  });

  it('free без clientId — проходит молча, ничего не пишем', async () => {
    const { svc, model } = makeService([]);
    await expect(svc.registerOnAuth(freeUser(), null)).resolves.toBeUndefined();
    expect(model.upsert).not.toHaveBeenCalled();
  });

  it('свободный слот — устройство пишется, вытеснения нет', async () => {
    const { svc, model, users } = makeService([row('a', 100)]);
    await svc.registerOnAuth(proUser(), 'b');
    expect(model.upsert).toHaveBeenCalled();
    expect(model.destroy).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });

  it('переполнение у pro — самое давнее удаляется, счётчик растёт на число вытесненных', async () => {
    const { svc, model, users } = makeService([row('old', 500), row('mid', 100), row('new', 10)]);
    await svc.registerOnAuth(proUser(), 'fresh');
    expect(model.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clientId: ['old'] }) }),
    );
    expect(users.increment).toHaveBeenCalledWith('deviceEvictions', { by: 1, where: { id: 'u1' } });
  });

  it('переполнение у free — не удаляем и не считаем', async () => {
    const { svc, model, users } = makeService([row('a', 500), row('b', 100), row('c', 10)]);
    await svc.registerOnAuth(freeUser(), 'dd');
    expect(model.destroy).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });
});

describe('DevicesService.verifyOnRefresh', () => {
  it('pro без clientId — 401 client_id_required', async () => {
    const { svc } = makeService([]);
    await expect(svc.verifyOnRefresh(proUser(), null)).rejects.toMatchObject({
      response: { reason: 'client_id_required' },
    });
  });

  it('pro с неизвестным устройством — 401 device_limit', async () => {
    const { svc } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toMatchObject({
      response: { reason: 'device_limit' },
    });
  });

  it('pro с известным устройством — проходит и освежает lastSeenAt', async () => {
    const { svc, model } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'a')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalled();
  });

  it('free с неизвестным устройством — не отказываем, просто пишем', async () => {
    const { svc, model } = makeService([]);
    await expect(svc.verifyOnRefresh(freeUser(), 'whatever')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalled();
  });
});
