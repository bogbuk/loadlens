import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { loadSeed } from '../common/seed';
const SEED = loadSeed();

export const MARKET_MIN = 8;   // минимум грузов (out+in) для крауд-оценки, иначе seed
const WINDOW_HOURS = 72;

export interface MarketStrength {
  market: string;
  level: 'crowd' | 'seed' | 'none';
  strength: number;        // 0..1
  outCount: number;
  inCount: number;
  medianRpm: number | null;
}

@Injectable()
export class MarketsService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async strength(market: string): Promise<MarketStrength> {
    const rows = await this.sequelize.query<any>(
      `SELECT
         (SELECT count(*)::int FROM loads
            WHERE origin_market = :m AND last_seen > now() - interval '${WINDOW_HOURS} hours') AS out_count,
         (SELECT count(*)::int FROM loads
            WHERE dest_market = :m AND last_seen > now() - interval '${WINDOW_HOURS} hours') AS in_count,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rpm_cents) FROM loads
            WHERE origin_market = :m AND rpm_cents IS NOT NULL
              AND last_seen > now() - interval '${WINDOW_HOURS} hours') AS med_cents`,
      { type: QueryTypes.SELECT, replacements: { m: market } });
    const r = rows[0] || {};
    const outCount = r.out_count ?? 0;
    const inCount = r.in_count ?? 0;
    const medCents = r.med_cents ?? null;

    if (outCount + inCount >= MARKET_MIN) {
      const balance = outCount / (outCount + inCount + 1e-6);   // >0.5 ⇒ сильный (легко выехать)
      const normRpm = medCents != null ? clamp01((medCents / 100 - 1.5) / 1.5) : 0.5; // ~$1.5..$3
      const strength = clamp01(0.6 * balance + 0.4 * normRpm);
      return {
        market, level: 'crowd', strength,
        outCount, inCount,
        medianRpm: medCents != null ? Math.round(medCents) / 100 : null,
      };
    }

    // cold-start: seed-таблица крупных рынков
    const seed = SEED.markets[market];
    if (seed) return { market, level: 'seed', strength: seed.strength, outCount, inCount, medianRpm: null };
    return { market, level: 'none', strength: 0.5, outCount, inCount, medianRpm: null };
  }
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
