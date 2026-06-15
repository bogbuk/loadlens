import { Column, DataType, Model, Table } from 'sequelize-typescript';

export const EQUIPMENT = ['V', 'R', 'F', 'SD', 'PO'] as const;
export const DRIVER_STATUS = ['active', 'available', 'off'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export type DriverStatus = (typeof DRIVER_STATUS)[number];

// HOS-остаток водителя в минутах (стартовое состояние для planner.stepHos).
export interface DriverHos {
  remainingDrive: number;
  remainingOnDuty: number;
  remainingCycle: number;
}

@Table({
  tableName: 'drivers',
  underscored: true,
  timestamps: true,
  indexes: [{ name: 'idx_drivers_user', fields: ['user_id'] }],
})
export class Driver extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  // FK → users.id; каскад: удаление аккаунта (DELETE /users/me) уносит водителей.
  @Column({
    type: DataType.UUID, allowNull: false, field: 'user_id',
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  name: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'current_market' })
  currentMarket: string | null;

  @Column({ type: DataType.ENUM(...EQUIPMENT), allowNull: true })
  equipment: Equipment | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'cost_per_mile' })
  costPerMile: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'home_base' })
  homeBase: string | null;

  @Column({ type: DataType.ENUM(...DRIVER_STATUS), allowNull: false, defaultValue: 'available' })
  status: DriverStatus;

  @Column({ type: DataType.JSONB, allowNull: false })
  hos: DriverHos;
}
