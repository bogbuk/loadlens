import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('нет Bearer-токена');
    let payload: { sub: string; type: string };
    try { payload = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('невалидный токен'); }
    if (payload.type !== 'access') throw new UnauthorizedException('ожидался access-токен');
    req.user = { userId: payload.sub };
    return true;
  }
}
