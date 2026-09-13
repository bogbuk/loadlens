import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';

// Гейт Cloud: users.cloud_enabled (включает админ). Идёт ПОСЛЕ JwtAuthGuard (req.user.userId).
@Injectable()
export class CloudGuard implements CanActivate {
  constructor(@InjectModel(User) private readonly users: typeof User) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    const user = userId ? await this.users.findByPk(userId) : null;
    if (!user || !user.cloudEnabled) throw new ForbiddenException('Cloud browser is not enabled for this account');
    return true;
  }
}
