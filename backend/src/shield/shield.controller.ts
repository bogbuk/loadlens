import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShieldService } from './shield.service';

// Fraud Shield открыт всем (решение 2026-10-07, вариант B): без PremiumReadGuard.
// Свой лимит выше глобального: расширение спрашивает по каждой паре брокер+lane на странице.
@Controller('brokers')
export class ShieldController {
  constructor(private readonly service: ShieldService) {}

  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @Get(':mc/shield')
  shield(@Param('mc') mc: string, @Query('o') o?: string, @Query('d') d?: string, @Query('e') e?: string) {
    return this.service.shield(mc, o, d, e);
  }
}
