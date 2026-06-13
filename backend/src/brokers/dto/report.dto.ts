import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OUTCOMES } from '../broker-report.model';

export class ReportDto {
  @IsString() @MaxLength(64)
  clientId: string;

  // MC-номер брокера: цифры, опц. префикс MC/ (нормализуем на сервере)
  @IsString() @MaxLength(24) @Matches(/^[A-Za-z0-9 .#/-]{1,24}$/)
  brokerMc: string;

  @IsIn(OUTCOMES as unknown as string[])
  outcome: string;

  @IsOptional() @IsString() @MaxLength(280) @Matches(/^[^\n\r]{0,280}$/)
  note?: string;
}
