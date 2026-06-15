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
    const svc = new LoadsService({ findAll } as any);
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
