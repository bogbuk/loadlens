import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LoadsService } from './loads.service';
import { IngestLoadsDto } from './dto/ingest.dto';

@Controller('loads')
export class LoadsController {
  constructor(private readonly service: LoadsService) {}

  @Post()
  ingest(@Body() dto: IngestLoadsDto) {
    return this.service.ingest(dto);
  }

  // Крауд-грузы из рынка отправления — для onward-плеч планировщика. Чтения не троттлим.
  @SkipThrottle()
  @Get()
  byOrigin(@Query('origin') origin?: string, @Query('equipment') equipment?: string, @Query('limit') limit?: string) {
    if (!origin) throw new BadRequestException('origin обязателен');
    return this.service.byOrigin(origin, equipment, limit ? parseInt(limit, 10) : 100);
  }
}
