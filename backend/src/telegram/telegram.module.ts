import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { AlertSend } from './alert-send.model';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../drivers/pro.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([User, AlertSend]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [TelegramController],
  providers: [TelegramService, JwtAuthGuard, ProGuard],
  exports: [SequelizeModule],
})
export class TelegramModule {}
