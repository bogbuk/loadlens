import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/user.model';
import { parseAdminEmails } from './admin-emails';
import { TelegramService } from '../telegram/telegram.service';
import { genResetCode, sha256 } from './reset-code';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly jwt: JwtService,
    private readonly telegram: TelegramService,
  ) {}

  private async tokens(userId: string) {
    return {
      accessToken: await this.jwt.signAsync({ sub: userId, type: 'access' }, { expiresIn: ACCESS_TTL }),
      refreshToken: await this.jwt.signAsync({ sub: userId, type: 'refresh' }, { expiresIn: REFRESH_TTL }),
    };
  }

  private publicUser(u: User) { return { email: u.email, plan: u.plan }; }

  async register(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();
    if (await this.userModel.findOne({ where: { email } }))
      throw new ConflictException('email уже зарегистрирован');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.userModel.create({ email, passwordHash });
    return { ...(await this.tokens(user.id)), user: this.publicUser(user) };
  }

  async login(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new UnauthorizedException('неверный email или пароль');
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
    // Апгрейд роли: email из ADMIN_EMAIL → admin (покрывает регистрацию после старта приложения).
    if (user.role !== 'admin' && parseAdminEmails(process.env.ADMIN_EMAIL).includes(email)) {
      user.role = 'admin';
      await this.userModel.update({ role: 'admin' }, { where: { email } });
    }
    return { ...(await this.tokens(user.id)), user: this.publicUser(user) };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; type: string };
    try { payload = await this.jwt.verifyAsync(refreshToken); }
    catch { throw new UnauthorizedException('невалидный refresh-токен'); }
    if (payload.type !== 'refresh') throw new UnauthorizedException('ожидался refresh-токен');
    const user = await this.userModel.findByPk(payload.sub);
    if (!user) throw new UnauthorizedException('пользователь не найден');
    if (user.blocked) throw new ForbiddenException('аккаунт заблокирован');
    return { ...(await this.tokens(user.id)), user: this.publicUser(user) };
  }

  async me(userId: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new UnauthorizedException('пользователь не найден');
    return this.publicUser(user);
  }

  // Сброс пароля: шлём код в Telegram, если привязан. Ответ всегда одинаковый (без enumeration).
  async forgot(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (user && user.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      const code = genResetCode();
      user.passwordResetTokenHash = sha256(code);
      user.passwordResetExpires = Date.now() + 30 * 60 * 1000;
      await user.save();
      try {
        await this.telegram.sendMessageTo(
          user.telegramChatId,
          `Код сброса пароля LoadLens: ${code}\nДействует 30 минут. Если вы не запрашивали сброс — игнорируйте.`,
        );
      } catch (e) {
        // Доставка не критична — пользователь может повторить запрос. Логируем для ops.
        this.logger.warn(`не удалось отправить код сброса в Telegram: ${(e as Error)?.message ?? e}`);
      }
    }
    return { ok: true };
  }

  async reset(token: string, newPassword: string) {
    const hash = sha256(token.trim());
    const user = await this.userModel.findOne({ where: { passwordResetTokenHash: hash } });
    if (!user || user.passwordResetExpires == null || Number(user.passwordResetExpires) < Date.now())
      throw new BadRequestException('недействительный или истёкший код');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordResetTokenHash = null;
    user.passwordResetExpires = null;
    await user.save();
    return { ok: true };
  }
}
