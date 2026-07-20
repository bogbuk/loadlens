import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LoadsService } from './loads.service';
import { PartnerApiKeyGuard } from '../auth/partner-api-key.guard';
import { IngestLoadsDto } from './dto/ingest.dto';
import { PremiumReadGuard } from '../common/premium-read.guard';

@Controller('loads')
export class LoadsController {
  constructor(private readonly service: LoadsService) {}

  @Post()
  ingest(@Body() dto: IngestLoadsDto) {
    return this.service.ingest(dto);
  }

  // Partner TMS endpoint — guarded by API key, returns PartnerLoad[]
  @SkipThrottle()
  @UseGuards(PartnerApiKeyGuard)
  @Get('partner')
  partner(
    @Query('origin') origin?: string,
    @Query('dest') dest?: string,
    @Query('equipment') equipment?: string,
    @Query('limit') limit?: string,
  ) {
    if (!origin) throw new BadRequestException('origin is required');
    return this.service.partnerSearch(origin, {
      dest, equipment,
      limit: limit && Number.isFinite(parseInt(limit, 10)) ? parseInt(limit, 10) : undefined,
    });
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
    if (!market) throw new BadRequestException('market is required');
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
    if (!origin) throw new BadRequestException('origin is required');
    return this.service.byOrigin(origin, equipment, limit ? parseInt(limit, 10) : 100);
  }
}
