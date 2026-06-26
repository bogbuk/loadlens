import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LoadsService } from './loads.service';
import { IngestLoadsDto } from './dto/ingest.dto';
import { PremiumReadGuard } from '../common/premium-read.guard';

@Controller('loads')
export class LoadsController {
  constructor(private readonly service: LoadsService) {}

  @Post()
  ingest(@Body() dto: IngestLoadsDto) {
    return this.service.ingest(dto);
  }

  // Neighborhood грузов (рынок + соседи в радиусе) для цепочек + delta-poll живой свежести.
  @SkipThrottle()
  @UseGuards(PremiumReadGuard)
  @Get('near')
  near(
    @Query('market') market?: string,
    @Query('equipment') equipment?: string,
    @Query('radiusMi') radiusMi?: string,
    @Query('since') since?: string,
  ) {
    if (!market) throw new BadRequestException('market обязателен');
    return this.service.near(market, {
      equipment,
      radiusMi: radiusMi && Number.isFinite(parseInt(radiusMi, 10)) ? parseInt(radiusMi, 10) : undefined,
      since,
    });
  }

  // Крауд-грузы из рынка отправления — для onward-плеч планировщика. Чтения не троттлим.
  @SkipThrottle()
  @UseGuards(PremiumReadGuard)
  @Get()
  byOrigin(@Query('origin') origin?: string, @Query('equipment') equipment?: string, @Query('limit') limit?: string) {
    if (!origin) throw new BadRequestException('origin обязателен');
    return this.service.byOrigin(origin, equipment, limit ? parseInt(limit, 10) : 100);
  }
}
