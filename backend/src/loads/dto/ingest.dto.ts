import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional,
  IsString, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';

// Whitelist полей груза — полный набор, извлекаемый DAT_GQL.mapResult.
// С 2026-07-17 (осознанное решение) принимаем и контакты брокера/comments (PII) — только храним;
// читающие эндпоинты их не отдают. POST открыт без авторизации, поэтому каждое поле жёстко типизировано.
export class LoadItemDto {
  @IsIn(['dat', 'truckstop'])
  board: string;

  @IsString() @MaxLength(64)
  loadId: string;

  @IsString() @MaxLength(80) @Matches(/^[^\n\r]{1,80}$/)
  originMarket: string;

  @IsString() @MaxLength(80) @Matches(/^[^\n\r]{1,80}$/)
  destMarket: string;

  @IsString() @MaxLength(8)
  equipment: string;

  @IsString() @MaxLength(180) @Matches(/^[^\n\r]{1,180}$/)
  groupKey: string;

  @IsOptional() @IsInt() @Min(0)
  rate?: number | null;

  @IsOptional() @IsInt() @Min(0)
  loadedMiles?: number | null;

  @IsOptional() @IsInt() @Min(0)
  deadheadMiles?: number | null;

  @IsOptional() @IsInt() @Min(0)
  weight?: number | null;

  @IsOptional() @IsString() @MaxLength(20)
  brokerMc?: string | null;

  @IsOptional() @IsString() @MaxLength(120)
  brokerName?: string | null;

  // --- гео (полные города; market-ключи выше остаются каноном для lane) ---
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[^\n\r]{1,80}$/)
  originCity?: string | null;

  @IsOptional() @IsString() @MaxLength(8)
  originState?: string | null;

  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[^\n\r]{1,80}$/)
  destCity?: string | null;

  @IsOptional() @IsString() @MaxLength(8)
  destState?: string | null;

  // --- груз ---
  @IsOptional() @IsInt() @Min(0)
  lengthFt?: number | null;

  // сырой гранулярный код трейлера DAT (DD/RGN/FD...), рядом с нормализованной группой equipment
  @IsOptional() @IsString() @MaxLength(8)
  equipmentCode?: string | null;

  @IsOptional() @IsString() @MaxLength(12)
  fullPartial?: string | null; // FULL / PARTIAL / BOTH

  @IsOptional() @IsString() @MaxLength(16)
  tripMethod?: string | null; // ROAD / PCMILER

  @IsOptional() @IsNumber() @Min(0)
  destDeadheadMiles?: number | null;

  @IsOptional() @IsString() @MaxLength(16)
  rateBasis?: string | null; // FLAT / PER_MILE

  // --- broker-trust ---
  @IsOptional() @IsInt() @Min(0)
  creditScore?: number | null;

  @IsOptional() @IsNumber() @Min(0)
  daysToPay?: number | null;

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[^\n\r]{1,40}$/)
  creditAsOf?: string | null;

  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[^\n\r]{1,80}$/)
  brokerCity?: string | null;

  @IsOptional() @IsString() @MaxLength(8)
  brokerState?: string | null;

  // --- флаги ---
  @IsOptional() @IsBoolean()
  isFactorable?: boolean | null;

  @IsOptional() @IsBoolean()
  isAssurable?: boolean | null;

  @IsOptional() @IsBoolean()
  isNegotiable?: boolean | null;

  @IsOptional() @IsBoolean()
  hasTiaMembership?: boolean | null;

  @IsOptional() @IsBoolean()
  fromPrivateNetwork?: boolean | null;

  @IsOptional() @IsBoolean()
  isObfuscated?: boolean | null;

  @IsOptional() @IsBoolean()
  bookNow?: boolean | null;

  // --- booking / конкуренция ---
  @IsOptional() @IsString() @MaxLength(32)
  bookingMethod?: string | null; // BOOK_NOW / ...

  @IsOptional() @IsString() @MaxLength(500) @Matches(/^[^\n\r]{1,500}$/)
  bookingUrl?: string | null;

  @IsOptional() @IsInt() @Min(0)
  bidCount?: number | null;

  // --- даты (ISO-строки как отдаёт DAT; TEXT в БД) ---
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[^\n\r]{1,40}$/)
  servicedWhen?: string | null;

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[^\n\r]{1,40}$/)
  postingExpiresWhen?: string | null;

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[^\n\r]{1,40}$/)
  presentationDate?: string | null;

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[^\n\r]{1,40}$/)
  pickupEarliest?: string | null; // флаттен availability.earliest

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[^\n\r]{1,40}$/)
  pickupLatest?: string | null;

  // --- идентификаторы постера/офиса (в схеме DAT то число, то строка — клиент приводит к строке) ---
  @IsOptional() @IsString() @MaxLength(20)
  dotNumber?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  carrierMc?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  freightForwarderMc?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  combinedOfficeId?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  headquartersId?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  posterUserId?: string | null;

  // --- рынок ---
  @IsOptional() @IsNumber() @Min(0)
  estimatedRatePerMile?: number | null;

  // --- PII (по решению 2026-07-17): храним, наружу не отдаём ---
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^[^\n\r]{1,500}$/)
  comments?: string | null;

  @IsOptional() @IsString() @MaxLength(120) @Matches(/^[^\n\r\s]{3,120}$/)
  contactEmail?: string | null;

  @IsOptional() @IsString() @MaxLength(24) @Matches(/^[0-9+().\- ]{5,24}$/)
  contactPhone?: string | null;

  @IsOptional() @IsString() @MaxLength(24)
  preferredContactMethod?: string | null; // EMAIL / PRIMARY_PHONE / ...
}

export class IngestLoadsDto {
  @IsString() @MaxLength(64)
  clientId: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => LoadItemDto)
  items: LoadItemDto[];
}
