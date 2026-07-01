import { Op } from 'sequelize';

// POSIX ERE metacharacters to escape in literal city/state text.
const RE_META = /[.^$*+?()[\]{}|\\]/g;
const escapeRe = (s: string): string => s.replace(RE_META, '\\$&');

// City fragment: escape metachars FIRST (spaces are not metachars so they survive), THEN turn
// whitespace runs into `[ _]+`. Order matters: substituting first would let escapeRe mangle the
// injected `[ _]+` into `\[ _\]\+`. This lets a multi-word city match both "Fort Worth" and "FORT_WORTH".
const cityPat = (city: string): string => escapeRe(city.trim()).replace(/\s+/g, '[ _]+');

/**
 * Resolve a free-text market query to a Sequelize case-insensitive regex clause
 * (`Op.iRegexp` → Postgres `~*`). Tolerates both stored formats: "City, ST" and "CITY_ST".
 * Returns null for empty input (caller omits the filter).
 */
export function buildMarketMatch(raw: string): Record<symbol, string> | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // 2-letter token → state search: trailing state after any separator.
  if (/^[A-Za-z]{2}$/.test(s)) {
    return { [Op.iRegexp]: `[,_ ]${s.toUpperCase()}$` };
  }

  // "City, ST" → anchored city + state.
  const comma = s.indexOf(',');
  if (comma >= 0) {
    const city = s.slice(0, comma);
    const state = s.slice(comma + 1).trim();
    return { [Op.iRegexp]: `^${cityPat(city)}[,_ ]+${escapeRe(state)}$` };
  }

  // City only → prefix on the city part.
  return { [Op.iRegexp]: `^${cityPat(s)}[,_ ]` };
}
