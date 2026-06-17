import { computeLiveness } from './freshness';

const NOW = new Date('2026-06-17T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('computeLiveness', () => {
  it('свежий груз → liveness ~1, не gone', () => {
    const r = computeLiveness({ firstSeen: minsAgo(2), lastSeen: minsAgo(1), seenCount: 1 }, NOW);
    expect(r.liveness).toBeGreaterThan(0.98);
    expect(r.likelyGone).toBe(false);
  });

  it('старый груз (70ч) → liveness ~0, но не gone при малом seenCount', () => {
    const r = computeLiveness({ firstSeen: minsAgo(70 * 60), lastSeen: minsAgo(70 * 60), seenCount: 1 }, NOW);
    expect(r.liveness).toBeLessThan(0.05);
    expect(r.likelyGone).toBe(false);
  });

  it('часто виденный, затем пропал → likelyGone', () => {
    // seenCount 10, span 90мин ⇒ cadence ~10мин; не виден 60мин > 4×10 ⇒ gone
    const r = computeLiveness({ firstSeen: minsAgo(150), lastSeen: minsAgo(60), seenCount: 10 }, NOW);
    expect(r.likelyGone).toBe(true);
  });

  it('часто виденный и недавно → не gone', () => {
    const r = computeLiveness({ firstSeen: minsAgo(150), lastSeen: minsAgo(2), seenCount: 10 }, NOW);
    expect(r.likelyGone).toBe(false);
  });

  it('span=0 при seenCount >= MIN_OBS → не gone (cadence=0, guard)', () => {
    const r = computeLiveness({ firstSeen: minsAgo(30), lastSeen: minsAgo(30), seenCount: 5 }, NOW);
    expect(r.likelyGone).toBe(false);
  });

  it('seenCount null → как одно наблюдение, не gone', () => {
    const r = computeLiveness({ firstSeen: minsAgo(30), lastSeen: minsAgo(30), seenCount: null }, NOW);
    expect(r.likelyGone).toBe(false);
  });
});
