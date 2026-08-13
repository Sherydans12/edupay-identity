import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { Prisma } from '../generated/prisma/client.js';
import {
  AuditOutcome,
  IdentityUserStatus,
  LoginIdentifierKind,
  MembershipStatus,
  OutboxStatus,
  TenantRealmStatus,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { IdentifierNormalizationService } from '../auth/identifier-normalization.service.js';
import { maskEmail } from './tenant-admin-bootstrap.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const IDENTITY_EMAIL_CORRECTION_USAGE =
  'Usage: pnpm operator:correct-email -- --tenant-id <canonical-tenant-uuid> --username <existing-username> --email <new-email> [--request-id <operator-request-id>]';

export interface IdentityEmailCorrectionInput {
  readonly tenantId: string;
  readonly username: string;
  readonly email: string;
  readonly requestId: string;
}

export interface IdentityEmailCorrectionResult {
  readonly status: 'corrected' | 'already-compatible';
  readonly userId: string;
  readonly membershipId: string;
  readonly tenantId: string;
  readonly username: string;
  readonly destinationEmail: string;
  readonly sessionsRevoked: number;
  readonly passwordResetTokensRevoked: number;
  readonly invitationsRevoked: number;
  readonly activationChallengesRevoked: number;
  readonly requestId: string;
}

export class IdentityEmailCorrectionConflictError extends Error {}

export class IdentityEmailCorrectionUsageError extends Error {}

export function parseIdentityEmailCorrectionArguments(
  args: readonly string[],
): IdentityEmailCorrectionInput | { readonly help: true } {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--tenant-id', '--username', '--email', '--request-id'].includes(argument)) {
      throw new IdentityEmailCorrectionUsageError(`Unknown option: ${argument}`);
    }
    if (values.has(argument)) throw new IdentityEmailCorrectionUsageError(`Specify ${argument} once.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new IdentityEmailCorrectionUsageError(`Missing value for ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }

  const tenantId = requiredValue(values, '--tenant-id').toLowerCase();
  const username = requiredValue(values, '--username');
  const email = requiredValue(values, '--email');
  const requestId = values.get('--request-id') ?? `identity-email-correction:${randomUUID()}`;

  if (!UUID_PATTERN.test(tenantId)) {
    throw new IdentityEmailCorrectionUsageError('--tenant-id must be a canonical UUID.');
  }
  if (username.length === 0 || username.length > 128) {
    throw new IdentityEmailCorrectionUsageError('--username must contain between 1 and 128 characters.');
  }
  if (!isEmail(email) || email.length > 320) {
    throw new IdentityEmailCorrectionUsageError('--email must be a valid email address.');
  }
  if (!SAFE_REQUEST_ID_PATTERN.test(requestId)) {
    throw new IdentityEmailCorrectionUsageError(
      '--request-id must contain only letters, numbers, dot, underscore, colon, or hyphen.',
    );
  }

  return { tenantId, username, email, requestId };
}

function requiredValue(values: ReadonlyMap<string, string>, option: string): string {
  const value = values.get(option);
  if (!value) throw new IdentityEmailCorrectionUsageError(`${option} is required.`);
  return value;
}

type CorrectionTransaction = Prisma.TransactionClient;

