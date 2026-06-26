import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { PremiumReadGuard } from './premium-read.guard';

// Общий модуль для PremiumReadGuard: даёт ему JwtService + модель User. Импортируется read-модулями.
@Module({
  imports: [
    SequelizeModule.forFeature([User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  providers: [PremiumReadGuard],
  exports: [PremiumReadGuard],
})
export class CommonAuthModule {}
