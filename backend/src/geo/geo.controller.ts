import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { GeoService } from './geo.service';

@SkipThrottle()
@Controller('geo')
export class GeoController {
  constructor(private readonly service: GeoService) {}

  @Get('distance')
  distance(@Query('from') from?: string, @Query('to') to?: string) {
    if (!from || !to) throw new BadRequestException('from и to обязательны');
    return this.service.distance(from, to);
  }
}
