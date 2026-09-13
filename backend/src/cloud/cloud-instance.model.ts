import { Column, DataType, Model, Table } from 'sequelize-typescript';

export type CloudStatus = 'starting' | 'ok' | 'logged_out' | 'stale' | 'stopped' | 'error';
export const CLOUD_STATUSES: CloudStatus[] = ['starting', 'ok', 'logged_out', 'stale', 'stopped', 'error'];

// Один облачный браузер на пользователя (unique user_id). Coolify Service хранит контейнер и volume;
// здесь — связка user → service, статус по heartbeat/watchdog и пароль экрана.
@Table({ tableName: 'cloud_instances', underscored: true, timestamps: true })
export class CloudInstance extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({
    type: DataType.UUID, allowNull: false, unique: true, field: 'user_id',
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'coolify_service_uuid' })
  coolifyServiceUuid: string | null;

  // FQDN экрана, который Coolify выдал сервису (SERVICE_FQDN_BROWSER_6080), без схемы
  @Column({ type: DataType.TEXT, allowNull: true, field: 'screen_domain' })
  screenDomain: string | null;

  // Пароль noVNC: генерим сами, в контейнер уходит через Coolify env NOVNC_PASSWORD. Ротация на Enable.
  @Column({ type: DataType.TEXT, allowNull: true, field: 'vnc_password' })
  vncPassword: string | null;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'starting' })
  status: CloudStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_heartbeat_at' })
  lastHeartbeatAt: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'loads_seen' })
  loadsSeen: number;

  // Последний статус, о котором пользователю ушёл DM (чтобы слать один раз на смену статуса)
  @Column({ type: DataType.TEXT, allowNull: true, field: 'last_state_notified' })
  lastStateNotified: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'disabled_at' })
  disabledAt: Date | null;
}
