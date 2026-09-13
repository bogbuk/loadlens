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
  const cloud = { findOne: jest.fn().mockResolvedValue(null) };
  return { svc: new DevicesService(model as any, users as any, cloud as any), model, users, cloud };
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

  // Раскатка 0.5.0: pro входил старой сборкой без X-Client-Id (мягкий режим), строки устройства нет.
  // Первый refresh уже с заголовком — это НЕ вытеснение: слоты свободны, устройство надо записать.
  it('pro, неизвестное устройство, таблица пуста — регистрируем, не отказываем', async () => {
    const { svc, model, users } = makeService([]);
    await expect(svc.verifyOnRefresh(proUser(), 'fresh')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', clientId: 'fresh' }));
    expect(users.increment).not.toHaveBeenCalled();
  });

  it('pro, неизвестное устройство, есть свободный слот — регистрируем, ничего не вытесняем', async () => {
    const { svc, model, users } = makeService([row('a', 10), row('b', 20)]);
    await expect(svc.verifyOnRefresh(proUser(), 'fresh')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', clientId: 'fresh' }));
    expect(model.destroy).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });

  it('pro, неизвестное устройство, слот освобождает только просроченная строка — регистрируем, просроченную удаляем молча', async () => {
    const { svc, model, users } = makeService([row('ancient', 60 * 24 * 40), row('b', 20), row('c', 30)]);
    await expect(svc.verifyOnRefresh(proUser(), 'fresh')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', clientId: 'fresh' }));
    expect(model.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clientId: ['ancient'] }) }),
    );
    expect(users.increment).not.toHaveBeenCalled();
  });

  // Вытесненное устройство держит валидный refresh-токен: пока слоты заняты — не пускаем.
  it('pro, неизвестное устройство, слоты заняты — 401 device_limit, ничего не пишем', async () => {
    const { svc, model } = makeService([row('a', 10), row('b', 20), row('c', 30)]);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toMatchObject({
      response: { statusCode: 401, reason: 'device_limit' },
    });
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.destroy).not.toHaveBeenCalled();
  });

  it('pro с известным устройством — проходит, освежает lastSeenAt (findAll, не findOne)', async () => {
    const { svc, model } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'a')).resolves.toBeUndefined();
    expect(model.findAll).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(model.upsert).toHaveBeenCalled();
  });

  it('pro с clientId чужого пользователя — не считается известным устройством, при занятых слотах 401 device_limit', async () => {
    const { svc, model } = makeService([
      { ...row('a', 10), userId: 'other-user' }, row('x', 10), row('y', 20), row('z', 30),
    ]);
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

describe('DevicesService: облачный инстанс', () => {
  const UUID = '123e4567-e89b-12d3-a456-426614174000';
  it('cloud:<id> своего инстанса — не регистрируется и не вытесняет', async () => {
    const { svc, model, cloud } = makeService([row('a', 1), row('b', 1), row('c', 1)]);
    cloud.findOne.mockResolvedValue({ id: UUID, userId: 'u1' });
    await svc.registerOnAuth(proUser(), `cloud:${UUID}`);
    await svc.verifyOnRefresh(proUser(), `cloud:${UUID}`);
    expect(cloud.findOne).toHaveBeenCalledWith({ where: { id: UUID, userId: 'u1' } });
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.destroy).not.toHaveBeenCalled();
  });
  it('cloud:<чужой или несуществующий id> — обычное устройство (лимит работает)', async () => {
    const { svc, model, users } = makeService([row('a', 1), row('b', 1), row('c', 1)]);
    await svc.registerOnAuth(proUser(), `cloud:${UUID}`);
    expect(model.upsert).toHaveBeenCalled();
    expect(users.increment).toHaveBeenCalled(); // 4-е устройство → вытеснение
  });
  it('cloud:<не-uuid> — в БД не ходим, обычное устройство', async () => {
    const { svc, cloud, model } = makeService([]);
    await svc.registerOnAuth(freeUser(), 'cloud:whatever');
    expect(cloud.findOne).not.toHaveBeenCalled();
    expect(model.upsert).toHaveBeenCalled();
  });
});
