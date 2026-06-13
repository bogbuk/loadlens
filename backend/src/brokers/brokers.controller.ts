import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BrokersService } from './brokers.service';
import { ReportDto } from './dto/report.dto';

@Controller('brokers')
export class BrokersController {
  constructor(private readonly service: BrokersService) {}

  // запись троттлим (наследует глобальный ThrottlerGuard)
  @Post('reports')
  report(@Body() dto: ReportDto) {
    return this.service.report(dto);
  }

  // чтение не троттлим — расширение запрашивает на каждый видимый MC
  @SkipThrottle()
  @Get(':mc/reputation')
  reputation(@Param('mc') mc: string) {
    return this.service.reputation(mc);
  }
}
