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

  // Версия сессий: инкремент инвалидирует все ранее выпущенные токены (смена/сброс пароля).
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'token_version' })
  tokenVersion: number;

  // Сколько раз у аккаунта вытеснялось устройство сверх лимита. Сигнал шеринга для админки;
  // автоматических действий по нему НЕ предпринимаем.
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'device_evictions' })
  deviceEvictions: number;

  // Cloud browser (Pro Cloud): включает админ. Без флага /cloud/* отвечает 403.
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'cloud_enabled' })
  cloudEnabled: boolean;

  // Pro trial (спека 2026-09-29): до какого момента аккаунт — Pro независимо от plan; метка выдачи
  // (не NULL → повторно не выдаём); стадия сообщений бота 0/1/2. BIGINT epoch ms — pg отдаёт строкой.
  @Column({ type: DataType.BIGINT, allowNull: true, field: 'pro_until' })
  proUntil: number | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'trial_started_at' })
  trialStartedAt: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0, field: 'trial_notice' })
  trialNotice: number;

  // Подписка Paddle (спека 2026-10-01-paddle-billing-design): пишет только вебхук. Статус — как у Paddle
  // (active/trialing/past_due/paused/canceled); метки — epoch ms, pg отдаёт BIGINT строкой.
  @Column({ type: DataType.TEXT, allowNull: true, field: 'paddle_customer_id' })
  paddleCustomerId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'paddle_subscription_id' })
  paddleSubscriptionId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'subscription_status' })
  subscriptionStatus: string | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'subscription_renews_at' })
  subscriptionRenewsAt: number | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'subscription_ends_at' })
  subscriptionEndsAt: number | null;

  // occurred_at последнего применённого события: старые/повторные вебхуки игнорируются.
  @Column({ type: DataType.BIGINT, allowNull: true, field: 'paddle_event_at' })
  paddleEventAt: number | null;
}
