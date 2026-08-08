import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class LoginDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

export class LoginDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  tenantHandle?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(320)
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  password!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LoginDeviceDto)
  device?: LoginDeviceDto;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  refreshToken!: string;
}

export class CurrentContextDto {
  @IsUUID()
  membershipId!: string;
}
