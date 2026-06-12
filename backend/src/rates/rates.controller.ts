import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RatesService } from './rates.service';

@SkipThrottle()
@Controller('rates')
export class RatesController {
  constructor(private readonly service: RatesService) {}

  @Get()
  rates() {
    return this.service.getRates();
  }
}
