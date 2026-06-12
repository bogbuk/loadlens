import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Load } from './load.model';
import { IngestLoadsDto } from './dto/ingest.dto';

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
}

// true RPM в центах/милю (целое, чтобы хранить INTEGER): rate / (loaded+deadhead) * 100
export function rpmCents(
  rate?: number | null, loaded?: number | null, deadhead?: number | null,
): number | null {
  const denom = (loaded ?? 0) + (deadhead ?? 0);
  if (!rate || denom <= 0) return null;
  return Math.round((rate / denom) * 100);
}
