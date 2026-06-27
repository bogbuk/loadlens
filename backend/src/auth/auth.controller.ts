import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CredentialsDto, RefreshDto, ForgotDto, ResetPasswordDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: CredentialsDto) { return this.service.register(dto.email, dto.password); }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: CredentialsDto) { return this.service.login(dto.email, dto.password); }

  @Post('refresh')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  refresh(@Body() dto: RefreshDto) { return this.service.refresh(dto.refreshToken); }

  @Post('forgot')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  forgot(@Body() dto: ForgotDto) { return this.service.forgot(dto.email); }

  @Post('reset')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() dto: ResetPasswordDto) { return this.service.reset(dto.token, dto.newPassword); }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: { user: { userId: string } }) { return this.service.me(req.user.userId); }
}
