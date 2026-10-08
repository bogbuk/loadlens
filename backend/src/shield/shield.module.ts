import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FmcsaAuthority } from './fmcsa-authority.model';
import { FmcsaClient } from './fmcsa.client';
import { ShieldController } from './shield.controller';
import { ShieldService } from './shield.service';

@Module({
  imports: [SequelizeModule.forFeature([FmcsaAuthority])],
  controllers: [ShieldController],
  providers: [ShieldService, FmcsaClient],
})
export class ShieldModule {}
