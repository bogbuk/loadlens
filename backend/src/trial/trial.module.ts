import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { TelegramModule } from '../telegram/telegram.module';
import { TrialNoticesService } from './trial-notices.service';

@Module({
  imports: [SequelizeModule.forFeature([User]), TelegramModule],
  providers: [TrialNoticesService],
})
export class TrialModule {}
