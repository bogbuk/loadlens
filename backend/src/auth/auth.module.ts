import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { UsersModule } from '../users/users.module';
import { LanesModule } from '../lanes/lanes.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { UserDevice } from './user-device.model';
import { DevicesService } from './devices.service';

@Module({
  imports: [
    SequelizeModule.forFeature([UserDevice]),
    UsersModule,
    LanesModule,
    TelegramModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AdminService, JwtAuthGuard, AdminRoleGuard, DevicesService],
})
export class AuthModule {}
