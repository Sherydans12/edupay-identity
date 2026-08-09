import { Type } from 'class-transformer';
import { IsIn, IsUUID, ValidateNested } from 'class-validator';
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
