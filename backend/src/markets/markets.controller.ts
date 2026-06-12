import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MarketsService } from './markets.service';

@SkipThrottle()
@Controller('markets')
export class MarketsController {
  constructor(private readonly service: MarketsService) {}

  @Get(':market/strength')
  strength(@Param('market') market: string) {
    return this.service.strength(market);
  }
}
