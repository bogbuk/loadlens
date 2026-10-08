import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize';
import { normalizeMc } from '../brokers/brokers.service';
import { Authority, deriveHistory, deriveStatus } from './authority';
import { FmcsaClient } from './fmcsa.client';
import { FmcsaAuthority } from './fmcsa-authority.model';
import { repostStats, RepostStats } from './repost';

const HOUR = 3_600_000;
const TTL_FOUND = 24 * HOUR;
const TTL_NOT_FOUND = 6 * HOUR;

export interface ShieldResponse { mc: string; authority: Authority | null; repost: RepostStats | null }

@Injectable()
export class ShieldService {
  private readonly log = new Logger('ShieldService');
  private readonly inflight = new Map<string, Promise<Authority | null>>();

  constructor(
    @InjectModel(FmcsaAuthority) private readonly model: typeof FmcsaAuthority,
    private readonly fmcsa: FmcsaClient,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async shield(mcRaw: string, o?: string, d?: string, e?: string, now = new Date()): Promise<ShieldResponse> {
    const mc = normalizeMc(mcRaw);
    if (!/^\d{1,8}$/.test(mc)) throw new BadRequestException('invalid MC');
    const [authority, repost] = await Promise.all([
      this.authority(mc, now),
      o && d && e ? repostStats(this.sequelize, mc, o, d, e) : Promise.resolve(null),
    ]);
    return { mc, authority, repost };
  }

  // одновременные промахи по одному MC (много грузов брокера на странице) — один поход в FMCSA
  authority(mc: string, now = new Date()): Promise<Authority | null> {
    const hit = this.inflight.get(mc);
    if (hit) return hit;
    const p = this.load(mc, now).finally(() => this.inflight.delete(mc));
    this.inflight.set(mc, p);
    return p;
  }

  private async load(mc: string, now: Date): Promise<Authority | null> {
    const row = await this.model.findByPk(mc);
    if (row) {
      const ttl = (row.data as Authority).status === 'not_found' ? TTL_NOT_FOUND : TTL_FOUND;
      if (now.getTime() - new Date(row.fetchedAt).getTime() < ttl) return row.data as Authority;
    }
    const [qc, hist, motus] = await Promise.allSettled([
      this.fmcsa.qc(mc), this.fmcsa.authHist(mc), this.fmcsa.motus(mc),
    ]);
    const failed = [qc, hist, motus].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) this.log.warn(`FMCSA ${mc}: ${failed.map((f) => String(f.reason?.message || f.reason)).join('; ')}`);
    if (failed.length === 3) return row ? (row.data as Authority) : null;

    const carrier = qc.status === 'fulfilled' ? qc.value : undefined;
    const history = deriveHistory(
      hist.status === 'fulfilled' ? hist.value : [],
      motus.status === 'fulfilled' ? motus.value : [],
      now,
    );
    const authority: Authority = {
      status: carrier === undefined ? null : deriveStatus(carrier),
      allowedToOperate: carrier ? (carrier.allowedToOperate === 'Y' ? true : carrier.allowedToOperate === 'N' ? false : null) : null,
      ...history,
      checkedAt: now.toISOString(),
    };
    // частичный результат не кэшируем — иначе сутки показывали бы «нет статуса» из-за одного таймаута
    if (!failed.length) await this.model.upsert({ mc, data: authority, fetchedAt: now } as any);
    return authority;
  }
}
