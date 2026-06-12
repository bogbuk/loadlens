import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { LaneDistance } from './lane-distance.model';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  imports: [SequelizeModule.forFeature([LaneDistance])],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [SequelizeModule],
})
export class GeoModule {}
