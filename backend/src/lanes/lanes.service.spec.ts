import { LanesService, LANE_MIN } from './lanes.service';

function makeService(agg: any) {
  const sequelize = { query: jest.fn().mockResolvedValueOnce([agg]) } as any;
  return new LanesService(sequelize);
}

describe('LanesService.lane', () => {
  it('возвращает level lane и медиану в $/милю, когда n >= LANE_MIN', async () => {
    const agg = { n: 7, median: 215, p25: 190, p75: 240, min: 150, max: 300 }; // центы
    const res = await makeService(agg).lane('CHICAGO_IL', 'ATLANTA_GA', 'V');
    expect(res.level).toBe('lane');
    expect(res.medianRpm).toBe(2.15);
    expect(res.p75).toBe(2.4);
  });

  it('level none, когда грузов меньше LANE_MIN', async () => {
    const agg = { n: LANE_MIN - 1, median: 200, p25: null, p75: null, min: null, max: null };
    const res = await makeService(agg).lane('DENVER_CO', 'MIAMI_FL');
    expect(res.level).toBe('none');
    expect(res.medianRpm).toBeNull();
  });
});

describe('LanesService.overview', () => {
  it('считает сводку и переводит медиану центов в $/милю', async () => {
    const sequelize = { query: jest.fn().mockResolvedValueOnce([{ loads: 120, lanes: 18, markets: 9, median: 215 }]) } as any;
    const res = await new LanesService(sequelize).overview();
    expect(res).toEqual({ loads: 120, lanes: 18, markets: 9, medianRpm: 2.15 });
  });

  it('нули и null при пустой базе', async () => {
    const sequelize = { query: jest.fn().mockResolvedValueOnce([{ loads: 0, lanes: 0, markets: 0, median: null }]) } as any;
    const res = await new LanesService(sequelize).overview();
    expect(res).toEqual({ loads: 0, lanes: 0, markets: 0, medianRpm: null });
  });
});

describe('LanesService.topLanes', () => {
  it('маппит строки и конвертит RPM, ограничивает limit', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      { origin_market: 'CHICAGO_IL', dest_market: 'ATLANTA_GA', equipment: 'V', n: 7, median: 290, p25: 285, p75: 295, last_seen: '2026-06-12T10:00:00Z' },
    ]);
    const res = await new LanesService({ query } as any).topLanes(999);
    expect(res[0]).toEqual({
      originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA', equipment: 'V',
      n: 7, medianRpm: 2.9, p25: 2.85, p75: 2.95, lastSeen: '2026-06-12T10:00:00Z',
    });
    expect(query.mock.calls[0][1].replacements.lim).toBe(200); // clamp 999 -> 200
  });
});
