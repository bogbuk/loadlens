import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { LaneDistance } from './lane-distance.model';
import { loadSeed } from '../common/seed';
const SEED = loadSeed();

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';

export interface DistanceResult {
  fromMarket: string;
  toMarket: string;
  roadMiles: number | null;
  source: 'cache' | 'osrm' | 'haversine' | 'none';
}

@Injectable()
export class GeoService {
  constructor(@InjectModel(LaneDistance) private readonly model: typeof LaneDistance) {}

  async distance(from: string, to: string): Promise<DistanceResult> {
    if (from === to) return { fromMarket: from, toMarket: to, roadMiles: 0, source: 'cache' };

    const cached = await this.model.findOne({ where: { fromMarket: from, toMarket: to } });
    if (cached) return { fromMarket: from, toMarket: to, roadMiles: cached.roadMiles, source: 'cache' };

    const a = SEED.markets[from];
    const b = SEED.markets[to];
    if (!a || !b) return { fromMarket: from, toMarket: to, roadMiles: null, source: 'none' };

    // OSRM по центроидам; при сбое — haversine×1.2.
    let miles = await osrmMiles(a, b);
    let source: 'osrm' | 'haversine' = 'osrm';
    if (miles == null) { miles = haversineMiles(a, b) * 1.2; source = 'haversine'; }
    miles = Math.round(miles);

    // кэшируем (idempotent upsert)
    await this.model.bulkCreate(
      [{ fromMarket: from, toMarket: to, roadMiles: miles, source, ts: new Date() }],
      { updateOnDuplicate: ['roadMiles', 'source', 'ts'] },
    ).catch(() => {});

    return { fromMarket: from, toMarket: to, roadMiles: miles, source };
  }
}

async function osrmMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<number | null> {
  try {
    const url = `${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let res: Response;
    try { res = await fetch(url, { signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    if (!res!.ok) return null;
    const data: any = await res.json();
    const meters = data?.routes?.[0]?.distance;
    if (typeof meters !== 'number') return null;
    return meters / 1609.34;
  } catch { return null; }
}

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8; // мили
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function rad(d: number): number { return (d * Math.PI) / 180; }
