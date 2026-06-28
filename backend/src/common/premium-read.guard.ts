import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/user.model';
import { isValidApiKey } from './api-keys';

// Гейт чтения крауд-данных: пропуск при валидном X-API-Key (ENV API_KEYS) ИЛИ Pro-JWT (plan==='pro').
@Injectable()
export class PremiumReadGuard implements CanActivate {
  constructor(
    @InjectModel(User) private readonly users: typeof User,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // (B) API-KEY = пропуск
    const apiKey = req.headers['x-api-key'];
    if (isValidApiKey(typeof apiKey === 'string' ? apiKey : undefined)) return true;

    // (A) Pro-JWT
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        const payload: { sub: string; type: string; tv?: number } = await this.jwt.verifyAsync(token);
        if (payload.type === 'access') {
          const user = await this.users.findByPk(payload.sub);
          if (
            user &&
            user.plan === 'pro' &&
            !user.blocked &&
            (payload.tv ?? 0) === user.tokenVersion
          ) {
            req.user = { userId: payload.sub };
            return true;
          }
        }
      } catch { /* невалидный токен → ниже 403 */ }
    }

    throw new ForbiddenException('Premium-доступ к чтению требует Pro-аккаунт или API-ключ');
  }
}
