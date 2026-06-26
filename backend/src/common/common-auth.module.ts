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
  // Экспортируем не только гард, но и SequelizeModule (UserRepository) + JwtModule (JwtService):
  // при @UseGuards(PremiumReadGuard) Nest резолвит зависимости гарда в контексте потребляющего
  // модуля, поэтому его deps должны быть доступны там (как в UsersModule/DriversModule).
  exports: [PremiumReadGuard, SequelizeModule, JwtModule],
})
export class CommonAuthModule {}
