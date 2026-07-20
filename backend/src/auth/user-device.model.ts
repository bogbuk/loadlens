import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Устройства аккаунта: одна строка = одна установка расширения (clientId из chrome.storage.local).
// Вытеснение сверх лимита — удаление строки, отдельного состояния «забанен» нет.
@Table({
  tableName: 'user_devices',
  underscored: true,
  timestamps: true,
  indexes: [{ name: 'uniq_user_client', unique: true, fields: ['user_id', 'client_id'] }],
})
export class UserDevice extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  // FK → users.id; каскад: удаление аккаунта (DELETE /users/me) уносит устройства.
  @Column({
    type: DataType.UUID, allowNull: false, field: 'user_id',
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'client_id' })
  clientId: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'last_seen_at' })
  lastSeenAt: Date;
}
