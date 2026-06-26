import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BrokerReport } from './broker-report.model';
import { BrokersService } from './brokers.service';
import { BrokersController } from './brokers.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [SequelizeModule.forFeature([BrokerReport]), CommonAuthModule],
  controllers: [BrokersController],
  providers: [BrokersService],
  exports: [SequelizeModule],
})
export class BrokersModule {}
