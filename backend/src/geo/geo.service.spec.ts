import { haversineMiles } from './geo.service';

describe('haversineMiles', () => {
  it('Chicago → Atlanta ≈ 590 миль по прямой', () => {
    const chi = { lat: 41.878, lng: -87.630 };
    const atl = { lat: 33.749, lng: -84.388 };
    const d = haversineMiles(chi, atl);
    expect(d).toBeGreaterThan(560);
    expect(d).toBeLessThan(620);
  });

  it('ноль для одинаковых точек', () => {
    const p = { lat: 40, lng: -90 };
    expect(haversineMiles(p, p)).toBeCloseTo(0, 5);
  });
});
