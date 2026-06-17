import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Крауд-база грузов. Хранится агрегат для медиан по lane и плотности рынков.
// PII (контакты/телефоны) не принимается и не хранится — фильтруется на клиенте + DTO.
@Table({
  tableName: 'loads',
  timestamps: false,
  indexes: [
    { name: 'uniq_board_load', unique: true, fields: ['board', 'load_id'] },
    { name: 'idx_lane', fields: ['origin_market', 'dest_market', 'equipment'] },
    { name: 'idx_origin_market', fields: ['origin_market'] },
    { name: 'idx_dest_market', fields: ['dest_market'] },
    { name: 'idx_last_seen', fields: ['last_seen'] },
  ],
})
export class Load extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  board: string; // 'dat' | 'truckstop'

  @Column({ type: DataType.TEXT, allowNull: false, field: 'load_id' })
  loadId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'origin_market' })
  originMarket: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'dest_market' })
  destMarket: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  equipment: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'group_key' })
  groupKey: string; // lane: board|origin>dest|equipment

  @Column({ type: DataType.INTEGER, allowNull: true })
  rate: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'loaded_miles' })
  loadedMiles: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'deadhead_miles' })
  deadheadMiles: number | null;

  // true RPM (rate / (loaded + deadhead)) * 100 — храним центами/милю, чтобы остаться в INTEGER.
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'rpm_cents' })
  rpmCents: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  weight: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'broker_mc' })
  brokerMc: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'broker_name' })
  brokerName: string | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'first_seen' })
  firstSeen: Date;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'last_seen' })
  lastSeen: Date;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1, field: 'seen_count' })
  seenCount: number;
}
