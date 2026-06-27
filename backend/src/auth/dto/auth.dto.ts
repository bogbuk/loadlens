import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CredentialsDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail() @MaxLength(254)
  email: string;

  @IsString() @MinLength(8) @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @IsString() @MaxLength(2048)
  refreshToken: string;
}

export class ForgotDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail() @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(64)
  token: string;

  @IsString() @MinLength(8) @MaxLength(128)
  newPassword: string;
}
