import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional,
  IsString, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';

// Whitelist полей груза. contact/телефоны/имена диспетчеров СЮДА не входят (PII — режется на клиенте).
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
}

export class IngestLoadsDto {
  @IsString() @MaxLength(64)
  clientId: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => LoadItemDto)
  items: LoadItemDto[];
}
