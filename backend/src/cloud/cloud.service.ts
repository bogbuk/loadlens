import {
  BadGatewayException, ConflictException, Injectable, Logger, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomBytes } from 'node:crypto';
import { User } from '../users/user.model';
import { TelegramService } from '../telegram/telegram.service';
import { CloudInstance, CloudStatus } from './cloud-instance.model';
import { CoolifyService, renderCompose } from './coolify.service';
import { HeartbeatDto } from './dto/heartbeat.dto';

export interface CloudStatusView {
  enabled: true;
  status: CloudStatus | 'off';
  lastHeartbeatAt: string | null;
  loadsSeen: number;
  screenDomain: string | null;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
// 20 символов без похожих (0/O, 1/l/I): пароль пользователь может вводить руками в noVNC.
export function randomPassword(len = 20): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

@Injectable()
export class CloudService {
  private readonly log = new Logger(CloudService.name);

  constructor(
    @InjectModel(CloudInstance) private readonly instances: typeof CloudInstance,
    @InjectModel(User) private readonly users: typeof User,
    private readonly coolify: CoolifyService,
    private readonly telegram: TelegramService,
  ) {}

  private view(inst: CloudInstance | null): CloudStatusView {
    if (!inst) return { enabled: true, status: 'off', lastHeartbeatAt: null, loadsSeen: 0, screenDomain: null };
    return {
      enabled: true,
      status: inst.status,
      lastHeartbeatAt: inst.lastHeartbeatAt ? new Date(inst.lastHeartbeatAt).toISOString() : null,
      loadsSeen: inst.loadsSeen ?? 0,
      screenDomain: inst.screenDomain ?? null,
    };
  }

  // Ссылка на экран (MVP, спека §5 уровень 1): пароль в query, ротируется на каждом Enable.
  screenUrl(inst: CloudInstance): string | null {
    if (!inst.screenDomain || !inst.vncPassword) return null;
    return `https://${inst.screenDomain}/vnc.html?autoconnect=1&resize=scale&password=${encodeURIComponent(inst.vncPassword)}`;
  }

  async status(userId: string): Promise<CloudStatusView> {
    return this.view(await this.instances.findOne({ where: { userId } }));
  }

  // Идемпотентно: живой сервис не трогаем; остановленный — стартуем с новым паролем; нет — создаём.
  async enable(userId: string): Promise<CloudStatusView> {
    if (!this.coolify.configured) throw new ServiceUnavailableException('Cloud browser is not configured on the server');
    let inst = await this.instances.findOne({ where: { userId } });
    if (inst && inst.coolifyServiceUuid && inst.status !== 'stopped' && inst.status !== 'error') return this.view(inst);
    if (!inst) inst = await this.instances.create({ userId, status: 'starting', vncPassword: randomPassword() });
    try {
      if (!inst.coolifyServiceUuid) {
        const { uuid } = await this.coolify.createService({
          name: `ll-${userId.slice(0, 8)}`,
          compose: renderCompose({ userId, instanceId: inst.id, imageTag: process.env.CLOUD_IMAGE_TAG || 'latest' }),
        });
        inst.coolifyServiceUuid = uuid;
      } else {
        inst.vncPassword = randomPassword(); // Enable после Disable — старая ссылка на экран умирает
      }
      await this.coolify.setEnv(inst.coolifyServiceUuid, 'NOVNC_PASSWORD', inst.vncPassword!);
      await this.coolify.start(inst.coolifyServiceUuid);
      inst.screenDomain = (await this.coolify.getFqdn(inst.coolifyServiceUuid)) ?? inst.screenDomain ?? null;
      inst.status = 'starting';
      inst.disabledAt = null;
      inst.lastStateNotified = null;
      await inst.save();
      return this.view(inst);
    } catch (e) {
      inst.status = 'error';
      await inst.save();
      this.log.error(`enable failed for ${userId}: ${(e as Error).message}`);
      throw new BadGatewayException('Could not start the cloud browser. Please try again later.');
    }
  }

  async disable(userId: string): Promise<CloudStatusView> {
    const inst = await this.instances.findOne({ where: { userId } });
    if (!inst) return this.view(null);
    if (inst.coolifyServiceUuid && inst.status !== 'stopped') {
      try { await this.coolify.stop(inst.coolifyServiceUuid); }
      catch (e) { this.log.error(`stop failed for ${userId}: ${(e as Error).message}`); }
    }
    inst.status = 'stopped';
    inst.disabledAt = new Date();
    await inst.save();
    return this.view(inst);
  }

  // Для админки: снять cloud_enabled = остановить браузер (volume остаётся до sweep через 30 дней).
  async disableForUser(userId: string): Promise<void> { await this.disable(userId); }

  async screen(userId: string): Promise<{ url: string; password: string }> {
    const inst = await this.instances.findOne({ where: { userId } });
    if (!inst || inst.status === 'stopped') throw new ConflictException('Cloud browser is not running. Enable it first.');
    const url = this.screenUrl(inst);
    if (!url) throw new ConflictException('The screen address is not ready yet. Try again in a minute.');
    return { url, password: inst.vncPassword! };
  }

  async heartbeat(userId: string, dto: HeartbeatDto): Promise<{ ok: true }> {
    const inst = await this.instances.findOne({ where: { userId } });
    if (!inst || inst.status === 'stopped') return { ok: true }; // остановленный/чужой — игнорируем
    inst.status = dto.state;
    inst.lastHeartbeatAt = new Date();
    inst.loadsSeen = dto.loadsSeen;
    if (dto.state === 'ok') inst.lastStateNotified = null;
    await inst.save();
    return { ok: true };
  }
}
