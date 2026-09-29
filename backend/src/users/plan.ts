// Эффективный план и триал Pro (спека docs/superpowers/specs/2026-09-29-pro-trial-design.md).
// Чистые функции без Nest/Sequelize — как auth/device-limit.ts и cloud/cloud-watchdog.ts.
// BIGINT из pg приходит строкой, поэтому все метки времени проходят через num().

export const DAY_MS = 86_400_000;
export const DEFAULT_TRIAL_DAYS = 14;
export const REMIND_BEFORE_MS = 2 * DAY_MS;
// Сообщение об окончании шлём не позже недели после конца: привязал бота через месяц — старую новость не шлём.
export const ENDED_NOTICE_WINDOW_MS = 7 * DAY_MS;

export interface PlanFields {
  plan: 'free' | 'pro';
  proUntil?: number | string | null;
  trialStartedAt?: number | string | null;
  blocked?: boolean;
}

const num = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

// Блокировку не учитывает: её проверяют гарды отдельно.
export function isPro(u: PlanFields, now: number): boolean {
  if (u.plan === 'pro') return true;
  const until = num(u.proUntil);
  return until != null && until > now;
}

export function effectivePlan(u: PlanFields, now: number): 'free' | 'pro' {
  return isPro(u, now) ? 'pro' : 'free';
}

// У постоянного Pro триала «нет»; после окончания дата остаётся — по ней расширение пишет «trial has ended».
export function trialEndsAt(u: PlanFields): number | null {
  if (u.plan === 'pro' || num(u.trialStartedAt) == null) return null;
  return num(u.proUntil);
}

export function trialDays(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_TRIAL_DAYS;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_TRIAL_DAYS;
  return Math.max(0, n);
}

export function grantTrial(
  u: PlanFields, now: number, days: number,
): { proUntil: number; trialStartedAt: number } | null {
  if (days <= 0 || num(u.trialStartedAt) != null || u.plan !== 'free' || u.blocked) return null;
  return { proUntil: now + days * DAY_MS, trialStartedAt: now };
}

export interface NoticeRow extends PlanFields {
  userId: string;
  telegramChatId: string | null;
  trialNotice: number; // 0 — ничего, 1 — напоминание отправлено, 2 — окончание отправлено
}
export type NoticeKind = 'reminder' | 'ended';

export function decideTrialNotices(rows: NoticeRow[], now: number): { userId: string; kind: NoticeKind }[] {
  const out: { userId: string; kind: NoticeKind }[] = [];
  for (const r of rows) {
    const until = num(r.proUntil);
    if (r.plan !== 'free' || num(r.trialStartedAt) == null || !r.telegramChatId || until == null) continue;
    if (until <= now) {
      if (until > now - ENDED_NOTICE_WINDOW_MS && r.trialNotice < 2) out.push({ userId: r.userId, kind: 'ended' });
    } else if (until <= now + REMIND_BEFORE_MS && r.trialNotice < 1) {
      out.push({ userId: r.userId, kind: 'reminder' });
    }
  }
  return out;
}
