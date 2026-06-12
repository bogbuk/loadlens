/* LoadLens — гео/дистанции для расширения. Грузится после vendor/markets.seed.js и api.js.
   distance(from, to): backend-кэш (GET /geo/distance) → офлайн haversine×1.2 по LLSEED → null.
   Кэш в памяти на сессию, чтобы не дёргать backend повторно по той же паре рынков. */
const LLGEO = (() => {
  "use strict";
  const mem = new Map(); // "from>to" -> miles

  function haversineMiles(a, b) {
    const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function offline(from, to) {
    const seed = (globalThis.LLSEED && globalThis.LLSEED.markets) || {};
    const a = seed[from], b = seed[to];
    if (!a || !b) return null;
    return Math.round(haversineMiles(a, b) * 1.2); // поправка дорога/прямая
  }

  // async: возвращает мили (number) или 0, если неизвестно (планировщик трактует как «без deadhead»)
  async function distance(from, to) {
    if (from === to) return 0;
    const key = from + ">" + to;
    if (mem.has(key)) return mem.get(key);
    let miles = null;
    if (typeof LLAPI !== "undefined") {
      const r = await LLAPI.getDistance(from, to);
      if (r && r.roadMiles != null) miles = r.roadMiles;
    }
    if (miles == null) miles = offline(from, to);
    if (miles == null) miles = 0;
    mem.set(key, miles);
    return miles;
  }

  // Синхронный распознаватель для планировщика: предзагружаем нужные пары в mem, потом sync-lookup.
  function sync(from, to) {
    if (from === to) return 0;
    const key = from + ">" + to;
    if (mem.has(key)) return mem.get(key);
    const off = offline(from, to);
    return off == null ? 0 : off;
  }

  // Прогреть кэш дистанций для набора пар (рынок→рынок) перед запуском планировщика.
  async function warm(pairs) {
    await Promise.all(pairs.map(([f, t]) => distance(f, t)));
  }

  return { distance, sync, warm, offline, haversineMiles };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLGEO;
if (typeof globalThis !== "undefined") globalThis.LLGEO = LLGEO;
