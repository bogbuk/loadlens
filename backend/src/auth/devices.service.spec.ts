import { UnauthorizedException } from '@nestjs/common';
import { DevicesService } from './devices.service';

const proUser = () => ({ id: 'u1', plan: 'pro', deviceEvictions: 0 }) as any;
const freeUser = () => ({ id: 'u1', plan: 'free', deviceEvictions: 0 }) as any;

function makeService(rows: any[]) {
  const model = {
    findAll: jest.fn().mockResolvedValue(rows),
    upsert: jest.fn().mockResolvedValue(undefined),
    // По умолчанию считаем, что удаляются все строки, переданные в where.clientId
    // (в этих тестах гонки нет). Конкретные тесты на гонку переопределяют это явно.
    destroy: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(Array.isArray(where.clientId) ? where.clientId.length : 1)),
    // Скоуп по userId + clientId, как в реальной модели: строка с тем же
    // clientId, но чужим userId, известным устройством считаться не должна.
    findOne: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(
        rows.find((r) => r.clientId === where.clientId && (r.userId ?? 'u1') === where.userId) ?? null,
      )),
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

  it('гонка: строку уже удалил параллельный запрос — destroy вернул 0, счётчик не растёт', async () => {
    const { svc, model, users } = makeService([row('old', 500), row('mid', 100), row('new', 10)]);
    model.destroy.mockResolvedValueOnce(0);
    await svc.registerOnAuth(proUser(), 'fresh');
    expect(model.destroy).toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
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
    expect(model.findOne).toHaveBeenCalledWith({ where: { userId: 'u1', clientId: 'a' } });
    expect(model.upsert).toHaveBeenCalled();
  });

  it('pro с clientId чужого пользователя — не считается известным устройством, 401 device_limit', async () => {
    const { svc, model } = makeService([{ ...row('a', 10), userId: 'other-user' }]);
    await expect(svc.verifyOnRefresh(proUser(), 'a')).rejects.toMatchObject({
      response: { reason: 'device_limit' },
    });
    expect(model.findOne).toHaveBeenCalledWith({ where: { userId: 'u1', clientId: 'a' } });
  });

  it('free с неизвестным устройством — не отказываем, просто пишем', async () => {
    const { svc, model } = makeService([]);
    await expect(svc.verifyOnRefresh(freeUser(), 'whatever')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalled();
  });
});
