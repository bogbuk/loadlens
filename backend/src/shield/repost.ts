import { QueryTypes, Sequelize } from 'sequelize';

export const REPOST_WINDOW_DAYS = 14;
export interface RepostStats { count: number; days: number; windowDays: number }

// Перепосты: сколько разных постингов один брокер дал по одному lane+прицепу за окно и сколько
// разных дней они покрывают. broker_mc в loads сырой (MC-555000 / 555000) → сравниваем по цифрам.
// Наружу — только счётчики (без постингов и PII).
export async function repostStats(
  sequelize: Sequelize, mc: string, o: string, d: string, e: string,
): Promise<RepostStats> {
  const rows = await sequelize.query<{ count: number; days: number }>(
    `SELECT count(DISTINCT load_id)::int AS count, count(DISTINCT first_seen::date)::int AS days
       FROM loads
      WHERE regexp_replace(broker_mc, '\\D', '', 'g') = :mc
        AND origin_market = :o AND dest_market = :d AND equipment = :e
        AND first_seen > now() - interval '${REPOST_WINDOW_DAYS} days'`,
    { type: QueryTypes.SELECT, replacements: { mc, o, d, e } },
  );
  const r = rows[0] || { count: 0, days: 0 };
  return { count: Number(r.count) || 0, days: Number(r.days) || 0, windowDays: REPOST_WINDOW_DAYS };
}
