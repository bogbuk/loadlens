import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { UserDevice } from './user-device.model';
import { DEVICE_LIMIT, DeviceRow, decideDevices } from './device-limit';

// Тексты видит пользователь на экране входа в попапе — только английский.
const MSG_CLIENT_ID = 'Please update the LoadLens extension to continue.';
const MSG_EVICTED = 'Signed out — your account was used on another device. Pro covers up to 3 devices.';

function deny(reason: 'client_id_required' | 'device_limit'): never {
  throw new UnauthorizedException({
    statusCode: 401,
    message: reason === 'client_id_required' ? MSG_CLIENT_ID : MSG_EVICTED,
    reason,
  });
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(UserDevice) private readonly devices: typeof UserDevice,
    @InjectModel(User) private readonly users: typeof User,
  ) {}

  private async touch(userId: string, clientId: string): Promise<void> {
    await this.devices.upsert({ userId, clientId, lastSeenAt: new Date() });
  }

  // Общая подрезка списка устройств до лимита — вызывается и на login/register, и на refresh
  // (у pro refresh-токен скользящий, так что без подрезки здесь лимит обходится: набрал устройства
  // на free, включил pro — и больше никогда не проходит через registerOnAuth). Удаляет и просроченные
  // (expire, молча), и живые сверх лимита (evict, со счётчиком) — единственное место с этой логикой.
  private async trimDevices(user: User, clientId: string, rows: DeviceRow[]): Promise<void> {
    const { evict, expire } = decideDevices(rows, clientId, user.plan, new Date(), DEVICE_LIMIT);

    // Просроченные удаляем молча, отдельным вызовом — они никогда не идут в счётчик,
    // независимо от результата destroy().
    if (expire.length)
      await this.devices.destroy({ where: { userId: user.id, clientId: expire.map((d) => d.clientId) } });

    if (!evict.length) return;
    // Считаем по факту удалённых строк, а не по длине evict: при гонке двух
    // одновременных запросов оба могут решить вытеснить одну и ту же старую
    // строку, но реально удалит её только один — destroy() вернёт 0 у второго.
    const deleted = await this.devices.destroy({
      where: { userId: user.id, clientId: evict.map((d) => d.clientId) },
    });
    if (!deleted) return;
    await this.users.increment('deviceEvictions', { by: deleted, where: { id: user.id } });
  }

  // login / register: регистрируем устройство и подрезаем список до лимита (только для pro).
  async registerOnAuth(user: User, clientId: string | null): Promise<void> {
    // Админ-панель (backend/public/admin.html) ходит на /auth/login и /auth/refresh без
    // заголовка X-Client-Id. Без этого выхода: access-токен админа протухает за 15 минут,
    // refresh получает 401 client_id_required — а обратно пустить некому, потому что
    // /auth/login отвечает тем же 401. Админ-панель — не «устройство продукта», владелец
    // не должен занимать слот собственного лимита. Это НЕ дыра в лимите: обычные пользователи
    // роль admin себе не назначают (см. bootstrap из ADMIN_EMAIL в main.ts / auth.service.ts).
    if (user.role === 'admin') return;
    if (!clientId) {
      if (user.plan === 'pro') deny('client_id_required');
      return; // free без заголовка (старая сборка расширения) — работает как раньше
    }
    const rows = await this.devices.findAll({ where: { userId: user.id } });
    const current: DeviceRow[] = rows.map((r) => ({ clientId: r.clientId, lastSeenAt: r.lastSeenAt }));
    await this.touch(user.id, clientId);
    await this.trimDevices(user, clientId, current);
  }

  // refresh: у pro устройство обязано быть в таблице; отсутствие строки = его вытеснили.
  // Подрезаем список и здесь же (не только на login) — иначе устройства, набранные ещё на free,
  // переживают апгрейд в pro навсегда: скользящий refresh-токен обновляется расширением само,
  // без единого обращения к /auth/login.
  async verifyOnRefresh(user: User, clientId: string | null): Promise<void> {
    if (user.role === 'admin') return; // см. комментарий в registerOnAuth
    if (!clientId) {
      if (user.plan === 'pro') deny('client_id_required');
      return;
    }
    if (user.plan === 'pro') {
      const rows = await this.devices.findAll({ where: { userId: user.id } });
      const known = rows.find((r) => r.clientId === clientId);
      if (!known) deny('device_limit');
      const current: DeviceRow[] = rows.map((r) => ({ clientId: r.clientId, lastSeenAt: r.lastSeenAt }));
      await this.touch(user.id, clientId);
      await this.trimDevices(user, clientId, current);
      return;
    }
    await this.touch(user.id, clientId);
  }
}
