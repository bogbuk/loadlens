import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Кэш дорожных дистанций между рынками. Дистанции стабильны → кэш почти вечный
// (экономит rate-limit публичного OSRM).
@Table({
  tableName: 'lane_distances',
  timestamps: false,
  indexes: [{ name: 'uniq_from_to', unique: true, fields: ['from_market', 'to_market'] }],
})
export class LaneDistance extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'from_market' })
  fromMarket: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'to_market' })
  toMarket: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'road_miles' })
  roadMiles: number;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'osrm' })
  source: string; // 'osrm' | 'haversine'

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  ts: Date;
}
