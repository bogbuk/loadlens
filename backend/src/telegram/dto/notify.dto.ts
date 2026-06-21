import {
  ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Один подошедший груз для релея в Telegram. Только бизнес-поля (без PII — контакты режутся в расширении).
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

  @IsOptional() @IsInt() @Min(0)
  creditScore?: number;
}

export class NotifyDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => NotifyItemDto)
  items: NotifyItemDto[];
}
