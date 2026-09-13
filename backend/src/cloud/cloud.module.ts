import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { TelegramModule } from '../telegram/telegram.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudInstance } from './cloud-instance.model';
import { CoolifyService } from './coolify.service';
import { CloudService } from './cloud.service';
import { CloudGuard } from './cloud.guard';
import { CloudController } from './cloud.controller';

@Module({
  imports: [
    SequelizeModule.forFeature([User, CloudInstance]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
    TelegramModule,
  ],
  controllers: [CloudController],
  providers: [CoolifyService, CloudService, JwtAuthGuard, CloudGuard],
  // SequelizeModule наружу: AuthModule (DevicesService/AdminService) читает CloudInstance.
  exports: [CloudService, SequelizeModule],
})
export class CloudModule {}
