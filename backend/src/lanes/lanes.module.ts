import { Module } from '@nestjs/common';
import { LanesService } from './lanes.service';
import { LanesController } from './lanes.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [CommonAuthModule],
  controllers: [LanesController],
  providers: [LanesService],
})
export class LanesModule {}
