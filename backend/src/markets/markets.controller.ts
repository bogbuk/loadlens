import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MarketsService } from './markets.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

@SkipThrottle()
@UseGuards(PremiumReadGuard)
@Controller('markets')
export class MarketsController {
  constructor(private readonly service: MarketsService) {}

  @Get(':market/strength')
  strength(@Param('market') market: string) {
    return this.service.strength(market);
  }
}
