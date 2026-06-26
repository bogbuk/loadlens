import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { LaneDistance } from './lane-distance.model';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [SequelizeModule.forFeature([LaneDistance]), CommonAuthModule],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [SequelizeModule],
})
export class GeoModule {}
