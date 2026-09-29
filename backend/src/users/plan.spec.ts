import {
  DAY_MS, decideTrialNotices, effectivePlan, grantTrial, isPro, NoticeRow, trialDays, trialEndsAt,
} from './plan';

const NOW = 1_790_000_000_000;

describe('isPro / effectivePlan', () => {
  it('постоянный Pro — всегда Pro', () => {
    expect(isPro({ plan: 'pro' }, NOW)).toBe(true);
    expect(effectivePlan({ plan: 'pro', proUntil: NOW - DAY_MS }, NOW)).toBe('pro');
  });
  it('Free с активным pro_until — Pro', () => {
    expect(isPro({ plan: 'free', proUntil: NOW + 1 }, NOW)).toBe(true);
  });
  it('pro_until ровно сейчас или в прошлом — Free', () => {
    expect(isPro({ plan: 'free', proUntil: NOW }, NOW)).toBe(false);
    expect(effectivePlan({ plan: 'free', proUntil: NOW - 1 }, NOW)).toBe('free');
  });
  it('pro_until строкой (BIGINT из pg) — сравнивается как число', () => {
    expect(isPro({ plan: 'free', proUntil: String(NOW + DAY_MS) }, NOW)).toBe(true);
    expect(isPro({ plan: 'free', proUntil: String(NOW - DAY_MS) }, NOW)).toBe(false);
  });
  it('без pro_until — Free', () => {
    expect(isPro({ plan: 'free', proUntil: null }, NOW)).toBe(false);
  });
});

describe('trialEndsAt', () => {
  it('триал был — дата окончания числом (и после окончания тоже)', () => {
    expect(trialEndsAt({ plan: 'free', trialStartedAt: NOW - DAY_MS, proUntil: String(NOW + DAY_MS) })).toBe(NOW + DAY_MS);
    expect(trialEndsAt({ plan: 'free', trialStartedAt: NOW - 20 * DAY_MS, proUntil: NOW - 6 * DAY_MS })).toBe(NOW - 6 * DAY_MS);
  });
  it('постоянный Pro — null', () => {
    expect(trialEndsAt({ plan: 'pro', trialStartedAt: NOW, proUntil: NOW + DAY_MS })).toBeNull();
  });
  it('триала не было — null', () => {
    expect(trialEndsAt({ plan: 'free', proUntil: null, trialStartedAt: null })).toBeNull();
  });
});

describe('trialDays', () => {
  it('пусто или мусор → 14', () => {
    expect(trialDays(undefined)).toBe(14);
    expect(trialDays('')).toBe(14);
    expect(trialDays('abc')).toBe(14);
  });
  it('число → число, 0 и отрицательное → 0', () => {
    expect(trialDays('7')).toBe(7);
    expect(trialDays('0')).toBe(0);
    expect(trialDays('-3')).toBe(0);
  });
});

describe('grantTrial', () => {
  it('новый Free → патч на N дней', () => {
    expect(grantTrial({ plan: 'free' }, NOW, 14)).toEqual({ proUntil: NOW + 14 * DAY_MS, trialStartedAt: NOW });
  });
  it('триал уже был (даже если pro_until сброшен) → null', () => {
    expect(grantTrial({ plan: 'free', trialStartedAt: NOW - DAY_MS, proUntil: null }, NOW, 14)).toBeNull();
    expect(grantTrial({ plan: 'free', trialStartedAt: String(NOW - DAY_MS) }, NOW, 14)).toBeNull();
  });
  it('постоянный Pro → null', () => {
    expect(grantTrial({ plan: 'pro' }, NOW, 14)).toBeNull();
  });
  it('заблокирован → null', () => {
    expect(grantTrial({ plan: 'free', blocked: true }, NOW, 14)).toBeNull();
  });
  it('TRIAL_DAYS=0 → null', () => {
    expect(grantTrial({ plan: 'free' }, NOW, 0)).toBeNull();
  });
});

describe('decideTrialNotices', () => {
  const row = (over: Partial<NoticeRow>): NoticeRow => ({
    userId: 'u1', plan: 'free', trialStartedAt: NOW - 13 * DAY_MS, proUntil: NOW + DAY_MS,
    telegramChatId: 'c1', trialNotice: 0, ...over,
  });
  it('до конца ≤ 48ч, ничего не слали → reminder', () => {
    expect(decideTrialNotices([row({})], NOW)).toEqual([{ userId: 'u1', kind: 'reminder' }]);
  });
  it('до конца > 48ч → ничего', () => {
    expect(decideTrialNotices([row({ proUntil: NOW + 3 * DAY_MS })], NOW)).toEqual([]);
  });
  it('напоминание уже было → ничего до окончания', () => {
    expect(decideTrialNotices([row({ trialNotice: 1 })], NOW)).toEqual([]);
  });
  it('закончился, напоминание пропущено → сразу ended', () => {
    expect(decideTrialNotices([row({ proUntil: NOW - 1000, trialNotice: 0 })], NOW)).toEqual([{ userId: 'u1', kind: 'ended' }]);
  });
  it('закончился, ended уже слали → ничего', () => {
    expect(decideTrialNotices([row({ proUntil: NOW - 1000, trialNotice: 2 })], NOW)).toEqual([]);
  });
  it('закончился больше 7 дней назад → ничего', () => {
    expect(decideTrialNotices([row({ proUntil: NOW - 8 * DAY_MS })], NOW)).toEqual([]);
  });
  it('без Telegram, постоянный Pro, без триала или со сброшенным pro_until → ничего', () => {
    expect(decideTrialNotices([
      row({ telegramChatId: null }),
      row({ plan: 'pro' }),
      row({ trialStartedAt: null }),
      row({ proUntil: null }),
    ], NOW)).toEqual([]);
  });
  it('pro_until строкой работает', () => {
    expect(decideTrialNotices([row({ proUntil: String(NOW + DAY_MS) })], NOW)).toEqual([{ userId: 'u1', kind: 'reminder' }]);
  });
});
