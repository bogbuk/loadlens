import { Op } from 'sequelize';
import { buildMarketMatch } from './market-match';

// Extract the ~* pattern and check it behaves like Postgres case-insensitive regex.
function pat(raw: string): string | null {
  const m = buildMarketMatch(raw);
  return m ? (m[Op.iRegexp] as string) : null;
}
const matches = (raw: string, market: string): boolean => {
  const p = pat(raw);
  return p != null && new RegExp(p, 'i').test(market);
};

describe('buildMarketMatch', () => {
  it('empty / whitespace → null', () => {
    expect(buildMarketMatch('')).toBeNull();
    expect(buildMarketMatch('   ')).toBeNull();
    expect(buildMarketMatch(undefined as any)).toBeNull();
  });

  it('2-letter state → trailing-state pattern (uppercased), both formats', () => {
    expect(pat('IL')).toBe('[,_ ]IL$');
    expect(pat('il')).toBe('[,_ ]IL$');
    expect(matches('IL', 'Chicago, IL')).toBe(true);
    expect(matches('IL', 'CHICAGO_IL')).toBe(true);
    expect(matches('IL', 'Atlanta, GA')).toBe(false);
  });

  it('City, ST → anchored city+state, both formats', () => {
    expect(pat('Atlanta, GA')).toBe('^Atlanta[,_ ]+GA$');
    expect(matches('Atlanta, GA', 'Atlanta, GA')).toBe(true);
    expect(matches('Atlanta, GA', 'ATLANTA_GA')).toBe(true);
    expect(matches('atlanta,ga', 'Atlanta, GA')).toBe(true); // case + no space
    expect(matches('Atlanta, GA', 'Atlanta, GX')).toBe(false);
  });

  it('multi-word city uses [ _]+ between words', () => {
    expect(pat('Fort Worth, TX')).toBe('^Fort[ _]+Worth[,_ ]+TX$');
    expect(matches('Fort Worth, TX', 'Fort Worth, TX')).toBe(true);
    expect(matches('Fort Worth, TX', 'FORT_WORTH_TX')).toBe(true);
  });

  it('city only → city-prefix pattern, both formats', () => {
    expect(pat('Atlanta')).toBe('^Atlanta[,_ ]');
    expect(matches('Atlanta', 'Atlanta, GA')).toBe(true);
    expect(matches('Atlanta', 'ATLANTA_GA')).toBe(true);
    expect(matches('Atlanta', 'Atlantic City, NJ')).toBe(false);
  });

  it('escapes regex metacharacters in city (e.g. St. Louis)', () => {
    expect(pat('St. Louis, MO')).toBe('^St\\.[ _]+Louis[,_ ]+MO$');
    expect(matches('St. Louis, MO', 'St. Louis, MO')).toBe(true);
    expect(matches('St. Louis, MO', 'StX Louis, MO')).toBe(false); // '.' not a wildcard
  });
});
