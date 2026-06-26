import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcryptjs';
import { User } from './user.model';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  // Смена своего пароля: нужен текущий пароль (подтверждение владения аккаунтом).
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new UnauthorizedException('пользователь не найден');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash)))
      throw new BadRequestException('неверный текущий пароль');
    if (newPassword === currentPassword)
      throw new BadRequestException('новый пароль совпадает со старым');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    return { ok: true };
  }

  // Hard-delete аккаунта. Водители уходят каскадом (FK drivers.user_id ON DELETE CASCADE).
  // loads/broker_reports привязаны к анонимному clientId, не к userId — остаются обезличенными.
  async deleteMe(userId: string) {
    await this.userModel.destroy({ where: { id: userId } });
    return { ok: true };
  }
}
