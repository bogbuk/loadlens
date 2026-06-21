import { IsBoolean } from 'class-validator';

export class AlertsDto {
  @IsBoolean()
  enabled: boolean;
}
