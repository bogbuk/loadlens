import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { User } from '../users/user.model';
import { AlertSend } from './alert-send.model';
import { NotifyItemDto } from './dto/notify.dto';

export const DEDUP_TTL_MS = 6 * 60 * 60 * 1000; // один и тот же груз не шлём чаще, чем раз в 6ч
export const CAP_WINDOW_MS = 10 * 60 * 1000;    // окно soft-cap
export const CAP_MAX = 10;                       // не более N алертов за окно (защита от всплеска)

const TG_API = 'https://api.telegram.org';

// «$2,400» — деньги с разделителем тысяч, без копеек.
function money(n: number): string {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

// «2026-06-14» → «14 Jun 2026». Невалидную/непарсимую дату отдаём как есть.
function fmtPickup(raw?: string): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[Number(m[2]) - 1] || m[2];
  return `${Number(m[3])} ${mon} ${m[1]}`;
}

// Текст алерта. Бизнес-поля груза + дата пикапа, контакт брокера и комментарий (PII — по явному решению).
export function formatAlertMessage(l: NotifyItemDto): string {
  const total = (Number(l.loadedMiles) || 0) + (Number(l.deadheadMiles) || 0);
  const rpm = total > 0 ? (Number(l.rate) / total).toFixed(2) : '—';
  const dh = Number(l.deadheadMiles) || 0;
  const ruleLine = l.ruleName ? `🎯 ${l.ruleName}\n` : '';
  const head = `${ruleLine}🟢 ${l.originMarket} → ${l.destMarket} · ${l.equipment}`;
  const line2 = `${money(l.rate)} · ${Math.round(Number(l.loadedMiles) || 0)}mi` +
    (dh ? ` +${Math.round(dh)}DH` : '') + ` · $${rpm}/mi`;
  const pickup = fmtPickup(l.pickupDate);
  const dateLine = pickup ? `\n📅 Pickup ${pickup}` : '';
  const brokerBits = [
    l.brokerName || '',
    l.brokerMc ? `MC${l.brokerMc}` : '',
    l.creditScore != null ? `credit ${l.creditScore}` : '',
  ].filter(Boolean);
  // credit сам по себе (без имени/MC) не показываем — не к чему привязать
  const broker = (l.brokerName || l.brokerMc) ? `\nBroker ${brokerBits.join(' · ')}` : '';
  const commentsLine = l.comments ? `\n💬 ${l.comments}` : '';
  const contactBits = [
    l.contactEmail ? `✉️ ${l.contactEmail}` : '',
    l.contactPhone ? `📞 ${l.contactPhone}` : '',
  ].filter(Boolean);
  const contact = contactBits.length ? `\n${contactBits.join(' · ')}` : '';
  return `${head}${dateLine}\n${line2}${broker}${commentsLine}${contact}`;
}

// Разбор '/start <token>' из вебхука Telegram. Возвращает токен привязки или null.
export function parseStartCommand(text: string): string | null {
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/.exec(String(text || ''));
  return m ? m[1] : null;
}

export interface NotifyResult { ok: boolean; sent: number; reason?: string }

@Injectable()
export class TelegramService {
  constructor(
    @InjectModel(User) private readonly users: typeof User,
    @InjectModel(AlertSend) private readonly sends: typeof AlertSend,
  ) {}

  private get token(): string | null { return process.env.TELEGRAM_BOT_TOKEN || null; }
  private get botUsername(): string | null { return process.env.TELEGRAM_BOT_USERNAME || null; }

  // Генерит одноразовый токен привязки и deep-link t.me/<bot>?start=<token>.
  async link(userId: string): Promise<{ url: string | null; token: string; configured: boolean }> {
    const token = randomUUID().replace(/-/g, '');
    await this.users.update({ telegramLinkToken: token }, { where: { id: userId } });
    const deepLink = this.botUsername ? `https://t.me/${this.botUsername}?start=${token}` : null;
    return { url: deepLink, token, configured: !!this.token && !!this.botUsername };
  }

  async status(userId: string): Promise<{ linked: boolean; enabled: boolean; configured: boolean }> {
    const u = await this.users.findByPk(userId);
    return {
      linked: !!(u && u.telegramChatId),
      enabled: !!(u && u.alertsEnabled),
      configured: !!this.token && !!this.botUsername,
    };
  }

  async setAlerts(userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    await this.users.update({ alertsEnabled: enabled }, { where: { id: userId } });
    return { enabled };
  }

  async unlink(userId: string): Promise<{ ok: true }> {
    await this.users.update(
      { telegramChatId: null, telegramLinkToken: null, alertsEnabled: false },
      { where: { id: userId } },
    );
    return { ok: true };
  }

  // Релей подошедших грузов от расширения → Telegram. Дедуп по ключу+TTL, soft-cap на окно.
  async notify(userId: string, items: NotifyItemDto[]): Promise<NotifyResult> {
    if (!this.token) return { ok: false, sent: 0, reason: 'telegram_disabled' };
    const u = await this.users.findByPk(userId);
    if (!u || !u.telegramChatId || !u.alertsEnabled)
      return { ok: false, sent: 0, reason: 'not_linked' };

    const now = Date.now();
    const recent = await this.sends.count({
      where: { userId, sentAt: { [Op.gt]: new Date(now - CAP_WINDOW_MS) } },
    });
    let budget = CAP_MAX - recent;
    let sent = 0;

    for (const item of items || []) {
      if (budget <= 0) break;
      const existing = await this.sends.findOne({ where: { userId, dedupKey: item.dedupKey } });
      if (existing && now - existing.sentAt.getTime() < DEDUP_TTL_MS) continue;
      const okSend = await this.send(u.telegramChatId, formatAlertMessage(item));
      if (!okSend) continue;
      await this.sends.upsert({ userId, dedupKey: item.dedupKey, sentAt: new Date(now) });
      sent++; budget--;
    }
    return { ok: true, sent };
  }

  // Вебхук Telegram: при /start <token> привязываем chat_id к аккаунту и подтверждаем в чат.
  async handleWebhook(secret: string, body: any): Promise<{ ok: true }> {
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET)
      throw new ForbiddenException('bad secret');
    const msg = body?.message;
    const chatId = msg?.chat?.id;
    const token = parseStartCommand(msg?.text || '');
    if (chatId && token) {
      const [n] = await this.users.update(
        { telegramChatId: String(chatId), telegramLinkToken: null, alertsEnabled: true },
        { where: { telegramLinkToken: token } },
      );
      if (this.token) {
        await this.send(
          String(chatId),
          n ? "✅ LoadLens is linked. I'll send you profitable loads matching your filter."
            : '⚠️ This link has expired. Open "Connect Telegram" in the extension again.',
        );
      }
    }
    return { ok: true };
  }

  // Публичная обёртка над низкоуровневой отправкой (для DM из других сервисов, напр. код сброса пароля).
  async sendMessageTo(chatId: string, text: string): Promise<boolean> {
    return this.send(chatId, text);
  }

  // Низкоуровневая отправка в Telegram. true при успехе. Изолирована для подмены в тестах.
  protected async send(chatId: string, text: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await fetch(`${TG_API}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
