import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './user.model';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudModule } from '../cloud/cloud.module';

@Module({
  imports: [
    SequelizeModule.forFeature([User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
    // Удаление аккаунта сносит и облачный браузер (CloudService.purgeForUser).
    CloudModule,
  ],
  controllers: [UsersController],
  providers: [JwtAuthGuard, UsersService],
  exports: [SequelizeModule],
})
export class UsersModule {}
