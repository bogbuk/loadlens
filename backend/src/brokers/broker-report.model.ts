import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Crowdsourced отзывы о брокерах по MC. Один актуальный вердикт на (client_id, broker_mc) — upsert,
// чтобы один пользователь не накручивал счётчики. Анонимно по client_id (UUID расширения).
export const OUTCOMES = ['paid', 'no_issue', 'slow', 'flaked', 'double_brokered'] as const;
export type Outcome = (typeof OUTCOMES)[number];

@Table({
  tableName: 'broker_reports',
  timestamps: false,
  indexes: [
    { name: 'uniq_client_broker', unique: true, fields: ['client_id', 'broker_mc'] },
    { name: 'idx_broker_mc', fields: ['broker_mc'] },
  ],
})
export class BrokerReport extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'client_id' })
  clientId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'broker_mc' })
  brokerMc: string;

  @Column({ type: DataType.ENUM(...OUTCOMES), allowNull: false })
  outcome: Outcome;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  ts: Date;
}
