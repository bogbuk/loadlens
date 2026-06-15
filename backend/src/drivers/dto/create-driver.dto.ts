import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DRIVER_STATUS, EQUIPMENT } from '../driver.model';
import { DriverHosDto } from './driver-hos.dto';

export class CreateDriverDto {
  @IsString() @MaxLength(64) @Matches(/^[^\n\r]{1,64}$/)
  name: string;

  // Market key CITY_ST, напр. CHICAGO_IL. Пусто допустимо (рынок задаётся позже).
  @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{0,48}$/)
  currentMarket?: string;

  @IsOptional() @IsIn(EQUIPMENT as unknown as string[])
  equipment?: string;

  @IsOptional() @IsNumber() @Min(0)
  costPerMile?: number;

  @IsOptional() @IsString() @MaxLength(48) @Matches(/^[A-Z0-9 ._-]{0,48}$/)
  homeBase?: string;

  @IsOptional() @IsIn(DRIVER_STATUS as unknown as string[])
  status?: string;

  // { remainingDrive, remainingOnDuty, remainingCycle } в минутах. По умолчанию — «свежий» в сервисе.
  @IsOptional() @ValidateNested() @Type(() => DriverHosDto)
  hos?: DriverHosDto;
}
