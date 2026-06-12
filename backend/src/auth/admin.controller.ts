import { Body, Controller, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { IsIn } from 'class-validator';
import { User } from '../users/user.model';
import { AdminGuard } from './admin.guard';

class SetPlanDto {
  @IsIn(['free', 'pro'])
  plan: 'free' | 'pro';
}

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  @Patch(':email/plan')
  async setPlan(@Param('email') emailRaw: string, @Body() dto: SetPlanDto) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('пользователь не найден');
    user.plan = dto.plan;
    await user.save();
    return { email: user.email, plan: user.plan };
  }
}
