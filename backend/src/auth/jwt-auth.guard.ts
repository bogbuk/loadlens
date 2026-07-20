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
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('missing Bearer token');
    let payload: { sub: string; type: string; tv?: number };
    try { payload = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('invalid token'); }
    if (payload.type !== 'access') throw new UnauthorizedException('expected an access token');
    // Stateful: грузим User для сверки версии сессии и статуса блокировки.
    const user = await this.userModel.findByPk(payload.sub);
    if (!user) throw new UnauthorizedException('user not found');
    if ((payload.tv ?? 0) !== user.tokenVersion) throw new UnauthorizedException('session is no longer valid');
    if (user.blocked) throw new ForbiddenException('account is blocked');
    req.user = { userId: user.id };
    return true;
  }
}
