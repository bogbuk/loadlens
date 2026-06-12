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
