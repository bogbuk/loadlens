import { Injectable } from '@nestjs/common';

// Национальная средняя цена дизеля ($/галлон) для расчёта топлива в скоринге/планировщике.
// Источник — EIA (бесплатный, требует ключ EIA_API_KEY); при сбое/без ключа — фолбэк-константа.
export const FALLBACK_DIESEL = 3.95; // $/галлон, нац. среднее (обновлять при заметном сдвиге рынка)
const TTL_MS = 12 * 60 * 60 * 1000;
// EIA v2: недельная розничная цена дизеля №2 (US, all types), серия EMD_EPD2D_PTE_NUS_DPG
const SERIES = 'EMD_EPD2D_PTE_NUS_DPG';

export interface DieselResult {
  dieselPrice: number; // $/галлон
  fetchedAt: string;
  stale: boolean;
}

@Injectable()
export class RatesService {
  private cache: DieselResult | null = null;
  private cachedAtMs = 0;

  async getRates(): Promise<DieselResult> {
    const now = Date.now();
    if (this.cache && now - this.cachedAtMs < TTL_MS) return this.cache;
    const fresh = await this.fetchDiesel();
    if (!fresh.stale) { this.cache = fresh; this.cachedAtMs = now; }
    return fresh;
  }

  private async fetchDiesel(): Promise<DieselResult> {
    const key = process.env.EIA_API_KEY;
    if (!key) return { dieselPrice: FALLBACK_DIESEL, fetchedAt: new Date().toISOString(), stale: true };
    try {
      const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${key}` +
        `&frequency=weekly&data[0]=value&facets[series][]=${SERIES}` +
        `&sort[0][column]=period&sort[0][direction]=desc&length=1`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      let res: Response;
      try { res = await fetch(url, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!res!.ok) throw new Error(`HTTP ${res!.status}`);
      const data: any = await res.json();
      const val = data?.response?.data?.[0]?.value;
      if (typeof val !== 'number' || val <= 0) throw new Error('bad payload');
      return { dieselPrice: Math.round(val * 100) / 100, fetchedAt: new Date().toISOString(), stale: false };
    } catch {
      return { dieselPrice: FALLBACK_DIESEL, fetchedAt: new Date().toISOString(), stale: true };
    }
  }
}
