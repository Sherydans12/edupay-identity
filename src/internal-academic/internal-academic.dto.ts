import { Type } from 'class-transformer';
import { IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { RoleCode } from '../generated/prisma/enums.js';

export type ExpectedAcademicRole = typeof RoleCode.STUDENT | typeof RoleCode.TEACHER;

export class InternalActorDto {
  @IsUUID('4')
  identityUserId!: string;

  @IsUUID('4')
  sessionId!: string;

  @IsUUID('4')
  membershipId!: string;

  @IsUUID('4')
  tenantId!: string;
}

export class ResolveIdentityUserDto {
  @ValidateNested()
  @Type(() => InternalActorDto)
  actor!: InternalActorDto;

  @IsUUID('4')
  targetIdentityUserId!: string;

  @IsIn([RoleCode.STUDENT, RoleCode.TEACHER])
  expectedRole!: ExpectedAcademicRole;
}

/**
 * Exact, non-enumerative membership verification for an Academic-owned
 * sensitive module. The target id is derived from an already tenant-scoped
 * Academic record; no browser-provided tenant or role is trusted.
 */
export class VerifyTenantMembershipDto {
  @ValidateNested()
  @Type(() => InternalActorDto)
  actor!: InternalActorDto;

  @IsUUID('4')
  targetIdentityUserId!: string;
}

export class ResolveEligiblePersonnelDto {
  @ValidateNested()
  @Type(() => InternalActorDto)
  actor!: InternalActorDto;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  institutionalUsername!: string;
}
