import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [CommonAuthModule],
  controllers: [RatesController],
  providers: [RatesService],
})
export class RatesModule {}
