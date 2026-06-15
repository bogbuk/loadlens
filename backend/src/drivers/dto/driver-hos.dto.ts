import { IsInt, Max, Min } from 'class-validator';
export class DriverHosDto {
  @IsInt() @Min(0) @Max(11 * 60) remainingDrive: number;
  @IsInt() @Min(0) @Max(14 * 60) remainingOnDuty: number;
  @IsInt() @Min(0) @Max(70 * 60) remainingCycle: number;
}
