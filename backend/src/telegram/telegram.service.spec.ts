import { ForbiddenException } from '@nestjs/common';
import {
  TelegramService, formatAlertMessage, parseStartCommand, DEDUP_TTL_MS, CAP_MAX,
} from './telegram.service';

const ITEM = {
  dedupKey: 'dat|CHICAGO_IL>DALLAS_TX|R|2400|980|123456',
  originMarket: 'CHICAGO_IL', destMarket: 'DALLAS_TX', equipment: 'R',
  rate: 2400, loadedMiles: 980, deadheadMiles: 40, brokerMc: '123456', creditScore: 92,
} as any;

describe('formatAlertMessage', () => {
  it('собирает lane/деньги/RPM/брокера, RPM по loaded+DH', () => {
    const msg = formatAlertMessage(ITEM);
    expect(msg).toContain('🟢 CHICAGO_IL → DALLAS_TX · R');
    expect(msg).toContain('$2,400 · 980mi +40DH');
    expect(msg).toContain('$2.35/mi'); // 2400 / (980+40)
    expect(msg).toContain('Broker MC123456 · credit 92');
  });

  it('без брокера и без DH — короткая форма', () => {
    const msg = formatAlertMessage({ ...ITEM, deadheadMiles: 0, brokerMc: undefined, creditScore: undefined });
    expect(msg).not.toContain('DH');
    expect(msg).not.toContain('Broker');
    expect(msg).toContain('$2.45/mi'); // 2400 / 980
  });

  it('дата пикапа форматируется, контакт брокера выводится', () => {
    const msg = formatAlertMessage({
      ...ITEM, pickupDate: '2026-06-14', contactEmail: 'ops@broker.test', contactPhone: '5551234567',
    });
    expect(msg).toContain('📅 Pickup 14 Jun 2026');
    expect(msg).toContain('✉️ ops@broker.test');
    expect(msg).toContain('📞 5551234567');
  });

  it('без даты/контакта — строки скрыты', () => {
    const msg = formatAlertMessage(ITEM);
    expect(msg).not.toContain('Pickup');
    expect(msg).not.toContain('✉️');
    expect(msg).not.toContain('📞');
  });

  it('имя брокера — перед MC; комментарий — отдельной строкой 💬', () => {
    const msg = formatAlertMessage({
      ...ITEM, brokerName: 'Axle Logistics', comments: 'Lane.Jones@axlelogistics.com // 60.25ft long',
    });
    expect(msg).toContain('Broker Axle Logistics · MC123456 · credit 92');
    expect(msg).toContain('\n💬 Lane.Jones@axlelogistics.com // 60.25ft long');
  });

  it('имя брокера без MC — строка Broker всё равно есть; без comments — 💬 скрыт', () => {
    const msg = formatAlertMessage({ ...ITEM, brokerMc: undefined, creditScore: undefined, brokerName: 'Acme' });
    expect(msg).toContain('Broker Acme');
    expect(msg).not.toContain('MC');
    expect(msg).not.toContain('💬');
  });

  it('ruleName — первой строкой 🎯; без него сообщение начинается с 🟢', () => {
    const withRule = formatAlertMessage({ ...ITEM, ruleName: 'Bonded / TWIC' });
    expect(withRule.startsWith('🎯 Bonded / TWIC\n🟢 CHICAGO_IL → DALLAS_TX · R')).toBe(true);
    expect(formatAlertMessage(ITEM).startsWith('🟢 ')).toBe(true);
  });
});

describe('parseStartCommand', () => {
  it('достаёт токен из /start <token> (в т.ч. с @botname)', () => {
    expect(parseStartCommand('/start abcdef1234567890')).toBe('abcdef1234567890');
    expect(parseStartCommand('/start@LoadLensBot abcdef1234567890')).toBe('abcdef1234567890');
  });
  it('null для голого /start и мусора', () => {
    expect(parseStartCommand('/start')).toBeNull();
    expect(parseStartCommand('привет')).toBeNull();
    expect(parseStartCommand('/start short')).toBeNull(); // < 8 символов
  });
});

