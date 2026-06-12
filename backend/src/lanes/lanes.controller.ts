import { Controller, Get, Param, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LanesService } from './lanes.service';

// Чтения не троттлим: расширение шлёт GET /lanes на каждую видимую lane страницы.
@SkipThrottle()
@Controller('lanes')
export class LanesController {
  constructor(private readonly service: LanesService) {}

  @Get(':origin/:dest')
  lane(
    @Param('origin') origin: string,
    @Param('dest') dest: string,
    @Query('equipment') equipment?: string,
  ) {
    return this.service.lane(origin, dest, equipment);
  }
}
