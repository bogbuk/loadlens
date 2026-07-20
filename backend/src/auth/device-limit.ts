/* Решение «какие устройства оставить, какие вытеснить» — чистая функция, без БД и Nest.
   Вынесена отдельно, чтобы правило лимита тестировалось без моков и инфраструктуры. */

export const DEVICE_LIMIT = 3;

export type DeviceRow = { clientId: string; lastSeenAt: Date };

// devices — строки из БД БЕЗ учёта текущего входа; текущее устройство функция добавляет сама.
// Вытесняем только у pro (у free просто копим — иначе апгрейд free→pro выкинет со всех машин).
export function decideDevices(
  devices: DeviceRow[],
  clientId: string,
  plan: 'free' | 'pro',
  now: Date,
  limit: number = DEVICE_LIMIT,
): { keep: DeviceRow[]; evict: DeviceRow[] } {
  const others = (devices || []).filter((d) => d.clientId !== clientId);
  const merged: DeviceRow[] = [...others, { clientId, lastSeenAt: now }];

  if (plan !== 'pro' || merged.length <= limit) return { keep: merged, evict: [] };

  // Самые давние — первыми на вылет. Текущее устройство исключено по построению: у него lastSeenAt = now.
  const byAge = [...merged].sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
  const evict = byAge.slice(0, merged.length - limit);
  const evicted = new Set(evict.map((d) => d.clientId));
  return { keep: merged.filter((d) => !evicted.has(d.clientId)), evict };
}
