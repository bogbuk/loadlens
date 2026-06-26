import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';

// Ставится ПОСЛЕ JwtAuthGuard (тот кладёт req.user.userId). Требует role==='admin'.
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException();
    const user = await this.userModel.findByPk(userId);
    if (!user || user.role !== 'admin') throw new ForbiddenException();
    return true;
  }
}
