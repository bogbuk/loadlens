import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { Driver } from './driver.model';
import { User } from '../users/user.model';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from './pro.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([Driver, User]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
  controllers: [DriversController],
  providers: [DriversService, JwtAuthGuard, ProGuard],
  exports: [SequelizeModule],
})
export class DriversModule {}
