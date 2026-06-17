import { nearbyMarkets } from './nearby';
import { loadSeed } from '../common/seed';

const SEED = loadSeed();

describe('nearbyMarkets', () => {
  it('включает сам рынок первым с crowMi=0', () => {
    const r = nearbyMarkets('DALLAS_TX', 75, SEED);
    expect(r[0]).toEqual({ market: 'DALLAS_TX', crowMi: 0 });
  });

  it('берёт близкого соседа (Fort Worth ~37mi) и отсекает дальнего (Houston ~270mi)', () => {
    const r = nearbyMarkets('DALLAS_TX', 75, SEED);
    const names = r.map((x) => x.market);
    expect(names).toContain('FORT_WORTH_TX');
    expect(names).not.toContain('HOUSTON_TX');
  });

  it('сортирует по возрастанию crowMi', () => {
    const r = nearbyMarkets('DALLAS_TX', 75, SEED);
    const miles = r.map((x) => x.crowMi);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
  });

  it('неизвестный рынок → только он сам', () => {
    expect(nearbyMarkets('NOWHERE_XX', 75, SEED)).toEqual([{ market: 'NOWHERE_XX', crowMi: 0 }]);
  });

  it('ограничивает общее число записей maxNeighbors (включая сам рынок)', () => {
    const r = nearbyMarkets('DALLAS_TX', 5000, SEED, 3);
    expect(r.length).toBeLessThanOrEqual(3);
  });
});
