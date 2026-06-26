import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Load } from './load.model';
import { LoadsService } from './loads.service';
import { LoadsController } from './loads.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [SequelizeModule.forFeature([Load]), CommonAuthModule],
  controllers: [LoadsController],
  providers: [LoadsService],
  exports: [SequelizeModule],
})
export class LoadsModule {}
