import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Кэш ответа FMCSA по MC (Fraud Shield). data — Authority из authority.ts.
@Table({ tableName: 'fmcsa_authority', timestamps: false })
export class FmcsaAuthority extends Model {
  @Column({ type: DataType.TEXT, primaryKey: true })
  mc: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  data: object;

  @Column({ type: DataType.DATE, allowNull: false, field: 'fetched_at' })
  fetchedAt: Date;
}
