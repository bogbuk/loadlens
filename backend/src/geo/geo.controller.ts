import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { GeoService } from './geo.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

@SkipThrottle()
@UseGuards(PremiumReadGuard)
@Controller('geo')
export class GeoController {
  constructor(private readonly service: GeoService) {}

  @Get('distance')
  distance(@Query('from') from?: string, @Query('to') to?: string) {
    if (!from || !to) throw new BadRequestException('from and to are required');
    return this.service.distance(from, to);
  }
}
