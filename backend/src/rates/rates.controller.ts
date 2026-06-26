import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RatesService } from './rates.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

@SkipThrottle()
@UseGuards(PremiumReadGuard)
@Controller('rates')
export class RatesController {
  constructor(private readonly service: RatesService) {}

  @Get()
  rates() {
    return this.service.getRates();
  }
}
