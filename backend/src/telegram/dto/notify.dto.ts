import {
  ArrayMaxSize, IsArray, IsEmail, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Один подошедший груз для релея в Telegram. Бизнес-поля + (осознанно) дата пикапа и контакт брокера.
export class NotifyItemDto {
  // семантический ключ дедупа от расширения
  @IsString() @MaxLength(200) @Matches(/^[^\n\r]{1,200}$/)
  dedupKey: string;

  @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{1,48}$/)
  originMarket: string;

  @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{1,48}$/)
  destMarket: string;

  @IsString() @MaxLength(8) @Matches(/^[A-Za-z]{1,8}$/)
  equipment: string;

  @IsNumber() @Min(0)
  rate: number;

  @IsNumber() @Min(0)
  loadedMiles: number;

  @IsOptional() @IsNumber() @Min(0)
  deadheadMiles?: number;

  @IsOptional() @IsString() @MaxLength(24) @Matches(/^[0-9]{1,24}$/)
  brokerMc?: string;

  @IsOptional() @IsString() @MaxLength(120) @Matches(/^[^\n\r]{1,120}$/)
  brokerName?: string;

  @IsOptional() @IsInt() @Min(0)
  creditScore?: number;

  // Комментарий груза из выдачи DAT (может содержать email/детали — уходит только в DM пользователя).
  @IsOptional() @IsString() @MaxLength(300) @Matches(/^[^\n\r]{1,300}$/)
  comments?: string;

  // Дата пикапа из выдачи DAT (availability.earliest) — напр. "2026-06-14". Не PII.
  @IsOptional() @IsString() @MaxLength(32) @Matches(/^[0-9T:\-+.Z ]{1,32}$/)
  pickupDate?: string;

  // Контакт брокера (PII) — шлём по явному решению, чтобы диспетчер связался сразу.
  @IsOptional() @IsEmail() @MaxLength(120)
  contactEmail?: string;

  @IsOptional() @IsString() @MaxLength(24) @Matches(/^[0-9+().\- ]{5,24}$/)
  contactPhone?: string;
}

export class NotifyDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => NotifyItemDto)
  items: NotifyItemDto[];
}
