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

  // upsert опирается на уникальный индекс (user_id, client_id) — Sequelize строит по нему
  // ON CONFLICT. Если на конкретной версии Sequelize он не подхватит составной индекс и
  // упадёт с ошибкой конфликта, заменить на findOne + create/update (поведение то же).
  private async touch(userId: string, clientId: string): Promise<void> {
    await this.devices.upsert({ userId, clientId, lastSeenAt: new Date() });
  }

  // login / register: регистрируем устройство и подрезаем список до лимита (только для pro).
  async registerOnAuth(user: User, clientId: string | null): Promise<void> {
    if (!clientId) {
      if (user.plan === 'pro') deny('client_id_required');
      return; // free без заголовка (старая сборка расширения) — работает как раньше
    }
    const rows = await this.devices.findAll({ where: { userId: user.id } });
    const current: DeviceRow[] = rows.map((r) => ({ clientId: r.clientId, lastSeenAt: r.lastSeenAt }));
    const { evict } = decideDevices(current, clientId, user.plan, new Date(), DEVICE_LIMIT);

    await this.touch(user.id, clientId);
    if (!evict.length) return;

    await this.devices.destroy({ where: { userId: user.id, clientId: evict.map((d) => d.clientId) } });
    await this.users.increment('deviceEvictions', { by: evict.length, where: { id: user.id } });
  }

  // refresh: у pro устройство обязано быть в таблице; отсутствие строки = его вытеснили.
  async verifyOnRefresh(user: User, clientId: string | null): Promise<void> {
    if (!clientId) {
      if (user.plan === 'pro') deny('client_id_required');
      return;
    }
    if (user.plan === 'pro') {
      const known = await this.devices.findOne({ where: { userId: user.id, clientId } });
      if (!known) deny('device_limit');
    }
    await this.touch(user.id, clientId);
  }
}
