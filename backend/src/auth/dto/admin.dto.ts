import { IsBoolean, IsIn } from 'class-validator';

export class SetPlanDto {
  @IsIn(['free', 'pro'])
  plan: 'free' | 'pro';
}

export class SetBlockedDto {
  @IsBoolean()
  blocked: boolean;
}

export class SetCloudDto {
  @IsBoolean()
  enabled: boolean;
}
