import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaddleClient } from './paddle.client';

// Не импортирует UsersModule: UsersModule сам импортирует этот модуль (отмена подписки при удалении).
@Module({
  imports: [
    SequelizeModule.forFeature([User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [BillingController],
  providers: [BillingService, PaddleClient, JwtAuthGuard],
  exports: [BillingService],
})
export class BillingModule {}
