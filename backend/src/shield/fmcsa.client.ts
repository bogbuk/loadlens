import { Injectable } from '@nestjs/common';
import type { AuthHistRow, MotusRow, RegistryRecord } from './authority';

const SODA = 'https://data.transportation.gov/resource';
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

  // Текущий статус — реестр лицензий L&I «Carrier – All With History» (обновляется ежедневно, без ключа).
  // QCMobile не используем: FMCSA режет mobile.fmcsa.dot.gov для не-US IP (403 из MD и с DE-сервера, 08.10).
  // null — docket нет в реестре (реестр полный: ~25k активных брокеров).
  async registry(mc: string): Promise<RegistryRecord | null> {
    const rows = await getJson(
      `${SODA}/6eyk-hxee.json?docket_number=${docketOf(mc)}&$select=broker_stat,common_stat,contract_stat&$limit=1`);
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return null;
    return {
      brokerAuthorityStatus: r.broker_stat,
      commonAuthorityStatus: r.common_stat,
      contractAuthorityStatus: r.contract_stat,
    };
  }
}
