import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'users', underscored: true, timestamps: true })
export class User extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.TEXT, allowNull: false, unique: true })
  email: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'password_hash' })
  passwordHash: string;

  @Column({ type: DataType.ENUM('free', 'pro'), allowNull: false, defaultValue: 'free' })
  plan: 'free' | 'pro';

  // Роль: 'user' (по умолчанию) | 'admin'. Назначается из ADMIN_EMAIL (bootstrap + апгрейд на login).
  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'user' })
  role: 'user' | 'admin';

  // Блокировка: заблокированный юзер не может логиниться/рефрешиться.
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  blocked: boolean;

  // Telegram-алерты: chat_id привязанного чата, одноразовый токен привязки (/start <token>), вкл/выкл.
  @Column({ type: DataType.TEXT, allowNull: true, field: 'telegram_chat_id' })
  telegramChatId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'telegram_link_token' })
  telegramLinkToken: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'alerts_enabled' })
  alertsEnabled: boolean;

  // Сброс пароля: sha256 одноразового кода (не плейн) + epoch ms истечения (TTL 30 мин).
  @Column({ type: DataType.TEXT, allowNull: true, field: 'password_reset_token_hash' })
  passwordResetTokenHash: string | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'password_reset_expires' })
  passwordResetExpires: number | null;
}
