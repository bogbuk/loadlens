import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Load } from './load.model';
import { LoadsService } from './loads.service';
import { LoadsController } from './loads.controller';

@Module({
  imports: [SequelizeModule.forFeature([Load])],
  controllers: [LoadsController],
  providers: [LoadsService],
  exports: [SequelizeModule],
})
export class LoadsModule {}
