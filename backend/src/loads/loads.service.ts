import { Injectable } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Op, Sequelize } from 'sequelize';
import { Load } from './load.model';
import { IngestLoadsDto } from './dto/ingest.dto';
import { loadSeed } from '../common/seed';
import { nearbyMarkets } from '../geo/nearby';
import { computeLiveness } from './freshness';

const CROWD_WINDOW_HOURS = 72;

// форма груза для планировщика цепочек (без PII: contact/credit не отдаём)
export interface CrowdLoad {
  board: string; loadId: string; originMarket: string; destMarket: string;
  equipment: string; groupKey: string; lastSeen: Date;
  rate: number | null; loadedMiles: number | null; deadheadMiles: number | null;
  weight: number | null; brokerMc: string | null; brokerName: string | null;
}

export interface PartnerLoad {
  board: string; loadId: string; originMarket: string; destMarket: string; equipment: string;
  rate: number | null; loadedMiles: number | null; deadheadMiles: number | null; rpmCents: number | null;
  weight: number | null; brokerName: string | null; brokerMc: string | null;
  lastSeen: string; ageMinutes: number;
}

export interface CrowdLoadNear extends CrowdLoad {
  originDeadheadMi: number;
  liveness: number;
}
export interface NearResult {
  loads: CrowdLoadNear[];
  gone: string[];
  ts: string;
}

