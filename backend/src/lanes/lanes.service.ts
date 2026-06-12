import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';

export const LANE_MIN = 3;   // минимум грузов на lane для медианы (аналог MODEL_MIN)
const WINDOW_HOURS = 72;     // окно свежести

export interface LaneStats {
  level: 'lane' | 'none';
  n: number;
  medianRpm: number | null; // $/миля
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

// агрегат по rpm_cents (центы/милю) → возвращаем в $/миля
const AGG = `
  SELECT count(*)::int AS n,
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY rpm_cents) AS median,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY rpm_cents) AS p25,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY rpm_cents) AS p75,
    min(rpm_cents) AS min, max(rpm_cents) AS max
  FROM loads
  WHERE rpm_cents IS NOT NULL
    AND last_seen > now() - interval '${WINDOW_HOURS} hours'`;

@Injectable()
export class LanesService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async lane(origin: string, dest: string, equipment?: string): Promise<LaneStats> {
    let where = ' AND origin_market = :origin AND dest_market = :dest';
    const repl: Record<string, unknown> = { origin, dest };
    if (equipment) { where += ' AND equipment = :equipment'; repl.equipment = equipment; }
    const rows = await this.sequelize.query<any>(`${AGG}${where}`,
      { type: QueryTypes.SELECT, replacements: repl });
    const r = rows[0];
    if (!r || r.n < LANE_MIN) return { level: 'none', n: r?.n ?? 0, medianRpm: null, p25: null, p75: null, min: null, max: null };
    return {
      level: 'lane',
      n: r.n,
      medianRpm: centsToRpm(r.median),
      p25: centsToRpm(r.p25),
      p75: centsToRpm(r.p75),
      min: centsToRpm(r.min),
      max: centsToRpm(r.max),
    };
  }
}

function centsToRpm(cents: number | null): number | null {
  return cents == null ? null : Math.round((cents / 100) * 100) / 100; // 2 знака $
}
