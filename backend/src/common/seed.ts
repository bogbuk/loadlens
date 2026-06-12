/* Загрузка markets.seed.json устойчиво к расположению.
   Источник правды — /shared/markets.seed.json (общий с расширением и тестами).
   В Docker-образе (base dir /backend) shared/ копируется внутрь backend/shared (см. Dockerfile),
   поэтому пробуем несколько путей. */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface SeedMarket { lat: number; lng: number; strength: number }
export interface Seed { markets: Record<string, SeedMarket> }

let cached: Seed | null = null;

export function loadSeed(): Seed {
  if (cached) return cached;
  const candidates = [
    join(__dirname, '..', '..', 'shared', 'markets.seed.json'),        // backend/shared (Docker)
    join(__dirname, '..', '..', '..', 'shared', 'markets.seed.json'),  // repo root (dev, dist+src)
    join(process.cwd(), 'shared', 'markets.seed.json'),
    join(process.cwd(), '..', 'shared', 'markets.seed.json'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) { cached = JSON.parse(readFileSync(p, 'utf8')); return cached!; }
    } catch { /* пробуем следующий */ }
  }
  cached = { markets: {} }; // безопасный дефолт — strength упадёт на 'none'
  return cached;
}
