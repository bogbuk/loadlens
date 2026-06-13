import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BrokerReport } from './broker-report.model';
import { ReportDto } from './dto/report.dto';

export const REPORT_MIN = 3; // минимум отзывов для оценки уровня (иначе 'thin')

export interface BrokerReputation {
  brokerMc: string;
  level: 'good' | 'mixed' | 'bad' | 'thin';
  n: number;
  paid: number;
  noIssue: number;
  slow: number;
  flaked: number;
  doubleBrokered: number;
}

// MC к каноничному виду: убрать префикс/пробелы/пунктуацию, оставить цифры (MC-номер).
export function normalizeMc(raw: string): string {
  const digits = String(raw || '').replace(/\D+/g, '');
  return digits || String(raw || '').trim().toUpperCase();
}

@Injectable()
export class BrokersService {
  constructor(@InjectModel(BrokerReport) private readonly model: typeof BrokerReport) {}

  async report(dto: ReportDto): Promise<{ ok: true }> {
    const brokerMc = normalizeMc(dto.brokerMc);
    await this.model.bulkCreate(
      [{ clientId: dto.clientId, brokerMc, outcome: dto.outcome as any, note: dto.note ?? null, ts: new Date() }],
      { updateOnDuplicate: ['outcome', 'note', 'ts'] }, // один вердикт на (client_id, broker_mc)
    );
    return { ok: true };
  }

  async reputation(mcRaw: string): Promise<BrokerReputation> {
    const brokerMc = normalizeMc(mcRaw);
    const rows = await this.model.findAll({ where: { brokerMc }, attributes: ['outcome'], raw: true });
    const c = { paid: 0, no_issue: 0, slow: 0, flaked: 0, double_brokered: 0 };
    for (const r of rows as any[]) if (c[r.outcome] != null) c[r.outcome]++;
    const n = rows.length;
    return {
      brokerMc,
      level: deriveLevel(n, c),
      n,
      paid: c.paid, noIssue: c.no_issue, slow: c.slow, flaked: c.flaked, doubleBrokered: c.double_brokered,
    };
  }
}

export function deriveLevel(
  n: number,
  c: { paid: number; no_issue: number; slow: number; flaked: number; double_brokered: number },
): BrokerReputation['level'] {
  if (n < REPORT_MIN) return 'thin';
  const negPct = (c.flaked + c.double_brokered) / n;
  if (c.double_brokered >= 2 || negPct > 0.4) return 'bad';
  if (negPct < 0.15 && c.slow / n < 0.3) return 'good';
  return 'mixed';
}
