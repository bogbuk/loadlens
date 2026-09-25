import { Op } from 'sequelize';
import { rpmCents, LoadsService } from './loads.service';

describe('rpmCents', () => {
  it('считает центы/милю из rate и груженых+deadhead миль', () => {
    // $2000 / (900+100) = $2.00/mi = 200 центов
    expect(rpmCents(2000, 900, 100)).toBe(200);
  });

  it('учитывает deadhead в знаменателе', () => {
    // $2500 / 1000 = $2.50 без DH; с DH 150 -> 2500/1150 = $2.17 = 217
    expect(rpmCents(2500, 1000, 0)).toBe(250);
    expect(rpmCents(2500, 1000, 150)).toBe(217);
  });

  it('null при отсутствии rate или нулевых милях', () => {
    expect(rpmCents(null, 1000, 0)).toBeNull();
    expect(rpmCents(2000, 0, 0)).toBeNull();
    expect(rpmCents(2000, null, null)).toBeNull();
  });
});

describe('LoadsService.byOrigin', () => {
  it('маппит строки в CrowdLoad без PII и ограничивает limit', async () => {
    const mockLastSeen = new Date('2026-06-15T10:00:00Z');
    const findAll = jest.fn().mockResolvedValueOnce([
      { board: 'dat', loadId: 'L1', originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
        equipment: 'F', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|F', lastSeen: mockLastSeen,
        rate: 2000, loadedMiles: 716,
        deadheadMiles: 20, weight: 44000, brokerMc: 'MC-1', brokerName: 'Acme' },
    ]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    const res = await svc.byOrigin('CHICAGO_IL', 'F', 999);
    expect(res[0]).toEqual({
      board: 'dat', loadId: 'L1', originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
      equipment: 'F', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|F', lastSeen: mockLastSeen,
      rate: 2000, loadedMiles: 716,
      deadheadMiles: 20, weight: 44000, brokerMc: 'MC-1', brokerName: 'Acme',
    });
    expect(res[0]).not.toHaveProperty('contact');
    expect(findAll.mock.calls[0][0].limit).toBe(300); // clamp 999 -> 300
    expect(findAll.mock.calls[0][0].where.equipment).toBe('F');
  });
});

describe('LoadsService.ingest seen_count', () => {
  it('инкрементит seen_count для уже существующих грузов (first_seen < now)', async () => {
    const bulkCreate = jest.fn().mockResolvedValue([]);
    const query = jest.fn().mockResolvedValue([]);
    const svc = new LoadsService({ bulkCreate } as any, { query } as any);
    await svc.ingest({
      clientId: 'c1',
      items: [{
        board: 'dat', loadId: 'L1', originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
        equipment: 'V', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|V',
      }],
    } as any);
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/seen_count = seen_count \+ 1/);
    expect(sql).toMatch(/first_seen < :now/);
    const repl = query.mock.calls[0][1].replacements;
    expect(repl.board).toBe('dat');
    expect(repl.ids).toEqual(['L1']);
  });

  it('маппит расширенные поля (2026-07-17) и включает их в updateOnDuplicate', async () => {
    const bulkCreate = jest.fn().mockResolvedValue([]);
    const svc = new LoadsService({ bulkCreate } as any, { query: jest.fn().mockResolvedValue([]) } as any);
    await svc.ingest({
      clientId: 'c1',
      items: [{
        board: 'dat', loadId: 'L1', originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
        equipment: 'K', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|K',
        originCity: 'Chicago', originState: 'IL', equipmentCode: 'RGN',
        creditScore: 97, daysToPay: 27.5, isAssurable: true, bookNow: false, bidCount: 0,
        comments: 'Lane.Jones@axlelogistics.com // 60.25ft long',
        contactEmail: 'ops@broker.test', contactPhone: '865-398-2058',
        pickupEarliest: '2026-07-17', dotNumber: '1234567',
      }],
    } as any);
    const row = bulkCreate.mock.calls[0][0][0];
    expect(row.originCity).toBe('Chicago');
    expect(row.equipmentCode).toBe('RGN');
    expect(row.creditScore).toBe(97);
    expect(row.daysToPay).toBe(27.5);
    expect(row.isAssurable).toBe(true);
    expect(row.bookNow).toBe(false);       // false не превращается в null
    expect(row.bidCount).toBe(0);          // 0 не превращается в null
    expect(row.comments).toContain('60.25ft long');
    expect(row.contactEmail).toBe('ops@broker.test');
    expect(row.pickupEarliest).toBe('2026-07-17');
    expect(row.destCity).toBeNull();       // не переданные — явный null
    const upd = bulkCreate.mock.calls[0][1].updateOnDuplicate;
    expect(upd).toEqual(expect.arrayContaining(['creditScore', 'comments', 'contactEmail', 'pickupEarliest']));
  });
});

