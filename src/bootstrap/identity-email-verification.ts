import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import {
  LoginIdentifierKind,
  RoleCode,
  RoleScope,
  TenantRealmStatus,
} from '../generated/prisma/enums.js';
import { IdentifierNormalizationService } from '../auth/identifier-normalization.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { maskEmail } from './tenant-admin-bootstrap.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDENTITY_EMAIL_VERIFICATION_USAGE =
  'Usage: pnpm operator:verify-email-state -- --tenant-id <canonical-tenant-uuid> --username <existing-username> --email <expected-email>';

export interface IdentityEmailVerificationInput {
  readonly tenantId: string;
  readonly username: string;
  readonly email: string;
}

export interface IdentityEmailVerificationResult {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenantId: string;
  readonly username: string;
  readonly destinationEmail: string;
  readonly emailIdentifierCount: number;
  readonly emailDestinationMatches: boolean;
  readonly emailVerified: boolean;
  readonly tenantAdminPresent: boolean;
}

export class IdentityEmailVerificationConflictError extends Error {}

export class IdentityEmailVerificationUsageError extends Error {}

export class IdentityEmailVerificationGateError extends Error {
  readonly failedPostconditions: readonly string[];

  constructor(failedPostconditions: readonly string[]) {
    super(`Required postconditions failed: ${failedPostconditions.join(', ')}.`);
    this.name = 'IdentityEmailVerificationGateError';
    this.failedPostconditions = failedPostconditions;
  }
}

export function getIdentityEmailVerificationGateFailures(
  result: IdentityEmailVerificationResult,
): readonly string[] {
  const failures: string[] = [];
  if (result.emailIdentifierCount !== 1) failures.push('emailIdentifierCount === 1');
  if (!result.emailDestinationMatches) failures.push('emailDestinationMatches === true');
  if (!result.emailVerified) failures.push('emailVerified === true');
  if (!result.tenantAdminPresent) failures.push('tenantAdminPresent === true');
  return failures;
}

export function getIdentityEmailVerificationExitCode(
  result: IdentityEmailVerificationResult,
): 0 | 1 {
  return getIdentityEmailVerificationGateFailures(result).length === 0 ? 0 : 1;
}

export function assertIdentityEmailVerificationPostconditions(
  result: IdentityEmailVerificationResult,
): void {
  const failures = getIdentityEmailVerificationGateFailures(result);
  if (failures.length > 0) throw new IdentityEmailVerificationGateError(failures);
}

export function parseIdentityEmailVerificationArguments(
  args: readonly string[],
): IdentityEmailVerificationInput | { readonly help: true } {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--tenant-id', '--username', '--email'].includes(argument)) {
      throw new IdentityEmailVerificationUsageError(`Unknown option: ${argument}`);
    }
    if (values.has(argument)) throw new IdentityEmailVerificationUsageError(`Specify ${argument} once.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new IdentityEmailVerificationUsageError(`Missing value for ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }

  return {
    tenantId: requiredValue(values, '--tenant-id').toLowerCase(),
    username: requiredValue(values, '--username'),
    email: requiredValue(values, '--email'),
  };
}

function requiredValue(values: ReadonlyMap<string, string>, option: string): string {
  const value = values.get(option);
  if (!value) throw new IdentityEmailVerificationUsageError(`${option} is required.`);
  return value;
}

@Injectable()
export class IdentityEmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalization: IdentifierNormalizationService,
  ) {}

  async verify(input: IdentityEmailVerificationInput): Promise<IdentityEmailVerificationResult> {
    const tenantId = input.tenantId.toLowerCase();
    const username = this.normalization.normalizeUsername(input.username);
    const email = this.normalization.normalizeEmail(input.email);
    this.assertNormalizedInputs(tenantId, username, email);

    const tenant = await this.prisma.tenantRealm.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.status !== TenantRealmStatus.ACTIVE) {
      this.conflict('The requested Identity account could not be resolved.');
    }

    const usernameIdentifiers = await this.prisma.loginIdentifier.findMany({
      where: {
        tenantRealmId: tenantId,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: username,
      },
      select: { userId: true },
    });
    if (usernameIdentifiers.length !== 1) {
      this.conflict('The requested Identity account could not be resolved.');
    }

    const userId = usernameIdentifiers[0]!.userId;
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { userId, tenantRealmId: tenantId },
      select: { id: true },
    });
    if (memberships.length !== 1) {
      this.conflict('The requested Identity membership is not unambiguous.');
    }

    // EMAIL identifiers are global. They intentionally have a null tenantRealmId;
    // resolve the tenant-scoped USERNAME first, then inspect EMAIL by userId only.
    const emailIdentifiers = await this.prisma.loginIdentifier.findMany({
      where: { userId, kind: LoginIdentifierKind.EMAIL },
      select: { normalizedValue: true, verifiedAt: true },
    });
    if (emailIdentifiers.length > 1) {
      this.conflict('The requested Identity account has ambiguous email state.');
    }

    const emailIdentifier = emailIdentifiers[0];
    const tenantAdminPresent = (await this.prisma.membershipRole.count({
      where: {
        membershipId: memberships[0]!.id,
        role: { code: RoleCode.TENANT_ADMIN, scope: RoleScope.TENANT },
      },
    })) > 0;
    const emailDestinationMatches = emailIdentifier?.normalizedValue === email;

    return {
      userId,
      membershipId: memberships[0]!.id,
      tenantId,
      username,
      destinationEmail: maskEmail(email),
      emailIdentifierCount: emailIdentifiers.length,
      emailDestinationMatches,
      emailVerified: emailDestinationMatches && emailIdentifier?.verifiedAt !== null,
      tenantAdminPresent,
    };
  }

  private assertNormalizedInputs(tenantId: string, username: string, email: string): void {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new IdentityEmailVerificationUsageError('The canonical tenant ID must be a UUID.');
    }
    if (!username || username.length > 128) {
      throw new IdentityEmailVerificationUsageError('The username must contain between 1 and 128 characters.');
    }
    if (!isEmail(email) || email.length > 320) {
      throw new IdentityEmailVerificationUsageError('The expected email must be valid.');
    }
  }

  private conflict(message: string): never {
    throw new IdentityEmailVerificationConflictError(message);
  }
}
