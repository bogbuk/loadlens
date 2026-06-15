import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Load } from './load.model';
import { IngestLoadsDto } from './dto/ingest.dto';

const CROWD_WINDOW_HOURS = 72;

// форма груза для планировщика цепочек (без PII: contact/credit не отдаём)
export interface CrowdLoad {
  board: string; loadId: string; originMarket: string; destMarket: string;
  equipment: string; groupKey: string; lastSeen: Date;
  rate: number | null; loadedMiles: number | null; deadheadMiles: number | null;
  weight: number | null; brokerMc: string | null; brokerName: string | null;
}

@Injectable()
export class LoadsService {
  constructor(@InjectModel(Load) private readonly model: typeof Load) {}

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
    return rows.map((r) => ({
      board: r.board, loadId: r.loadId,
      originMarket: r.originMarket, destMarket: r.destMarket,
      equipment: r.equipment, groupKey: r.groupKey, lastSeen: r.lastSeen,
      rate: r.rate, loadedMiles: r.loadedMiles, deadheadMiles: r.deadheadMiles,
      weight: r.weight, brokerMc: r.brokerMc, brokerName: r.brokerName,
    }));
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
