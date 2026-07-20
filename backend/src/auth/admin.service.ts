import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../users/user.model';
import { LanesService } from '../lanes/lanes.service';

export interface AdminUserView {
  email: string;
  plan: 'free' | 'pro';
  role: 'user' | 'admin';
  blocked: boolean;
  telegramLinked: boolean;
  alertsEnabled: boolean;
  createdAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly lanes: LanesService,
  ) {}

  private view(u: User): AdminUserView {
    return {
      email: u.email,
      plan: u.plan,
      role: u.role,
      blocked: u.blocked,
      telegramLinked: !!u.telegramChatId,
      alertsEnabled: u.alertsEnabled,
      createdAt: (u as any).createdAt,
    };
  }

  async listUsers(q?: string): Promise<AdminUserView[]> {
    const where = q ? { email: { [Op.iLike]: `%${q.trim().toLowerCase()}%` } } : undefined;
    const rows = await this.userModel.findAll({ where, order: [['createdAt', 'DESC']] });
    return rows.map((u) => this.view(u));
  }

  async stats() {
    const [users, proUsers, blockedUsers, overview] = await Promise.all([
      this.userModel.count(),
      this.userModel.count({ where: { plan: 'pro' } }),
      this.userModel.count({ where: { blocked: true } }),
      this.lanes.overview(),
    ]);
    return { users, proUsers, blockedUsers, ...overview };
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
}
