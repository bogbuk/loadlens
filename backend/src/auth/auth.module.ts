import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { LanesModule } from '../lanes/lanes.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRoleGuard } from './admin-role.guard';

@Module({
  imports: [
    UsersModule,
    LanesModule,
    TelegramModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AdminService, JwtAuthGuard, AdminRoleGuard],
})
export class AuthModule {}
