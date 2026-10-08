import { deriveHistory, deriveStatus } from './authority';

const NOW = new Date('2026-10-07T00:00:00Z');

describe('deriveStatus (QCMobile)', () => {
  it('not_found, когда docket не найден', () => {
    expect(deriveStatus(null)).toBe('not_found');
  });
  it('active при брокерской A', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'A', allowedToOperate: 'Y' })).toBe('active');
  });
  it('inactive при брокерской A, но allowedToOperate=N', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'A', allowedToOperate: 'N' })).toBe('inactive');
  });
  it('carrier_only, когда активна только перевозочная', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'N', commonAuthorityStatus: 'A' })).toBe('carrier_only');
    expect(deriveStatus({ brokerAuthorityStatus: 'I', contractAuthorityStatus: 'A' })).toBe('carrier_only');
  });
  it('нет явного brokerAuthorityStatus (A/I/N) → null, а не флаг', () => {
    expect(deriveStatus({ allowedToOperate: 'Y', commonAuthorityStatus: 'A' })).toBeNull();
    expect(deriveStatus({ brokerAuthorityStatus: 'X' })).toBeNull();
  });
  it('inactive, когда ничего не активно', () => {
    expect(deriveStatus({ brokerAuthorityStatus: 'I', commonAuthorityStatus: 'N' })).toBe('inactive');
  });
});

describe('deriveHistory (AuthHist + Motus)', () => {
  it('нет брокерских записей → всё null (не значит «нет лицензии»)', () => {
    const hist = [{ mod_col_1: 'MOTOR PROPERTY COMMON CARRIER', original_action_desc: 'GRANTED', orig_served_date: '08/10/2001' }];
    expect(deriveHistory(hist, [], NOW)).toEqual({ grantedAt: null, ageDays: null, incidents12m: null });
  });
  it('дата выдачи — самая ранняя брокерская GRANTED из AuthHist', () => {
    const hist = [
      { mod_col_1: 'PROPERTY BROKER', original_action_desc: 'GRANTED', orig_served_date: '07/12/2000' },
      { mod_col_1: 'MOTOR PROPERTY COMMON CARRIER', original_action_desc: 'GRANTED', orig_served_date: '01/01/1999' },
    ];
    const h = deriveHistory(hist, [], NOW);
    expect(h.grantedAt).toBe('2000-07-12');
    expect(h.ageDays).toBe(9583);
    expect(h.incidents12m).toBe(0);
  });
  it('дата выдачи из Motus (YYYYMMDD) для новых брокеров', () => {
    const motus = [{ op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Active', reason: 'GRANTED', status_change_date: '20260515' }];
    const h = deriveHistory([], motus, NOW);
    expect(h.grantedAt).toBe('2026-05-15');
    expect(h.ageDays).toBe(145);
  });
  it('приостановка Motus 2 месяца назад — инцидент', () => {
    const motus = [{ op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Inactive', reason: 'Involuntary Suspension - insurance cancellation effective', status_change_date: '20260802' }];
    expect(deriveHistory([], motus, NOW).incidents12m).toBe(1);
  });
  it('реинстейт Motus — не инцидент', () => {
    const motus = [{ op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Active', reason: 'Reinstated', status_change_date: '20260901' }];
    expect(deriveHistory([], motus, NOW).incidents12m).toBe(0);
  });
  it('отозванный отзыв 2019 года — вне окна 12 мес', () => {
    const hist = [{ mod_col_1: 'BROKER', original_action_desc: 'INVOLUNTARY REVOCATION', orig_served_date: '06/12/2019', disp_action_desc: 'DISCONTINUED REVOCATION', disp_served_date: '06/19/2019' }];
    expect(deriveHistory(hist, [], NOW).incidents12m).toBe(0);
  });
  it('уведомление об отзыве в окне — инцидент; DISCONTINUED-диспозиция инцидент не добавляет', () => {
    const hist = [{ mod_col_1: 'BROKER', original_action_desc: 'INVOLUNTARY REVOCATION', orig_served_date: '03/01/2026', disp_action_desc: 'DISCONTINUED REVOCATION', disp_served_date: '03/20/2026' }];
    expect(deriveHistory(hist, [], NOW).incidents12m).toBe(1);
  });
  it('REVOKED-диспозиция в окне — инцидент', () => {
    const hist = [{ mod_col_1: 'PROPERTY BROKER', original_action_desc: 'GRANTED', orig_served_date: '01/05/2020', disp_action_desc: 'REVOKED', disp_served_date: '04/01/2026' }];
    expect(deriveHistory(hist, [], NOW).incidents12m).toBe(1);
  });
  it('мусорные даты не роняют', () => {
    const hist = [{ mod_col_1: 'BROKER', original_action_desc: 'GRANTED', orig_served_date: 'n/a' }];
    expect(deriveHistory(hist, [], NOW)).toEqual({ grantedAt: null, ageDays: null, incidents12m: 0 });
  });
});
