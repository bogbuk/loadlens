import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcryptjs';
import { User } from './user.model';
import { CloudService } from '../cloud/cloud.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly cloud: CloudService,
  ) {}

  // Смена своего пароля: нужен текущий пароль (подтверждение владения аккаунтом).
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new UnauthorizedException('user not found');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash)))
      throw new BadRequestException('current password is incorrect');
    if (newPassword === currentPassword)
      throw new BadRequestException('new password matches the old one');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1; // инвалидируем все сессии (включая текущую)
    await user.save();
    return { ok: true };
  }

  // Hard-delete аккаунта. Водители уходят каскадом (FK drivers.user_id ON DELETE CASCADE).
  // loads/broker_reports привязаны к анонимному clientId, не к userId — остаются обезличенными.
  // Облачный браузер сносим ДО удаления юзера: строка cloud_instances уйдёт каскадом, и висящий
  // контейнер с живой сессией DAT уже никто не найдёт (спека §7).
  async deleteMe(userId: string) {
    await this.cloud.purgeForUser(userId);
    await this.userModel.destroy({ where: { id: userId } });
    return { ok: true };
  }
}
