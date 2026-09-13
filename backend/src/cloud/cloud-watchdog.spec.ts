import { decideWatchdog, HEARTBEAT_TIMEOUT_MS, SWEEP_AFTER_MS, WatchdogRow } from './cloud-watchdog';

const now = new Date('2026-09-13T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
// Возвращаемый тип фиксируем явно (WatchdogRow): иначе TS выводит `status: string` из литерала
// и ругается при передаче в decideWatchdog (WatchdogRow.status — union CloudStatus).
const row = (o: Partial<WatchdogRow>): WatchdogRow =>
  ({ id: 'i', status: 'ok', lastHeartbeatAt: ago(60000), lastStateNotified: null, disabledAt: null, ...o });

describe('decideWatchdog', () => {
  it('ok со свежим heartbeat — ничего', () => {
    expect(decideWatchdog([row({})], now)).toEqual([]);
  });
  it('ok без heartbeat дольше 15 мин → restart + notify stale', () => {
    expect(decideWatchdog([row({ lastHeartbeatAt: ago(HEARTBEAT_TIMEOUT_MS + 1) })], now))
      .toEqual([{ type: 'restart', id: 'i' }, { type: 'notify', id: 'i', status: 'stale' }]);
  });
  it('starting без heartbeat — не рестартим (пользователь ещё не залогинился)', () => {
    expect(decideWatchdog([row({ status: 'starting', lastHeartbeatAt: null })], now)).toEqual([]);
  });
  it('logged_out/stale → notify один раз: при lastStateNotified === status молчим', () => {
    expect(decideWatchdog([row({ status: 'logged_out' })], now)).toEqual([{ type: 'notify', id: 'i', status: 'logged_out' }]);
    expect(decideWatchdog([row({ status: 'logged_out', lastStateNotified: 'logged_out' })], now)).toEqual([]);
    expect(decideWatchdog([row({ status: 'stale', lastStateNotified: 'logged_out' })], now)).toEqual([{ type: 'notify', id: 'i', status: 'stale' }]);
  });
  it('stopped старше 30 дней → sweep; моложе — ничего; error — ничего', () => {
    expect(decideWatchdog([row({ status: 'stopped', disabledAt: ago(SWEEP_AFTER_MS + 1) })], now)).toEqual([{ type: 'sweep', id: 'i' }]);
    expect(decideWatchdog([row({ status: 'stopped', disabledAt: ago(1000) })], now)).toEqual([]);
    expect(decideWatchdog([row({ status: 'error' })], now)).toEqual([]);
  });
});