// notify: дедуп по TTL + soft-cap. Модели и отправка — заглушки.
function svc(users: any, sends: any, sendImpl?: any) {
  const s = new TelegramService(users as any, sends as any);
  (s as any).send = sendImpl || jest.fn().mockResolvedValue(true);
  return s;
}

describe('TelegramService.notify', () => {
  const OLD = process.env.TELEGRAM_BOT_TOKEN;
  beforeAll(() => { process.env.TELEGRAM_BOT_TOKEN = 'T'; });
  afterAll(() => { process.env.TELEGRAM_BOT_TOKEN = OLD; });

  const linkedUser = { id: 'u1', telegramChatId: '999', alertsEnabled: true };

  it('telegram выключен (нет токена) → reason telegram_disabled', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const s = svc({}, {});
    await expect(s.notify('u1', [ITEM])).resolves.toEqual({ ok: false, sent: 0, reason: 'telegram_disabled' });
    process.env.TELEGRAM_BOT_TOKEN = 'T';
  });

  it('не привязан/выключен → not_linked', async () => {
    const users = { findByPk: jest.fn().mockResolvedValue({ ...linkedUser, alertsEnabled: false }) };
    const s = svc(users, {});
    await expect(s.notify('u1', [ITEM])).resolves.toMatchObject({ ok: false, reason: 'not_linked' });
  });

  it('новый груз → отправка + журналируем', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const sends = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const s = svc({ findByPk: jest.fn().mockResolvedValue(linkedUser) }, sends, send);
    const res = await s.notify('u1', [ITEM]);
    expect(res).toEqual({ ok: true, sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sends.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', dedupKey: ITEM.dedupKey }));
  });

  it('дубль в пределах TTL → пропуск', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const sends = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue({ sentAt: new Date(Date.now() - DEDUP_TTL_MS / 2) }),
      upsert: jest.fn(),
    };
    const s = svc({ findByPk: jest.fn().mockResolvedValue(linkedUser) }, sends, send);
    const res = await s.notify('u1', [ITEM]);
    expect(res).toEqual({ ok: true, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('soft-cap: если окно уже заполнено — ничего не шлём', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const sends = {
      count: jest.fn().mockResolvedValue(CAP_MAX),
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    };
    const s = svc({ findByPk: jest.fn().mockResolvedValue(linkedUser) }, sends, send);
    const res = await s.notify('u1', [ITEM, { ...ITEM, dedupKey: 'k2' }]);
    expect(res).toEqual({ ok: true, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('TelegramService.handleWebhook', () => {
  it('неверный секрет → Forbidden', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'sec';
    const s = svc({}, {});
    await expect(s.handleWebhook('nope', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('/start <token> привязывает chat_id', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'sec';
    process.env.TELEGRAM_BOT_TOKEN = 'T';
    const update = jest.fn().mockResolvedValue([1]);
    const send = jest.fn().mockResolvedValue(true);
    const s = svc({ update }, {}, send);
    await s.handleWebhook('sec', { message: { chat: { id: 555 }, text: '/start abcdef1234567890' } });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ telegramChatId: '555', alertsEnabled: true }),
      { where: { telegramLinkToken: 'abcdef1234567890' } },
    );
    expect(send).toHaveBeenCalled();
  });
});

describe('TelegramService.sendMessageTo', () => {
  class TestTg extends TelegramService {
    sent: Array<{ chatId: string; text: string }> = [];
    protected async send(chatId: string, text: string): Promise<boolean> {
      this.sent.push({ chatId, text });
      return true;
    }
  }

  it('делегирует в protected send и возвращает его результат', async () => {
    const tg = new TestTg({} as any, {} as any);
    const ok = await tg.sendMessageTo('chat-1', 'привет');
    expect(ok).toBe(true);
    expect(tg.sent).toEqual([{ chatId: 'chat-1', text: 'привет' }]);
  });
});
