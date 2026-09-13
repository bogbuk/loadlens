/* Решение watchdog — чистая функция без БД/Nest (как device-limit.ts): тестируется без моков. */
import { CloudStatus } from './cloud-instance.model';

export const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000;      // ok без heartbeat дольше → restart
export const SWEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;  // stopped дольше → удалить сервис + volume

export type WatchdogRow = {
  id: string; status: CloudStatus; lastHeartbeatAt: Date | null; lastStateNotified: string | null; disabledAt: Date | null;
};
export type WatchdogAction =
  | { type: 'restart'; id: string }
  | { type: 'notify'; id: string; status: 'stale' | 'logged_out' }
  | { type: 'sweep'; id: string };

export function decideWatchdog(rows: WatchdogRow[], now: Date): WatchdogAction[] {
  const out: WatchdogAction[] = [];
  for (const r of rows) {
    if (r.status === 'stopped') {
      if (r.disabledAt && now.getTime() - r.disabledAt.getTime() > SWEEP_AFTER_MS) out.push({ type: 'sweep', id: r.id });
      continue;
    }
    if (r.status === 'ok') {
      if (r.lastHeartbeatAt && now.getTime() - r.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS) {
        out.push({ type: 'restart', id: r.id });
        if (r.lastStateNotified !== 'stale') out.push({ type: 'notify', id: r.id, status: 'stale' });
      }
      continue;
    }
    if ((r.status === 'logged_out' || r.status === 'stale') && r.lastStateNotified !== r.status)
      out.push({ type: 'notify', id: r.id, status: r.status });
    // starting / error — ждём пользователя или следующий Enable
  }
  return out;
}
