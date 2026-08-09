import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MembershipStatus, RoleCode } from '../generated/prisma/enums.js';

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
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  refreshToken?: string;
}

export class CurrentContextDto {
  @IsUUID()
  membershipId!: string;
}

export class CreateMembershipDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  institutionalUsername!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsEnum(RoleCode, { each: true })
  roles!: RoleCode[];
}

export class UpdateMembershipDto {
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  institutionalUsername?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsEnum(RoleCode, { each: true })
  roles?: RoleCode[];
}

export class InvitationAcceptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  invitationToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  password!: string;
}

export class ActivationChallengeCompleteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  activationCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  institutionalUsername!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  password!: string;
}

export class PasswordRecoveryRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  identifier!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  tenantHandle?: string;
}

export class PasswordRecoveryConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  resetToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  password!: string;
}
