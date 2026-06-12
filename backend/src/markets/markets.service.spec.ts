import { MarketsService, MARKET_MIN } from './markets.service';

function makeService(row: any) {
  const sequelize = { query: jest.fn().mockResolvedValueOnce([row]) } as any;
  return new MarketsService(sequelize);
}

describe('MarketsService.strength', () => {
  it('крауд-оценка, когда out+in >= MARKET_MIN; высокий balance → сильный рынок', async () => {
    // много исходящих, мало входящих → легко выехать
    const res = await makeService({ out_count: 30, in_count: 5, med_cents: 250 })
      .strength('DALLAS_TX');
    expect(res.level).toBe('crowd');
    expect(res.strength).toBeGreaterThan(0.6);
    expect(res.medianRpm).toBe(2.5);
  });

  it('load-trap: много входящих, мало исходящих → слабый рынок', async () => {
    const res = await makeService({ out_count: 3, in_count: 30, med_cents: 120 })
      .strength('MIAMI_FL');
    expect(res.level).toBe('crowd');
    expect(res.strength).toBeLessThan(0.4);
  });

  it('фолбэк на seed, когда крауд-данных мало', async () => {
    const res = await makeService({ out_count: 1, in_count: 1, med_cents: null })
      .strength('ATLANTA_GA');
    expect(res.level).toBe('seed');
    expect(res.strength).toBeGreaterThan(0); // из markets.seed.json
  });

  it('level none для неизвестного рынка без данных', async () => {
    const res = await makeService({ out_count: 0, in_count: 0, med_cents: null })
      .strength('NOWHERE_ZZ');
    expect(res.level).toBe('none');
    expect(res.strength).toBe(0.5);
  });

  it('порог MARKET_MIN переключает crowd/seed', async () => {
    const below = await makeService({ out_count: MARKET_MIN - 1, in_count: 0, med_cents: null })
      .strength('ATLANTA_GA');
    expect(below.level).toBe('seed');
  });
});
