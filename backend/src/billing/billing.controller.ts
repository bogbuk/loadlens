import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  // Для checkout.html (без JWT): окружение и client-side token Paddle.js.
  @Get('client-config')
  clientConfig() { return this.service.clientConfig(); }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Req() req: { user: { userId: string } }) { return this.service.createCheckout(req.user.userId); }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  portal(@Req() req: { user: { userId: string } }) { return this.service.createPortal(req.user.userId); }

  @Post('paddle/webhook')
  @HttpCode(200)
  webhook(@Headers('paddle-signature') sig: string | undefined, @Req() req: { rawBody?: Buffer }, @Body() body: unknown) {
    return this.service.handleWebhook(sig, req.rawBody, body);
  }
}
