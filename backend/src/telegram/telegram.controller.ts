import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from '../drivers/pro.guard';
import { TelegramService } from './telegram.service';
import { AlertsDto } from './dto/alerts.dto';
import { NotifyDto } from './dto/notify.dto';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly service: TelegramService) {}

  // Привязка/настройка — под аккаунтом, Pro-гейт (как парк).
  @Post('link')
  @UseGuards(JwtAuthGuard, ProGuard)
  link(@Req() req: any) { return this.service.link(req.user.userId); }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@Req() req: any) { return this.service.status(req.user.userId); }

  @Patch('alerts')
  @UseGuards(JwtAuthGuard, ProGuard)
  alerts(@Req() req: any, @Body() dto: AlertsDto) {
    return this.service.setAlerts(req.user.userId, dto.enabled);
  }

  @Post('unlink')
  @UseGuards(JwtAuthGuard)
  unlink(@Req() req: any) { return this.service.unlink(req.user.userId); }

  // Релей подошедших грузов от расширения. Pro-гейт; не троттлим жёстко (батчи раз в несколько сек).
  @Post('notify')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard, ProGuard)
  notify(@Req() req: any, @Body() dto: NotifyDto) {
    return this.service.notify(req.user.userId, dto.items);
  }

  // Вебхук Telegram (без JWT — секрет в пути). Привязывает chat_id по /start <token>.
  @Post('webhook/:secret')
  @SkipThrottle()
  webhook(@Param('secret') secret: string, @Body() body: any) {
    return this.service.handleWebhook(secret, body);
  }
}
