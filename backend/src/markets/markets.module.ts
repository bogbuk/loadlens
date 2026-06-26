import { Module } from '@nestjs/common';
import { MarketsService } from './markets.service';
import { MarketsController } from './markets.controller';
import { CommonAuthModule } from '../common/common-auth.module';

@Module({
  imports: [CommonAuthModule],
  controllers: [MarketsController],
  providers: [MarketsService],
})
export class MarketsModule {}
