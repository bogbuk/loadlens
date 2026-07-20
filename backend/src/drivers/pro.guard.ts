import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';

// Гейт парка: только plan==='pro'. Идёт ПОСЛЕ JwtAuthGuard (тот кладёт req.user.userId).
@Injectable()
export class ProGuard implements CanActivate {
  constructor(@InjectModel(User) private readonly users: typeof User) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    const user = userId ? await this.users.findByPk(userId) : null;
    if (!user || user.plan !== 'pro') throw new ForbiddenException('Fleet is a Pro feature');
    return true;
  }
}
