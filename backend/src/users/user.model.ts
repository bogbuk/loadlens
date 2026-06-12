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
}
