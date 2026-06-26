import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LanesService } from './lanes.service';
import { PremiumReadGuard } from '../common/premium-read.guard';

// Чтения не троттлим: расширение шлёт GET /lanes на каждую видимую lane страницы.
@SkipThrottle()
@Controller('lanes')
export class LanesController {
  constructor(private readonly service: LanesService) {}

  // Список топ-lane'ов + сводка — для живого дашборда на /. Публичный.
  @Get()
  async list(@Query('limit') limit?: string) {
    const [summary, lanes] = await Promise.all([
      this.service.overview(),
      this.service.topLanes(limit ? parseInt(limit, 10) : 50),
    ]);
    return { summary, lanes };
  }

  @UseGuards(PremiumReadGuard)
  @Get(':origin/:dest')
  lane(
    @Param('origin') origin: string,
    @Param('dest') dest: string,
    @Query('equipment') equipment?: string,
  ) {
    return this.service.lane(origin, dest, equipment);
  }
}
