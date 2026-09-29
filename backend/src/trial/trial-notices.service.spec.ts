import { TrialNoticesService, trialNoticeText } from './trial-notices.service';

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;

function make(rows: any[], send: jest.Mock) {
  const users: any = {
    findAll: jest.fn().mockResolvedValue(rows),
    update: jest.fn().mockResolvedValue([1]),
  };
  const svc = new TrialNoticesService(users, { sendMessageTo: send } as any);
  return { svc, users };
}
const row = (over: any = {}) => ({
  id: 'u1', plan: 'free', trialStartedAt: String(NOW - 13 * DAY), proUntil: String(NOW + DAY),
  telegramChatId: 'c1', trialNotice: 0, ...over,
});

describe('TrialNoticesService.runNotices', () => {
  it('reminder отправлен → trial_notice = 1', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const { svc, users } = make([row()], send);
    await expect(svc.runNotices(NOW)).resolves.toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledWith('c1', trialNoticeText('reminder', NOW + DAY));
    expect(users.update).toHaveBeenCalledWith({ trialNotice: 1 }, { where: { id: 'u1' } });
  });

  it('ended отправлен → trial_notice = 2', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const { svc, users } = make([row({ proUntil: String(NOW - 1000) })], send);
    await svc.runNotices(NOW);
    expect(send).toHaveBeenCalledWith('c1', trialNoticeText('ended', NOW - 1000));
    expect(users.update).toHaveBeenCalledWith({ trialNotice: 2 }, { where: { id: 'u1' } });
  });

  it('бот не настроен (sendMessageTo=false) → trial_notice не растёт', async () => {
    const { svc, users } = make([row()], jest.fn().mockResolvedValue(false));
    await expect(svc.runNotices(NOW)).resolves.toEqual({ sent: 0 });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('отправка бросила → не падаем, trial_notice не растёт', async () => {
    const { svc, users } = make([row()], jest.fn().mockRejectedValue(new Error('net')));
    await expect(svc.runNotices(NOW)).resolves.toEqual({ sent: 0 });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('tick глотает ошибку выборки (cron не должен падать)', async () => {
    const users: any = { findAll: jest.fn().mockRejectedValue(new Error('db down')), update: jest.fn() };
    const svc = new TrialNoticesService(users, { sendMessageTo: jest.fn() } as any);
    await expect(svc.tick()).resolves.toBeUndefined();
  });
});

describe('trialNoticeText', () => {
  it('reminder — дата и hello@krait.studio', () => {
    const t = trialNoticeText('reminder', Date.UTC(2026, 9, 13, 12));
    expect(t).toBe("Your LoadLens Pro trial ends in 2 days (Oct 13). Want to keep Pro? Write to hello@krait.studio and we'll switch your account.");
  });
  it('ended — три вопроса', () => {
    const t = trialNoticeText('ended', NOW);
    expect(t).toContain('Your LoadLens Pro trial has ended. Fleet, alerts and crowd data are now off.');
    expect(t).toContain('1) What was most useful? 2) What was missing? 3) What would you pay per month for Pro?');
  });
});
