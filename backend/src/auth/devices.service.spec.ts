import { UnauthorizedException } from '@nestjs/common';
import { DevicesService } from './devices.service';

const proUser = () => ({ id: 'u1', plan: 'pro', role: 'user', deviceEvictions: 0 }) as any;
const freeUser = () => ({ id: 'u1', plan: 'free', role: 'user', deviceEvictions: 0 }) as any;
const adminUser = () => ({ id: 'u1', plan: 'pro', role: 'admin', deviceEvictions: 0 }) as any;

function makeService(rows: any[]) {
  const model = {
    // Скоуп по userId, как в реальной модели: строка с чужим userId в выборку не попадает.
    findAll: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(rows.filter((r) => (r.userId ?? 'u1') === where.userId))),
    upsert: jest.fn().mockResolvedValue(undefined),
    // По умолчанию считаем, что удаляются все строки, переданные в where.clientId
    // (в этих тестах гонки нет). Конкретные тесты на гонку переопределяют это явно.
    destroy: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(Array.isArray(where.clientId) ? where.clientId.length : 1)),
  };
  const users = { increment: jest.fn().mockResolvedValue(undefined) };
  return { svc: new DevicesService(model as any, users as any), model, users };
}

const row = (clientId: string, minutesAgo: number) =>
  ({ clientId, lastSeenAt: new Date(Date.now() - minutesAgo * 60000) });

describe('DevicesService.registerOnAuth', () => {
  it('админ — выходит молча, устройства не трогает', async () => {
    const { svc, model, users } = makeService([row('a', 100)]);
    await expect(svc.registerOnAuth(adminUser(), null)).resolves.toBeUndefined();
    await expect(svc.registerOnAuth(adminUser(), 'x')).resolves.toBeUndefined();
    expect(model.findAll).not.toHaveBeenCalled();
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.destroy).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });

  it('pro без clientId — 401 client_id_required', async () => {
    const { svc } = makeService([]);
    await expect(svc.registerOnAuth(proUser(), null)).rejects.toMatchObject({
      response: { statusCode: 401, reason: 'client_id_required' },
    });
  });

  // Переходный режим на время раскатки 0.5.0 через Store: старые сборки не шлют заголовок,
  // и строгий отказ запирает Pro-пользователя наглухо (login и refresh оба отдают 401).
  describe('DEVICE_ID_REQUIRED=false — мягкий режим', () => {
    const prev = process.env.DEVICE_ID_REQUIRED;
    beforeEach(() => { process.env.DEVICE_ID_REQUIRED = 'false'; });
    afterEach(() => {
      if (prev === undefined) delete process.env.DEVICE_ID_REQUIRED;
      else process.env.DEVICE_ID_REQUIRED = prev;
    });

    it('pro без clientId — не отказываем, но и устройство не пишем', async () => {
      const { svc, model } = makeService([]);
      await expect(svc.registerOnAuth(proUser(), null)).resolves.toBeUndefined();
      expect(model.upsert).not.toHaveBeenCalled();
    });

    it('pro без clientId на refresh — не отказываем', async () => {
      const { svc } = makeService([]);
      await expect(svc.verifyOnRefresh(proUser(), null)).resolves.toBeUndefined();
    });

    it('pro С clientId — лимит работает как обычно (флаг касается только отсутствия заголовка)', async () => {
      const { svc, model, users } = makeService([row('old', 500), row('mid', 100), row('new', 10)]);
      await svc.registerOnAuth(proUser(), 'fresh');
      expect(model.destroy).toHaveBeenCalled();
      expect(users.increment).toHaveBeenCalled();
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

  it('просроченное устройство (>30 дней) удаляется молча, без инкремента счётчика', async () => {
    const staleRow = row('ancient', 60 * 24 * 40); // 40 дней назад
    const { svc, model, users } = makeService([staleRow]);
    await svc.registerOnAuth(proUser(), 'fresh');
    expect(model.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clientId: ['ancient'] }) }),
    );
    expect(users.increment).not.toHaveBeenCalled();
  });
});

describe('DevicesService.verifyOnRefresh', () => {
  it('админ — выходит молча, устройства не трогает', async () => {
    const { svc, model, users } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(adminUser(), null)).resolves.toBeUndefined();
    expect(model.findAll).not.toHaveBeenCalled();
    expect(model.upsert).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });

  it('pro без clientId — 401 client_id_required', async () => {
    const { svc } = makeService([]);
    await expect(svc.verifyOnRefresh(proUser(), null)).rejects.toMatchObject({
      response: { statusCode: 401, reason: 'client_id_required' },
    });
  });

  it('pro с неизвестным устройством — 401 device_limit', async () => {
    const { svc } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toMatchObject({
      response: { statusCode: 401, reason: 'device_limit' },
    });
  });

  it('pro с известным устройством — проходит, освежает lastSeenAt (findAll, не findOne)', async () => {
    const { svc, model } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'a')).resolves.toBeUndefined();
    expect(model.findAll).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(model.upsert).toHaveBeenCalled();
  });

  it('pro с clientId чужого пользователя — не считается известным устройством, 401 device_limit', async () => {
    const { svc, model } = makeService([{ ...row('a', 10), userId: 'other-user' }]);
    await expect(svc.verifyOnRefresh(proUser(), 'a')).rejects.toMatchObject({
      response: { statusCode: 401, reason: 'device_limit' },
    });
    expect(model.findAll).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('free с неизвестным устройством — не отказываем, просто пишем', async () => {
    const { svc, model } = makeService([]);
    await expect(svc.verifyOnRefresh(freeUser(), 'whatever')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalled();
  });

  // finding 2: устройства, набранные на free, не должны переживать апгрейд в pro навсегда —
  // refresh-токен скользящий, так что без подрезки здесь лимит обходится без единого login.
  it('pro, устройств больше лимита (пережили апгрейд с free) — refresh тоже подрезает список', async () => {
    const { svc, model, users } = makeService([
      row('old', 500), row('mid', 100), row('current', 50), row('new', 10),
    ]);
    await svc.verifyOnRefresh(proUser(), 'current');
    expect(model.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clientId: ['old'] }) }),
    );
    expect(users.increment).toHaveBeenCalledWith('deviceEvictions', { by: 1, where: { id: 'u1' } });
  });

  it('pro, refresh с просроченным среди списка — удаляется молча, счётчик не растёт', async () => {
    const staleRow = row('ancient', 60 * 24 * 40); // 40 дней назад
    const { svc, model, users } = makeService([staleRow, row('current', 10)]);
    await svc.verifyOnRefresh(proUser(), 'current');
    expect(model.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clientId: ['ancient'] }) }),
    );
    expect(users.increment).not.toHaveBeenCalled();
  });
});