describe('LoadsService.near', () => {
  it('возвращает соседей с originDeadheadMi и делит на loads/gone', async () => {
    const now = new Date('2026-06-17T12:00:00Z');
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    const findAll = jest.fn().mockResolvedValue([
      { board: 'dat', loadId: 'L1', originMarket: 'DALLAS_TX', destMarket: 'ATLANTA_GA',
        equipment: 'V', groupKey: 'g1', lastSeen: minsAgo(1), firstSeen: minsAgo(2), seenCount: 1,
        rate: 2000, loadedMiles: 800, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
      { board: 'dat', loadId: 'L2', originMarket: 'FORT_WORTH_TX', destMarket: 'HOUSTON_TX',
        equipment: 'V', groupKey: 'g2', lastSeen: minsAgo(60), firstSeen: minsAgo(150), seenCount: 10,
        rate: 1500, loadedMiles: 250, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
    ]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    const res = await svc.near('DALLAS_TX', { radiusMi: 75 }, now);

    expect(res.gone).toContain('L2');
    expect(res.loads.map((l) => l.loadId)).toEqual(['L1']);
    expect(res.loads[0].originDeadheadMi).toBe(0);
    expect(typeof res.loads[0].liveness).toBe('number');
    expect(typeof res.ts).toBe('string');
    const origins = findAll.mock.calls[0][0].where.originMarket;
    expect(origins[Op.in]).toContain('FORT_WORTH_TX');
  });

  it('с since отдаёт только обновлённые после since', async () => {
    const now = new Date('2026-06-17T12:00:00Z');
    const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    const findAll = jest.fn().mockResolvedValue([
      { board: 'dat', loadId: 'NEW', originMarket: 'DALLAS_TX', destMarket: 'ATLANTA_GA',
        equipment: 'V', groupKey: 'g', lastSeen: minsAgo(1), firstSeen: minsAgo(2), seenCount: 1,
        rate: 2000, loadedMiles: 800, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
      { board: 'dat', loadId: 'OLD', originMarket: 'DALLAS_TX', destMarket: 'MEMPHIS_TN',
        equipment: 'V', groupKey: 'g', lastSeen: minsAgo(30), firstSeen: minsAgo(40), seenCount: 1,
        rate: 1800, loadedMiles: 450, deadheadMiles: 0, weight: null, brokerMc: null, brokerName: null },
    ]);
    const svc = new LoadsService({ findAll } as any, { query: jest.fn() } as any);
    const res = await svc.near('DALLAS_TX', { since: minsAgo(10).toISOString() }, now);
    expect(res.loads.map((l) => l.loadId)).toEqual(['NEW']);
  });
});

describe('LoadsService.ingest — повтор при deadlock (40P01)', () => {
  const item = { board: 'dat', loadId: 'L1', originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
    equipment: 'V', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|V', rate: 2000, loadedMiles: 700, deadheadMiles: 20 };
  const deadlock = () => Object.assign(new Error('deadlock detected'), { parent: { code: '40P01' } });

  it('повторяет upsert один раз, если Postgres выбрал его жертвой deadlock', async () => {
    const bulkCreate = jest.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce([]);
    const svc = new LoadsService({ bulkCreate } as any, { query: jest.fn().mockResolvedValue([]) } as any);
    await expect(svc.ingest({ clientId: 'c', items: [item] } as any)).resolves.toEqual({ accepted: 1 });
    expect(bulkCreate).toHaveBeenCalledTimes(2);
  });

  it('после второго deadlock подряд отдаёт ошибку наверх', async () => {
    const bulkCreate = jest.fn().mockRejectedValue(deadlock());
    const svc = new LoadsService({ bulkCreate } as any, { query: jest.fn() } as any);
    await expect(svc.ingest({ clientId: 'c', items: [item] } as any)).rejects.toThrow('deadlock detected');
    expect(bulkCreate).toHaveBeenCalledTimes(2);
  });

  it('другие ошибки БД не повторяет', async () => {
    const bulkCreate = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { parent: { code: '23502' } }));
    const svc = new LoadsService({ bulkCreate } as any, { query: jest.fn() } as any);
    await expect(svc.ingest({ clientId: 'c', items: [item] } as any)).rejects.toThrow('boom');
    expect(bulkCreate).toHaveBeenCalledTimes(1);
  });
});
