/* Решение «какие устройства оставить, какие вытеснить» — чистая функция, без БД и Nest.
   Вынесена отдельно, чтобы правило лимита тестировалось без моков и инфраструктуры. */

export const DEVICE_LIMIT = 3;

// Устройство, не появлявшееся дольше этого срока, считаем мёртвым (переустановка расширения,
// новый ноутбук, очистка chrome.storage — clientId не переживает ни одно из этого). Мёртвая
// строка освобождает слот молча: удаляется, но НЕ считается вытеснением честного пользователя.
export const STALE_DAYS = 30;

export type DeviceRow = { clientId: string; lastSeenAt: Date };

// devices — строки из БД БЕЗ учёта текущего входа; текущее устройство функция добавляет сама.
// Вытесняем только у pro (у free просто копим — иначе апгрейд free→pro выкинет со всех машин).
// expire — просроченные (STALE_DAYS) строки: удалить молча, счётчик не трогать.
// evict — живые строки, вытесненные из-за переполнения лимита: удалить и посчитать.
export function decideDevices(
  devices: DeviceRow[],
  clientId: string,
  plan: 'free' | 'pro',
  now: Date,
  limit: number = DEVICE_LIMIT,
): { keep: DeviceRow[]; evict: DeviceRow[]; expire: DeviceRow[] } {
  const others = (devices || []).filter((d) => d.clientId !== clientId);

  // Просроченные отсеиваем ещё до сборки merged — текущее устройство (lastSeenAt = now) под
  // просрочку попасть не может, так что фильтр применяем только к "чужим" строкам.
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  const expire = others.filter((d) => now.getTime() - d.lastSeenAt.getTime() > staleMs);
  const expiredIds = new Set(expire.map((d) => d.clientId));
  const fresh = others.filter((d) => !expiredIds.has(d.clientId));

  const merged: DeviceRow[] = [...fresh, { clientId, lastSeenAt: now }];

  if (plan !== 'pro' || merged.length <= limit) return { keep: merged, evict: [], expire };

  // Самые давние — первыми на вылет. Текущее устройство исключено по построению: у него lastSeenAt = now.
  const byAge = [...merged].sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
  const evict = byAge.slice(0, merged.length - limit);
  const evicted = new Set(evict.map((d) => d.clientId));
  return { keep: merged.filter((d) => !evicted.has(d.clientId)), evict, expire };
}
