import { haversineMiles } from './geo.service';
import type { Seed } from '../common/seed';

export interface NearbyMarket {
  market: string;
  crowMi: number; // приближённые дорожные мили (haversine ×1.2)
}

// Соседние seed-рынки в радиусе (включая сам рынок, crowMi=0).
// Рынок без координат → только он сам (деградация к строгому матчу).
export function nearbyMarkets(
  market: string,
  radiusMi: number,
  seed: Seed,
  maxNeighbors = 12,
): NearbyMarket[] {
  const self = seed.markets[market];
  const out: NearbyMarket[] = [{ market, crowMi: 0 }];
  if (!self) return out;
  for (const m of Object.keys(seed.markets)) {
    if (m === market) continue;
    const mi = Math.round(haversineMiles(self, seed.markets[m]) * 1.2);
    if (mi <= radiusMi) out.push({ market: m, crowMi: mi });
  }
  out.sort((a, b) => a.crowMi - b.crowMi);
  return out.slice(0, maxNeighbors);
}
