import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cron } from '@nestjs/schedule';
import { Op } from 'sequelize';
import { User } from '../users/user.model';
import { TelegramService } from '../telegram/telegram.service';
import { decideTrialNotices, ENDED_NOTICE_WINDOW_MS, NoticeKind, REMIND_BEFORE_MS } from '../users/plan';

export function trialNoticeText(kind: NoticeKind, proUntil: number): string {
  if (kind === 'reminder') {
    const date = new Date(proUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `Your LoadLens Pro trial ends in 2 days (${date}). Want to keep Pro? Write to hello@krait.studio and we'll switch your account.`;
  }
  return 'Your LoadLens Pro trial has ended. Fleet, alerts and crowd data are now off.\n\n' +
    'Help us make LoadLens better, reply to hello@krait.studio: 1) What was most useful? ' +
    '2) What was missing? 3) What would you pay per month for Pro?';
}

// Сообщения о триале (спека §6). Кому и что — чистая decideTrialNotices; здесь только выборка и отправка.
// trial_notice поднимаем только при успешной отправке — иначе повтор через час.
@Injectable()
export class TrialNoticesService {
  private readonly log = new Logger(TrialNoticesService.name);

  constructor(
    @InjectModel(User) private readonly users: typeof User,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('0 * * * *')
  async tick(): Promise<void> {
    try { await this.runNotices(); }
    catch (e) { this.log.error(`trial notices failed: ${(e as Error).message}`); }
  }

  async runNotices(now = Date.now()): Promise<{ sent: number }> {
    const rows = await this.users.findAll({
      where: {
        plan: 'free',
        trialStartedAt: { [Op.ne]: null },
        telegramChatId: { [Op.ne]: null },
        trialNotice: { [Op.lt]: 2 },
        proUntil: { [Op.gt]: now - ENDED_NOTICE_WINDOW_MS, [Op.lte]: now + REMIND_BEFORE_MS },
      },
    });
    const byId = new Map(rows.map((u) => [u.id, u]));
    const decisions = decideTrialNotices(rows.map((u) => ({
      userId: u.id, plan: u.plan, proUntil: u.proUntil, trialStartedAt: u.trialStartedAt,
      telegramChatId: u.telegramChatId, trialNotice: u.trialNotice,
    })), now);
    let sent = 0;
    for (const d of decisions) {
      const u = byId.get(d.userId)!;
      const ok = await this.telegram
        .sendMessageTo(u.telegramChatId!, trialNoticeText(d.kind, Number(u.proUntil)))
        .catch(() => false);
      if (!ok) continue;
      await this.users.update({ trialNotice: d.kind === 'ended' ? 2 : 1 }, { where: { id: u.id } });
      sent++;
    }
    return { sent };
  }
}
