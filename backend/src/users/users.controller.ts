import { Controller, Delete, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from './user.model';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(@InjectModel(User) private readonly users: typeof User) {}

  // Hard-delete аккаунта. Водители уходят каскадом (FK drivers.user_id ON DELETE CASCADE).
  // loads/broker_reports привязаны к анонимному clientId, не к userId — остаются как обезличенные.
  @Delete('me')
  async deleteMe(@Req() req: { user: { userId: string } }) {
    await this.users.destroy({ where: { id: req.user.userId } });
    return { ok: true };
  }
}
