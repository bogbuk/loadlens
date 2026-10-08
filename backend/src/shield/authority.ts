// Чистый вывод «лицензии брокера» из ответов FMCSA (спека 2026-10-07-fraud-shield-design).
// Статус — ТОЛЬКО из реестра L&I (6eyk-hxee); история (AuthHist/Motus) — журнал событий, не реестр:
// отсутствие брокерской записи не значит отсутствие лицензии → null, а не флаг.

export type AuthorityStatus = 'active' | 'inactive' | 'carrier_only' | 'not_found';

export interface RegistryRecord {
  brokerAuthorityStatus?: string;
  commonAuthorityStatus?: string;
  contractAuthorityStatus?: string;
}
export interface AuthHistRow {
  mod_col_1?: string;
  original_action_desc?: string;
  orig_served_date?: string;
  disp_action_desc?: string;
  disp_served_date?: string;
}
export interface MotusRow {
  op_auth_type?: string;
  op_auth_status?: string;
  reason?: string;
  status_change_date?: string;
}
export interface AuthorityHistory { grantedAt: string | null; ageDays: number | null; incidents12m: number | null }
export interface Authority extends AuthorityHistory {
  status: AuthorityStatus | null;   // null — реестр недоступен или статус не A/I/N
  checkedAt: string;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 365;
const HIST_BROKER = new Set(['BROKER', 'PROPERTY BROKER']);
const isMotusBroker = (t?: string) => /^Broker of Property/i.test(t || '');
const BAD_ORIG = /REVOCATION|REVOKED|SUSPENSION/i;
const BAD_DISP = /REVOKED|INACTIVATION|SUSPENSION/i;

// null — запись есть, но статус брокерской лицензии не A/I/N (дрейф схемы реестра): молчим, а не флагуем
export function deriveStatus(c: RegistryRecord | null): AuthorityStatus | null {
  if (!c) return 'not_found';
  if (!['A', 'I', 'N'].includes(c.brokerAuthorityStatus || '')) return null;
  if (c.brokerAuthorityStatus === 'A') return 'active';
  if (c.commonAuthorityStatus === 'A' || c.contractAuthorityStatus === 'A') return 'carrier_only';
  return 'inactive';
}

// 'MM/DD/YYYY' (AuthHist) → Date UTC | null
function parseUs(s?: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null;
}
// 'YYYYMMDD' (Motus) → Date UTC | null
function parseYmd(s?: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function deriveHistory(hist: AuthHistRow[], motus: MotusRow[], now: Date): AuthorityHistory {
  const h = hist.filter((r) => HIST_BROKER.has(String(r.mod_col_1 || '').toUpperCase()));
  const m = motus.filter((r) => isMotusBroker(r.op_auth_type));
  if (!h.length && !m.length) return { grantedAt: null, ageDays: null, incidents12m: null };

  const grants: Date[] = [];
  const incidents: Date[] = [];
  for (const r of h) {
    const orig = parseUs(r.orig_served_date);
    const disp = parseUs(r.disp_served_date);
    if (/^GRANTED$/i.test(r.original_action_desc || '') && orig) grants.push(orig);
    if (BAD_ORIG.test(r.original_action_desc || '') && orig) incidents.push(orig);
    const dispText = r.disp_action_desc || '';
    if (BAD_DISP.test(dispText) && !/DISCONTINUED/i.test(dispText) && disp) incidents.push(disp);
  }
  for (const r of m) {
    const d = parseYmd(r.status_change_date);
    if (!d) continue;
    if (/^GRANTED$/i.test(r.reason || '')) grants.push(d);
    else if (!/reinstat/i.test(r.reason || '') &&
      (r.op_auth_status === 'Inactive' || /suspension|revoc/i.test(r.reason || ''))) incidents.push(d);
  }

  const first = grants.length ? new Date(Math.min(...grants.map((d) => d.getTime()))) : null;
  const since = now.getTime() - WINDOW_DAYS * DAY;
  return {
    grantedAt: first ? first.toISOString().slice(0, 10) : null,
    ageDays: first ? Math.floor((now.getTime() - first.getTime()) / DAY) : null,
    incidents12m: incidents.filter((d) => d.getTime() >= since).length,
  };
}
