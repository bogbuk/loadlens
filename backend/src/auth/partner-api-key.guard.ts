import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const key = process.env.PARTNER_API_KEY;
    const got = ctx.switchToHttp().getRequest().headers['x-api-key'];
    if (!key || got !== key) throw new ForbiddenException();
    return true;
  }
}
