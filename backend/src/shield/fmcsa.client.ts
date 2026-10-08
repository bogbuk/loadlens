import { Injectable } from '@nestjs/common';
import type { AuthHistRow, MotusRow, QcCarrier } from './authority';

const SODA = 'https://data.transportation.gov/resource';
const QC = 'https://mobile.fmcsa.dot.gov/qc/services';
const TIMEOUT_MS = 5000;

// docket в SODA: 'MC' + цифры, дополненные нулями до 6 (FF000031, MC384859, MC1819236)
export function docketOf(mc: string): string {
  return 'MC' + String(Number(mc)).padStart(6, '0');
}

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`FMCSA HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

@Injectable()
export class FmcsaClient {
  // AuthHist — история лицензий, заморожена с 05.2026 (даты выдачи старых брокеров)
  async authHist(mc: string): Promise<AuthHistRow[]> {
    const rows = await getJson(`${SODA}/9mw4-x3tu.json?docket_number=${docketOf(mc)}&$limit=200`);
    return Array.isArray(rows) ? rows : [];
  }

  // Motus AuthHist — события после перехода FMCSA на Motus, обновляется ежедневно
  async motus(mc: string): Promise<MotusRow[]> {
    const rows = await getJson(`${SODA}/yu5v-wbh6.json?docket_number=${docketOf(mc)}&$limit=200`);
    return Array.isArray(rows) ? rows : [];
  }

  // Текущий статус. undefined — нет ключа (фича выключена), null — docket не найден.
  async qc(mc: string): Promise<QcCarrier | null | undefined> {
    const key = process.env.FMCSA_WEBKEY;
    if (!key) return undefined;
    const body = await getJson(`${QC}/carriers/docket-number/${Number(mc)}?webKey=${encodeURIComponent(key)}`);
    const first = Array.isArray(body?.content) ? body.content[0] : null;
    return first?.carrier ?? null;
  }
}
