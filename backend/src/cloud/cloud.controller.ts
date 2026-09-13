import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudGuard } from './cloud.guard';
import { CloudService } from './cloud.service';
import { HeartbeatDto } from './dto/heartbeat.dto';

@Controller('cloud')
@UseGuards(JwtAuthGuard, CloudGuard)
export class CloudController {
  constructor(private readonly service: CloudService) {}

  @Get('status')
  status(@Req() req: any) { return this.service.status(req.user.userId); }

  @Post('enable')
  enable(@Req() req: any) { return this.service.enable(req.user.userId); }

  @Post('disable')
  disable(@Req() req: any) { return this.service.disable(req.user.userId); }

  @Post('screen')
  screen(@Req() req: any) { return this.service.screen(req.user.userId); }

  // Heartbeat облачного браузера — раз в 5 мин на инстанс, не троттлим.
  @Post('heartbeat')
  @SkipThrottle()
  heartbeat(@Req() req: any, @Body() dto: HeartbeatDto) { return this.service.heartbeat(req.user.userId, dto); }
}