@Injectable()
export class IdentityEmailCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalization: IdentifierNormalizationService,
  ) {}

  async correct(input: IdentityEmailCorrectionInput): Promise<IdentityEmailCorrectionResult> {
    const tenantId = input.tenantId.toLowerCase();
    const username = this.normalization.normalizeUsername(input.username);
    const email = this.normalization.normalizeEmail(input.email);
    this.assertNormalizedInputs(tenantId, username, email, input.requestId);

    return this.prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenantRealm.findUnique({ where: { id: tenantId } });
      if (!tenant || tenant.status !== TenantRealmStatus.ACTIVE) {
        this.conflict('The requested Identity account could not be resolved.');
      }

      const usernameIdentifiers = await transaction.loginIdentifier.findMany({
        where: {
          tenantRealmId: tenantId,
          kind: LoginIdentifierKind.USERNAME,
          normalizedValue: username,
        },
        include: {
          user: {
            include: {
              loginIdentifiers: true,
              passwordCredential: true,
              memberships: {
                where: { tenantRealmId: tenantId },
              },
            },
          },
        },
      });
      if (usernameIdentifiers.length !== 1) {
        this.conflict('The requested Identity account could not be resolved.');
      }

      const usernameIdentifier = usernameIdentifiers[0]!;
      const user = usernameIdentifier.user;
      if (user.status !== IdentityUserStatus.ACTIVE || !user.passwordCredential || user.memberships.length !== 1) {
        this.conflict('The requested Identity account is not active and unambiguous.');
      }

      const membership = user.memberships[0]!;
      if (membership.status !== MembershipStatus.ACTIVE) {
        this.conflict('The requested Identity membership is not active.');
      }

      const emailIdentifiers = user.loginIdentifiers.filter(({ kind }) => kind === LoginIdentifierKind.EMAIL);
      if (emailIdentifiers.length > 1) {
        this.conflict('The requested Identity account has incompatible email state.');
      }
      const existingEmail = emailIdentifiers[0];

      const owners = await transaction.loginIdentifier.findMany({
        where: { kind: LoginIdentifierKind.EMAIL, normalizedValue: email },
        select: { userId: true },
      });
      if (owners.some(({ userId }) => userId !== user.id)) {
        this.conflict('The replacement email belongs to another Identity user.');
      }

      const pendingInvitations = await transaction.invitation.findMany({
        where: { membershipId: membership.id, acceptedAt: null, revokedAt: null },
        select: { id: true },
      });
      const pendingChallenges = await transaction.activationChallenge.count({
        where: { membershipId: membership.id, consumedAt: null, revokedAt: null },
      });
      const activeSessions = await transaction.session.count({ where: { userId: user.id, revokedAt: null } });
      const validResetTokens = await transaction.passwordResetToken.count({
        where: {
          userId: user.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      const alreadyCompatible =
        existingEmail?.normalizedValue === email &&
        existingEmail.verifiedAt !== null &&
        pendingInvitations.length === 0 &&
        pendingChallenges === 0 &&
        activeSessions === 0 &&
        validResetTokens === 0;
      if (alreadyCompatible) {
        return this.result('already-compatible', {
          userId: user.id,
          membershipId: membership.id,
          tenantId,
          username,
          email,
          requestId: input.requestId,
        });
      }

      const now = new Date();
      if (existingEmail) {
        await transaction.loginIdentifier.update({
          where: { id: existingEmail.id },
          data: {
            normalizedValue: email,
            // An operator correction is the explicit Identity-owned verification step.
            verifiedAt: existingEmail.normalizedValue === email ? (existingEmail.verifiedAt ?? now) : now,
          },
        });
      } else {
        await transaction.loginIdentifier.create({
          data: {
            userId: user.id,
            kind: LoginIdentifierKind.EMAIL,
            normalizedValue: email,
            verifiedAt: now,
          },
        });
      }

      const sessionIds = await this.revokeSessions(transaction, user.id, input.requestId, now);
      const passwordResetTokensRevoked = await transaction.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      const invitationsRevoked = pendingInvitations.length === 0
        ? 0
        : (await transaction.invitation.updateMany({
            where: { id: { in: pendingInvitations.map(({ id }) => id) }, acceptedAt: null, revokedAt: null },
            data: { revokedAt: now },
          })).count;
      if (pendingInvitations.length > 0) {
        await transaction.outboxEvent.updateMany({
          where: {
            aggregateType: 'IdentityEmail',
            aggregateId: { in: pendingInvitations.map(({ id }) => id) },
            eventType: 'identity.email.invitation.v1',
            status: OutboxStatus.PENDING,
          },
          data: { status: OutboxStatus.FAILED, lastError: 'EMAIL_INTENT_REVOKED' },
        });
      }
      const activationChallengesRevoked = await transaction.activationChallenge.updateMany({
        where: { membershipId: membership.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

      await transaction.authAuditEvent.create({
        data: {
          eventType: 'OPERATOR_EMAIL_CORRECTED',
          outcome: AuditOutcome.SUCCESS,
          tenantRealmId: tenantId,
          requestId: input.requestId,
          metadata: {
            userId: user.id,
            membershipId: membership.id,
            emailChanged: existingEmail?.normalizedValue !== email,
            emailVerification: 'operator-established',
            sessionsRevoked: sessionIds.length,
            passwordResetTokensRevoked: passwordResetTokensRevoked.count,
            invitationsRevoked,
            activationChallengesRevoked: activationChallengesRevoked.count,
          } as Prisma.InputJsonObject,
        },
      });

      return this.result('corrected', {
        userId: user.id,
        membershipId: membership.id,
        tenantId,
        username,
        email,
        sessionsRevoked: sessionIds.length,
        passwordResetTokensRevoked: passwordResetTokensRevoked.count,
        invitationsRevoked,
        activationChallengesRevoked: activationChallengesRevoked.count,
        requestId: input.requestId,
      });
    }, { isolationLevel: 'Serializable' });
  }

  private async revokeSessions(
    transaction: CorrectionTransaction,
    userId: string,
    requestId: string,
    now: Date,
  ): Promise<string[]> {
    const sessions = await transaction.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, activeMembershipId: true },
    });
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map(({ id }) => id);
    await transaction.refreshToken.updateMany({
      where: { sessionId: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.session.updateMany({
      where: { id: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: now, revocationReason: 'EMAIL_CORRECTION' },
    });
    for (const session of sessions) {
      await transaction.outboxEvent.create({
        data: {
          eventType: 'identity.session.revoked.v1',
          aggregateType: 'Identity',
          aggregateId: session.id,
          payload: {
            sessionId: session.id,
            userId,
            membershipId: session.activeMembershipId,
            reason: 'EMAIL_CORRECTION',
          } as Prisma.InputJsonObject,
        },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'SESSION_REVOKED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: userId,
          sessionId: session.id,
          requestId,
          metadata: { reason: 'EMAIL_CORRECTION' },
        },
      });
    }
    return sessionIds;
  }

  private result(
    status: IdentityEmailCorrectionResult['status'],
    values: {
      userId: string;
      membershipId: string;
      tenantId: string;
      username: string;
      email: string;
      requestId: string;
      sessionsRevoked?: number;
      passwordResetTokensRevoked?: number;
      invitationsRevoked?: number;
      activationChallengesRevoked?: number;
    },
  ): IdentityEmailCorrectionResult {
    return {
      status,
      userId: values.userId,
      membershipId: values.membershipId,
      tenantId: values.tenantId,
      username: values.username,
      destinationEmail: maskEmail(values.email),
      sessionsRevoked: values.sessionsRevoked ?? 0,
      passwordResetTokensRevoked: values.passwordResetTokensRevoked ?? 0,
      invitationsRevoked: values.invitationsRevoked ?? 0,
      activationChallengesRevoked: values.activationChallengesRevoked ?? 0,
      requestId: values.requestId,
    };
  }

  private assertNormalizedInputs(tenantId: string, username: string, email: string, requestId: string): void {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new IdentityEmailCorrectionUsageError('The canonical tenant ID must be a UUID.');
    }
    if (!username || username.length > 128) {
      throw new IdentityEmailCorrectionUsageError('The username must contain between 1 and 128 characters.');
    }
    if (!isEmail(email) || email.length > 320) {
      throw new IdentityEmailCorrectionUsageError('The replacement email must be valid.');
    }
    if (!SAFE_REQUEST_ID_PATTERN.test(requestId)) {
      throw new IdentityEmailCorrectionUsageError('The request ID is not safe for operator audit correlation.');
    }
  }

  private conflict(message: string): never {
    throw new IdentityEmailCorrectionConflictError(message);
  }
}
