import { deriveLevel, normalizeMc, REPORT_MIN } from './brokers.service';

const C = (o: Partial<{ paid: number; no_issue: number; slow: number; flaked: number; double_brokered: number }>) =>
  ({ paid: 0, no_issue: 0, slow: 0, flaked: 0, double_brokered: 0, ...o });

describe('normalizeMc', () => {
  it('вытаскивает цифры MC из разных форматов', () => {
    expect(normalizeMc('MC-555000')).toBe('555000');
    expect(normalizeMc('MC 555000')).toBe('555000');
    expect(normalizeMc('555000')).toBe('555000');
  });
});

describe('deriveLevel', () => {
  it('thin когда отзывов меньше REPORT_MIN', () => {
    expect(deriveLevel(REPORT_MIN - 1, C({ paid: 2 }))).toBe('thin');
  });
  it('good когда почти все платят без проблем', () => {
    expect(deriveLevel(10, C({ paid: 9, no_issue: 1 }))).toBe('good');
  });
  it('bad при двух double-brokered независимо от объёма', () => {
    expect(deriveLevel(10, C({ paid: 8, double_brokered: 2 }))).toBe('bad');
  });
  it('bad когда негатив > 40%', () => {
    expect(deriveLevel(10, C({ paid: 5, flaked: 5 }))).toBe('bad');
  });
  it('mixed между порогами', () => {
    expect(deriveLevel(10, C({ paid: 7, flaked: 2, slow: 1 }))).toBe('mixed');
  });
  it('slow тянет в mixed, а не good', () => {
    expect(deriveLevel(10, C({ paid: 6, slow: 4 }))).toBe('mixed');
  });
});
