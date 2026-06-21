import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Журнал отправленных алертов: дедуп (один груз не шлём дважды в пределах TTL) + база для soft-cap.
// Семантический ключ дедупа приходит от расширения (board|origin>dest|equip|rate|miles|mc).
@Table({
  tableName: 'alert_sends',
  underscored: true,
  timestamps: false,
  indexes: [
    { name: 'idx_alert_sends_user_key', unique: true, fields: ['user_id', 'dedup_key'] },
    { name: 'idx_alert_sends_user_sent', fields: ['user_id', 'sent_at'] },
  ],
})
export class AlertSend extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  // FK → users.id; каскад: удаление аккаунта уносит журнал алертов.
  @Column({
    type: DataType.UUID, allowNull: false, field: 'user_id',
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'dedup_key' })
  dedupKey: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'sent_at' })
  sentAt: Date;
}