@Injectable()
export class LoadsService {
  constructor(
    @InjectModel(Load) private readonly model: typeof Load,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async ingest(dto: IngestLoadsDto): Promise<{ accepted: number }> {
    const now = new Date();
    const rows = dto.items.map((it) => ({
      board: it.board,
      loadId: it.loadId,
      originMarket: it.originMarket,
      destMarket: it.destMarket,
      equipment: it.equipment,
      groupKey: it.groupKey,
      rate: it.rate ?? null,
      loadedMiles: it.loadedMiles ?? null,
      deadheadMiles: it.deadheadMiles ?? null,
      rpmCents: rpmCents(it.rate, it.loadedMiles, it.deadheadMiles),
      weight: it.weight ?? null,
      brokerMc: it.brokerMc ?? null,
      brokerName: it.brokerName ?? null,
      firstSeen: now,
      lastSeen: now,
    }));
    await this.model.bulkCreate(rows, {
      updateOnDuplicate: [
        'rate', 'loadedMiles', 'deadheadMiles', 'rpmCents', 'weight',
        'brokerMc', 'brokerName', 'groupKey', 'lastSeen',
      ],
    });
    // Инкремент seen_count только для уже существовавших грузов: у новых first_seen == now
    // (выставлен выше), у существующих — старее. Группируем по board (составной ключ board+load_id).
    // seen_count — soft-метрика; её сбой не должен ломать ingest грузов.
    try {
      const idsByBoard = new Map<string, string[]>();
      for (const r of rows) {
        const arr = idsByBoard.get(r.board) ?? [];
        arr.push(r.loadId);
        idsByBoard.set(r.board, arr);
      }
      for (const [board, ids] of idsByBoard) {
        await this.sequelize.query(
          `UPDATE loads SET seen_count = seen_count + 1
             WHERE board = :board AND load_id IN (:ids) AND first_seen < :now`,
          { replacements: { board, ids, now } },
        );
      }
    } catch { /* soft-метрика — игнорируем */ }
    return { accepted: rows.length };
  }

  // Недавние крауд-грузы из рынка отправления — для onward-плеч планировщика цепочек.
  async byOrigin(origin: string, equipment?: string, limit = 100): Promise<CrowdLoad[]> {
    const lim = Math.min(Math.max(1, limit), 300);
    const where: any = {
      originMarket: origin,
      lastSeen: { [Op.gt]: new Date(Date.now() - CROWD_WINDOW_HOURS * 3600 * 1000) },
    };
    if (equipment) where.equipment = equipment;
    const rows = await this.model.findAll({ where, order: [['lastSeen', 'DESC']], limit: lim });
    return rows.map((r) => this.toCrowdLoad(r));
  }

  async partnerSearch(
    origin: string,
    opts: { dest?: string; equipment?: string; limit?: number } = {},
  ): Promise<PartnerLoad[]> {
    const lim = Math.min(Math.max(1, opts.limit ?? 100), 200);
    const where: any = {
      originMarket: origin,
      lastSeen: { [Op.gt]: new Date(Date.now() - CROWD_WINDOW_HOURS * 3600 * 1000) },
    };
    if (opts.dest) where.destMarket = opts.dest;
    if (opts.equipment) where.equipment = opts.equipment;
    const rows = await this.model.findAll({ where, order: [['lastSeen', 'DESC']], limit: lim });
    const now = Date.now();
    return rows.map((r) => ({
      board: r.board, loadId: r.loadId, originMarket: r.originMarket, destMarket: r.destMarket,
      equipment: r.equipment, rate: r.rate, loadedMiles: r.loadedMiles, deadheadMiles: r.deadheadMiles,
      rpmCents: r.rpmCents, weight: r.weight, brokerName: r.brokerName, brokerMc: r.brokerMc,
      lastSeen: new Date(r.lastSeen).toISOString(),
      ageMinutes: Math.round((now - new Date(r.lastSeen).getTime()) / 60000),
    }));
  }

  private toCrowdLoad(r: Load): CrowdLoad {
    return {
      board: r.board, loadId: r.loadId,
      originMarket: r.originMarket, destMarket: r.destMarket,
      equipment: r.equipment, groupKey: r.groupKey, lastSeen: r.lastSeen,
      rate: r.rate, loadedMiles: r.loadedMiles, deadheadMiles: r.deadheadMiles,
      weight: r.weight, brokerMc: r.brokerMc, brokerName: r.brokerName,
    };
  }

  // Neighborhood грузов (рынок + соседи в радиусе) для непрерывных цепочек + живой свежести.
  async near(
    market: string,
    opts: { equipment?: string; radiusMi?: number; since?: string } = {},
    now: Date = new Date(),
  ): Promise<NearResult> {
    const radiusMi = Math.min(Math.max(0, opts.radiusMi ?? 75), 200);
    const neighbors = nearbyMarkets(market, radiusMi, loadSeed());
    const dhByMarket = new Map(neighbors.map((n) => [n.market, n.crowMi]));
    const where: any = {
      originMarket: { [Op.in]: neighbors.map((n) => n.market) },
      lastSeen: { [Op.gt]: new Date(now.getTime() - CROWD_WINDOW_HOURS * 3600 * 1000) },
    };
    if (opts.equipment) where.equipment = opts.equipment;
    // limit 300 по lastSeen DESC: loads[] всегда свежий; в очень плотном (>300) neighborhood
    // хвостовые likelyGone могут не попасть в gone[] — приемлемо для MVP (300 свежих в одном радиусе маловероятно).
    const rows = await this.model.findAll({ where, order: [['lastSeen', 'DESC']], limit: 300 });

    const since = opts.since ? new Date(opts.since) : null;
    const loads: CrowdLoadNear[] = [];
    const gone: string[] = [];
    for (const r of rows) {
      const { liveness, likelyGone } = computeLiveness(r, now);
      if (likelyGone) { gone.push(r.loadId); continue; }
      if (since && new Date(r.lastSeen) <= since) continue;
      loads.push({ ...this.toCrowdLoad(r), originDeadheadMi: dhByMarket.get(r.originMarket) ?? 0, liveness });
    }
    return { loads, gone, ts: now.toISOString() };
  }
}

// true RPM в центах/милю (целое, чтобы хранить INTEGER): rate / (loaded+deadhead) * 100
export function rpmCents(
  rate?: number | null, loaded?: number | null, deadhead?: number | null,
): number | null {
  const denom = (loaded ?? 0) + (deadhead ?? 0);
  if (!rate || denom <= 0) return null;
  return Math.round((rate / denom) * 100);
}
