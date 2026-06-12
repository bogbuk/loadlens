import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const key = process.env.ADMIN_KEY;
    const got = ctx.switchToHttp().getRequest().headers['x-admin-key'];
    if (!key || got !== key) throw new ForbiddenException();
    return true;
  }
}
