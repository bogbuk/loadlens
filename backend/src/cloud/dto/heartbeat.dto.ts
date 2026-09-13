import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class HeartbeatDto {
  @IsIn(['ok', 'logged_out', 'stale'])
  state: 'ok' | 'logged_out' | 'stale';

  @IsInt() @Min(0)
  loadsSeen: number;

  // epoch ms последнего FindLoads в облачной вкладке (null — не было с последнего reload)
  @IsOptional() @IsInt() @Min(0)
  lastFindLoadsAt?: number | null;
}
