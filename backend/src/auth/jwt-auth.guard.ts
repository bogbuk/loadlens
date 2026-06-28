import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/user.model';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('нет Bearer-токена');
    let payload: { sub: string; type: string; tv?: number };
    try { payload = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('невалидный токен'); }
    if (payload.type !== 'access') throw new UnauthorizedException('ожидался access-токен');
    // Stateful: грузим User для сверки версии сессии и статуса блокировки.
    const user = await this.userModel.findByPk(payload.sub);
    if (!user) throw new UnauthorizedException('пользователь не найден');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException('сессия недействительна');
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
    req.user = { userId: user.id };
    return true;
  }
}
