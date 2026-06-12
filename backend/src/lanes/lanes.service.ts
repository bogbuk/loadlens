import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';

export const LANE_MIN = 3;   // минимум грузов на lane для медианы (аналог MODEL_MIN)
const WINDOW_HOURS = 72;     // окно свежести для запроса конкретного lane
const DASH_WINDOW_HOURS = 24 * 7; // окно дашборда (неделя — больше данных для обзора)

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

  // Сводка для дашборда: всего грузов, уникальных lane, рынков, общая медиана RPM (окно недели).
  async overview(): Promise<{ loads: number; lanes: number; markets: number; medianRpm: number | null }> {
    const rows = await this.sequelize.query<any>(
      `SELECT count(*)::int AS loads,
         count(DISTINCT (origin_market || '>' || dest_market || '|' || equipment))::int AS lanes,
         count(DISTINCT origin_market)::int AS markets,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY rpm_cents) AS median
       FROM loads
       WHERE last_seen > now() - interval '${DASH_WINDOW_HOURS} hours'`,
      { type: QueryTypes.SELECT });
    const r = rows[0] || {};
    return { loads: r.loads ?? 0, lanes: r.lanes ?? 0, markets: r.markets ?? 0, medianRpm: centsToRpm(r.median) };
  }

  // Топ lane'ов по объёму грузов за неделю — для таблицы дашборда.
  async topLanes(limit = 50): Promise<Array<{
    originMarket: string; destMarket: string; equipment: string;
    n: number; medianRpm: number | null; p25: number | null; p75: number | null; lastSeen: string;
  }>> {
    const lim = Math.min(Math.max(1, limit), 200);
    const rows = await this.sequelize.query<any>(
      `SELECT origin_market, dest_market, equipment, count(*)::int AS n,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY rpm_cents) AS median,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY rpm_cents) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY rpm_cents) AS p75,
         max(last_seen) AS last_seen
       FROM loads
       WHERE last_seen > now() - interval '${DASH_WINDOW_HOURS} hours'
       GROUP BY origin_market, dest_market, equipment
       ORDER BY n DESC, median DESC NULLS LAST
       LIMIT :lim`,
      { type: QueryTypes.SELECT, replacements: { lim } });
    return rows.map((r) => ({
      originMarket: r.origin_market, destMarket: r.dest_market, equipment: r.equipment,
      n: r.n, medianRpm: centsToRpm(r.median), p25: centsToRpm(r.p25), p75: centsToRpm(r.p75),
      lastSeen: r.last_seen,
    }));
  }
}

function centsToRpm(cents: number | null): number | null {
  return cents == null ? null : Math.round((cents / 100) * 100) / 100; // 2 знака $
}
