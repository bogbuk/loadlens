import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Крауд-база грузов: полный набор полей, извлекаемых DAT_GQL.mapResult.
// С 2026-07-17 (осознанное решение) храним и контакты брокера/comments (PII) — только храним;
// читающие эндпоинты (CrowdLoad/PartnerLoad) их не отдают.
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

  // --- гео (полные города) ---
  @Column({ type: DataType.TEXT, allowNull: true, field: 'origin_city' })
  originCity: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'origin_state' })
  originState: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'dest_city' })
  destCity: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'dest_state' })
  destState: string | null;

  // --- груз ---
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'length_ft' })
  lengthFt: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'equipment_code' })
  equipmentCode: string | null; // сырой гранулярный код DAT (DD/RGN/FD...)

  @Column({ type: DataType.TEXT, allowNull: true, field: 'full_partial' })
  fullPartial: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'trip_method' })
  tripMethod: string | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'dest_deadhead_miles' })
  destDeadheadMiles: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'rate_basis' })
  rateBasis: string | null;

  // --- broker-trust ---
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'credit_score' })
  creditScore: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'days_to_pay' })
  daysToPay: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'credit_as_of' })
  creditAsOf: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'broker_city' })
  brokerCity: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'broker_state' })
  brokerState: string | null;

  // --- флаги ---
  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'is_factorable' })
  isFactorable: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'is_assurable' })
  isAssurable: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'is_negotiable' })
  isNegotiable: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'has_tia_membership' })
  hasTiaMembership: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'from_private_network' })
  fromPrivateNetwork: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'is_obfuscated' })
  isObfuscated: boolean | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'book_now' })
  bookNow: boolean | null;

  // --- booking / конкуренция ---
  @Column({ type: DataType.TEXT, allowNull: true, field: 'booking_method' })
  bookingMethod: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'booking_url' })
  bookingUrl: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'bid_count' })
  bidCount: number | null;

  // --- даты (ISO-строки DAT; TEXT — лексикографический порядок совпадает с хронологией) ---
  @Column({ type: DataType.TEXT, allowNull: true, field: 'serviced_when' })
  servicedWhen: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'posting_expires_when' })
  postingExpiresWhen: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'presentation_date' })
  presentationDate: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'pickup_earliest' })
  pickupEarliest: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'pickup_latest' })
  pickupLatest: string | null;

  // --- идентификаторы постера/офиса ---
  @Column({ type: DataType.TEXT, allowNull: true, field: 'dot_number' })
  dotNumber: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'carrier_mc' })
  carrierMc: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'freight_forwarder_mc' })
  freightForwarderMc: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'combined_office_id' })
  combinedOfficeId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'headquarters_id' })
  headquartersId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'poster_user_id' })
  posterUserId: string | null;

  // --- рынок ---
  @Column({ type: DataType.FLOAT, allowNull: true, field: 'estimated_rate_per_mile' })
  estimatedRatePerMile: number | null;

  // --- PII (по решению 2026-07-17): храним, наружу не отдаём ---
  @Column({ type: DataType.TEXT, allowNull: true })
  comments: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'contact_email' })
  contactEmail: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'contact_phone' })
  contactPhone: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'preferred_contact_method' })
  preferredContactMethod: string | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'first_seen' })
  firstSeen: Date;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'last_seen' })
  lastSeen: Date;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1, field: 'seen_count' })
  seenCount: number;
}
