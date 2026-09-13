import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, col, fn } from 'sequelize';
import { User } from '../users/user.model';
import { LanesService } from '../lanes/lanes.service';
import { UserDevice } from './user-device.model';
import { CloudInstance } from '../cloud/cloud-instance.model';
import { CloudService } from '../cloud/cloud.service';

export interface AdminUserView {
  email: string;
  plan: 'free' | 'pro';
  role: 'user' | 'admin';
  blocked: boolean;
  telegramLinked: boolean;
  alertsEnabled: boolean;
  devices: number;
  deviceEvictions: number;
  cloudEnabled: boolean;
  cloudStatus: string | null;
  cloudHeartbeatAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(UserDevice) private readonly devices: typeof UserDevice,
    private readonly lanes: LanesService,
    @InjectModel(CloudInstance) private readonly cloudInstances: typeof CloudInstance,
    private readonly cloud: CloudService,
  ) {}

  private view(u: User, devices = 0, ci?: CloudInstance | null): AdminUserView {
    return {
      email: u.email,
      plan: u.plan,
      role: u.role,
      blocked: u.blocked,
      telegramLinked: !!u.telegramChatId,
      alertsEnabled: u.alertsEnabled,
      devices,
      deviceEvictions: u.deviceEvictions ?? 0,
      cloudEnabled: !!u.cloudEnabled,
      cloudStatus: ci?.status ?? null,
      cloudHeartbeatAt: ci?.lastHeartbeatAt ?? null,
      createdAt: (u as any).createdAt,
    };
  }

  async listUsers(q?: string): Promise<AdminUserView[]> {
    const where = q ? { email: { [Op.iLike]: `%${q.trim().toLowerCase()}%` } } : undefined;
    const rows = await this.userModel.findAll({ where, order: [['createdAt', 'DESC']] });
    // Одним запросом на всю страницу, а не N+1 по пользователям.
    const counts = await this.devices.findAll({
      attributes: ['userId', [fn('COUNT', col('id')), 'n']],
      where: { userId: rows.map((u) => u.id) },
      group: ['user_id'],
      raw: true,
    }) as unknown as Array<{ userId: string; n: string }>;
    const byUser = new Map(counts.map((c) => [c.userId, Number(c.n)]));
    const cis = await this.cloudInstances.findAll({ where: { userId: rows.map((u) => u.id) } });
    const ciByUser = new Map(cis.map((c) => [c.userId, c]));
    return rows.map((u) => this.view(u, byUser.get(u.id) ?? 0, ciByUser.get(u.id) ?? null));
  }

  async stats() {
    const [users, proUsers, blockedUsers, evictions, overview] = await Promise.all([
      this.userModel.count(),
      this.userModel.count({ where: { plan: 'pro' } }),
      this.userModel.count({ where: { blocked: true } }),
      this.userModel.sum('deviceEvictions'),
      this.lanes.overview(),
    ]);
    return { users, proUsers, blockedUsers, evictions: evictions ?? 0, ...overview };
  }

  async setPlan(emailRaw: string, plan: 'free' | 'pro') {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('user not found');
    user.plan = plan;
    await user.save();
    return { email: user.email, plan: user.plan };
  }

  async setBlocked(emailRaw: string, blocked: boolean) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('user not found');
    if (user.role === 'admin') throw new ForbiddenException('cannot block an administrator');
    user.blocked = blocked;
    await user.save();
    return { email: user.email, blocked: user.blocked };
  }

  async setCloudEnabled(emailRaw: string, enabled: boolean) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('user not found');
    // Сначала останавливаем браузер и только потом снимаем флаг: если disableForUser упадёт,
    // запрос вернёт 500, а cloudEnabled останется true — не разойдётся с реально работающим браузером.
    if (!enabled) await this.cloud.disableForUser(user.id);
    user.cloudEnabled = enabled;
    await user.save();
    return { email: user.email, cloudEnabled: user.cloudEnabled };
  }
}
