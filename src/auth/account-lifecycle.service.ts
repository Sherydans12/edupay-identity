import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client.js';
import {
  AuditOutcome,
  IdentityUserStatus,
  LoginIdentifierKind,
  MembershipStatus,
  RoleCode,
  RoleScope,
  TenantRealmStatus,
} from '../generated/prisma/enums.js';
import type { Environment } from '../config/environment.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  createInvitationEmail,
  createPasswordRecoveryEmail,
} from '../email/account-lifecycle-email.js';
import { EmailOutboxService } from '../email/email-outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditService } from '../security/audit.service.js';
import { OpaqueTokenService } from '../security/opaque-token.service.js';
import { PasswordHashService } from '../security/argon2.service.js';
import { RateLimitPolicy } from '../security/rate-limit.policy.js';
import { IdentifierNormalizationService } from './identifier-normalization.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import type {
  ActivationChallengeCompleteDto,
  CreateMembershipDto,
  InvitationAcceptDto,
  PasswordRecoveryConfirmDto,
  PasswordRecoveryRequestDto,
  UpdateMembershipDto,
} from './auth.dto.js';
import type { ActiveMembershipContext, AuthPrincipal } from './auth.types.js';

type LifecycleTransaction = Prisma.TransactionClient;

interface MembershipDetails {
  id: string;
  userId: string;
  tenantRealmId: string;
  status: MembershipStatus;
  activatedAt: Date | null;
  tenantRealm: { handle: string; status: TenantRealmStatus };
  user: {
    status: IdentityUserStatus;
    loginIdentifiers?: Array<{
      kind: LoginIdentifierKind;
      tenantRealmId: string | null;
      normalizedValue: string;
    }>;
  };
  roles: Array<{ role: { code: RoleCode } }>;
}

const MANAGED_ROLES = new Set<RoleCode>([RoleCode.STUDENT, RoleCode.TEACHER]);
const TOKEN_EXPIRED_MESSAGE = 'The requested credential is expired or no longer available.';

@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHashService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly normalization: IdentifierNormalizationService,
    private readonly rateLimits: RateLimitPolicy,
    private readonly audit: AuditService,
    private readonly emailOutbox: EmailOutboxService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async provisionMembership(
    principal: AuthPrincipal,
    tenantId: string,
    input: CreateMembershipDto,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    this.assertTenantAdmin(principal, tenantId);
    this.assertManagedRoles(input.roles);
    await this.assertRateLimit('management', [principal.userId, tenantId]);

    const username = this.normalization.normalizeUsername(input.institutionalUsername);
    const email = input.email ? this.normalization.normalizeEmail(input.email) : undefined;

    return this.prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenantRealm.findUnique({ where: { id: tenantId } });
      if (!tenant || tenant.status !== TenantRealmStatus.ACTIVE) this.notFound();

      const existingUsername = await transaction.loginIdentifier.findFirst({
        where: {
          tenantRealmId: tenantId,
          kind: LoginIdentifierKind.USERNAME,
          normalizedValue: username,
        },
        select: { userId: true },
      });

      if (existingUsername) {
        const existingMembership = await transaction.tenantMembership.findUnique({
          where: { userId_tenantRealmId: { userId: existingUsername.userId, tenantRealmId: tenantId } },
          include: {
            roles: { include: { role: true } },
            user: {
              include: {
                loginIdentifiers: {
                  where: { kind: LoginIdentifierKind.EMAIL },
                },
              },
            },
          },
        });

        if (existingMembership && existingMembership.status === MembershipStatus.PENDING_ACTIVATION) {
          const existingRoles = existingMembership.roles.map((r) => r.role.code).sort();
          const requestedRoles = [...input.roles].sort();
          const rolesMatch =
            existingRoles.length === requestedRoles.length &&
            existingRoles.every((role, index) => role === requestedRoles[index]);

          const userEmailIdentifier = existingMembership.user.loginIdentifiers[0]?.normalizedValue;
          const emailMatch =
            (!email && !userEmailIdentifier) || (Boolean(email) && userEmailIdentifier === email);
          const userMatch = !input.userId || input.userId === existingUsername.userId;

          if (rolesMatch && emailMatch && userMatch) {
            return {
              userId: existingMembership.userId,
              membershipId: existingMembership.id,
              tenantId,
              institutionalUsername: username,
              ...(email ? { email } : {}),
              status: existingMembership.status,
              roles: existingRoles,
              activation: {
                emailInvitationAvailable: Boolean(email),
                activationChallengeAvailable: !email,
              },
            };
          }
        }

        this.conflict('The requested membership cannot be created.');
      }

      let user = input.userId
        ? await transaction.identityUser.findUnique({ where: { id: input.userId } })
        : null;
      if (input.userId && !user) this.notFound();

      if (email) {
        const verifiedOwner = await transaction.loginIdentifier.findFirst({
          where: { kind: LoginIdentifierKind.EMAIL, normalizedValue: email, verifiedAt: { not: null } },
          select: { userId: true },
        });
        if (verifiedOwner && user && verifiedOwner.userId !== user.id) {
          this.conflict('The requested membership cannot be created.');
        }
        if (!user && verifiedOwner) {
          user = await transaction.identityUser.findUnique({ where: { id: verifiedOwner.userId } });
        }
      }

      const createdUser = !user;
      if (!user) user = await transaction.identityUser.create({ data: {} });
      if (user.status !== IdentityUserStatus.ACTIVE) this.conflict('The requested membership cannot be created.');

      const existingMembership = await transaction.tenantMembership.findUnique({
        where: { userId_tenantRealmId: { userId: user.id, tenantRealmId: tenantId } },
      });
      if (existingMembership) this.conflict('The requested membership cannot be created.');

      if (email) {
        const existingEmail = await transaction.loginIdentifier.findFirst({
          where: { userId: user.id, kind: LoginIdentifierKind.EMAIL },
        });
        if (existingEmail && existingEmail.normalizedValue !== email) {
          this.conflict('The requested membership cannot be created.');
        }
        if (!existingEmail) {
          await transaction.loginIdentifier.create({
            data: {
              userId: user.id,
              kind: LoginIdentifierKind.EMAIL,
              normalizedValue: email,
            },
          });
        }
      }

      const membership = await transaction.tenantMembership.create({
        data: { userId: user.id, tenantRealmId: tenantId },
      });
      await transaction.loginIdentifier.create({
        data: {
          userId: user.id,
          tenantRealmId: tenantId,
          kind: LoginIdentifierKind.USERNAME,
          normalizedValue: username,
        },
      });

      for (const roleCode of input.roles) {
        const role = await this.ensureTenantRole(transaction, roleCode);
        await transaction.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      }

      if (createdUser) {
        await this.createOutboxEvent(transaction, 'identity.user.created.v1', user.id, {
          userId: user.id,
        });
        await transaction.authAuditEvent.create({
          data: {
            eventType: 'USER_PROVISIONED',
            outcome: AuditOutcome.SUCCESS,
            actorUserId: principal.userId,
            tenantRealmId: tenantId,
            requestId,
          },
        });
      }
      await this.createOutboxEvent(transaction, 'identity.membership.created.v1', membership.id, {
        membershipId: membership.id,
        userId: user.id,
        tenantId,
        roles: [...input.roles].sort(),
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'MEMBERSHIP_CREATED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: principal.userId,
          tenantRealmId: tenantId,
          requestId,
          metadata: {
            membershipId: membership.id,
            roles: [...input.roles].sort(),
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        },
      });

      return {
        userId: user.id,
        membershipId: membership.id,
        tenantId,
        institutionalUsername: username,
        ...(email ? { email } : {}),
        status: MembershipStatus.PENDING_ACTIVATION,
        roles: [...input.roles].sort(),
        activation: {
          emailInvitationAvailable: Boolean(email),
          activationChallengeAvailable: !email,
        },
      };
    });
  }

  async updateMembership(
    principal: AuthPrincipal,
    tenantId: string,
    membershipId: string,
    input: UpdateMembershipDto,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    this.assertTenantAdmin(principal, tenantId);
    if (input.roles) this.assertManagedRoles(input.roles);
    await this.assertRateLimit('management', [principal.userId, tenantId, membershipId]);

    return this.prisma.$transaction(async (transaction) => {
      const current = await this.findMembership(transaction, tenantId, membershipId);
      if (!current) this.notFound();
      if (current.status === MembershipStatus.REVOKED) {
        this.conflict('The requested membership cannot be changed.');
      }

      const previousRoles = this.roleCodes(current);
      const nextRoles = input.roles ? [...new Set(input.roles)].sort() : previousRoles;
      const rolesChanged = previousRoles.join('\0') !== nextRoles.join('\0');
      const statusChanged = input.status !== undefined && input.status !== current.status;
      const usernameChanged = input.institutionalUsername !== undefined;
      if (input.status === MembershipStatus.PENDING_ACTIVATION || input.status === MembershipStatus.REVOKED) {
        this.conflict('The requested membership status cannot be changed here.');
      }
      if (!statusChanged && !rolesChanged && !usernameChanged) {
        return this.toManagedMembership(current);
      }

      if (usernameChanged) {
        const username = this.normalization.normalizeUsername(input.institutionalUsername!);
        const collision = await transaction.loginIdentifier.findFirst({
          where: {
            tenantRealmId: tenantId,
            kind: LoginIdentifierKind.USERNAME,
            normalizedValue: username,
            NOT: { userId: current.userId },
          },
        });
        if (collision) this.conflict('The requested membership cannot be changed.');
        const identifier = await transaction.loginIdentifier.findFirst({
          where: {
            userId: current.userId,
            tenantRealmId: tenantId,
            kind: LoginIdentifierKind.USERNAME,
          },
        });
        if (identifier) {
          await transaction.loginIdentifier.update({ where: { id: identifier.id }, data: { normalizedValue: username } });
        } else {
          await transaction.loginIdentifier.create({
            data: {
              userId: current.userId,
              tenantRealmId: tenantId,
              kind: LoginIdentifierKind.USERNAME,
              normalizedValue: username,
            },
          });
        }
      }

      if (rolesChanged) {
        await transaction.membershipRole.deleteMany({ where: { membershipId } });
        for (const roleCode of nextRoles) {
          const role = await this.ensureTenantRole(transaction, roleCode as RoleCode);
          await transaction.membershipRole.create({ data: { membershipId, roleId: role.id } });
        }
        await this.createOutboxEvent(transaction, 'identity.role.changed.v1', membershipId, {
          membershipId,
          tenantId,
          roles: nextRoles,
        });
        await transaction.authAuditEvent.create({
          data: {
            eventType: 'ROLE_CHANGED',
            outcome: AuditOutcome.SUCCESS,
            actorUserId: principal.userId,
            tenantRealmId: tenantId,
            requestId,
            metadata: { membershipId, roles: nextRoles },
          },
        });
      }

      if (statusChanged) {
        const status = input.status!;
        const now = new Date();
        await transaction.tenantMembership.update({
          where: { id: membershipId },
          data: {
            status,
            ...(status === MembershipStatus.ACTIVE ? { activatedAt: current.activatedAt ?? now, suspendedAt: null } : {}),
            ...(status === MembershipStatus.SUSPENDED ? { suspendedAt: now } : {}),
          },
        });
        const eventType = status === MembershipStatus.SUSPENDED
          ? 'identity.membership.suspended.v1'
          : 'identity.membership.activated.v1';
        await this.createOutboxEvent(transaction, eventType, membershipId, { membershipId, tenantId });
        await transaction.authAuditEvent.create({
          data: {
            eventType: status === MembershipStatus.SUSPENDED ? 'MEMBERSHIP_SUSPENDED' : 'MEMBERSHIP_ACTIVATED',
            outcome: AuditOutcome.SUCCESS,
            actorUserId: principal.userId,
            tenantRealmId: tenantId,
            requestId,
            metadata: { membershipId },
          },
        });
      }

      if (rolesChanged || statusChanged) {
        await this.revokeMembershipSessions(transaction, membershipId, 'MEMBERSHIP_CHANGED', requestId);
      }
      const updated = await this.findMembership(transaction, tenantId, membershipId);
      return this.toManagedMembership(updated!);
    });
  }

  async revokeMembership(
    principal: AuthPrincipal,
    tenantId: string,
    membershipId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    this.assertTenantAdmin(principal, tenantId);
    await this.assertRateLimit('management', [principal.userId, tenantId, membershipId]);

    return this.prisma.$transaction(async (transaction) => {
      const current = await this.findMembership(transaction, tenantId, membershipId);
      if (!current) this.notFound();
      const now = new Date();
      if (current.status !== MembershipStatus.REVOKED) {
        await transaction.tenantMembership.update({
          where: { id: membershipId },
          data: { status: MembershipStatus.REVOKED, revokedAt: now },
        });
        await this.createOutboxEvent(transaction, 'identity.membership.revoked.v1', membershipId, {
          membershipId,
          tenantId,
        });
        await transaction.authAuditEvent.create({
          data: {
            eventType: 'MEMBERSHIP_REVOKED',
            outcome: AuditOutcome.SUCCESS,
            actorUserId: principal.userId,
            tenantRealmId: tenantId,
            requestId,
            metadata: { membershipId },
          },
        });
        await this.revokeMembershipSessions(transaction, membershipId, 'MEMBERSHIP_REVOKED', requestId);
      }
      return { membershipId, tenantId, status: MembershipStatus.REVOKED };
    });
  }

  async createInvitation(
    principal: AuthPrincipal,
    tenantId: string,
    membershipId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    this.assertTenantAdmin(principal, tenantId);
    this.assertRecentAuthentication(principal);
    await this.assertRateLimit('management', [principal.userId, tenantId, membershipId]);

    const issued = await this.opaqueTokens.issue('inv');
    const plaintext = issued.revealOnce();
    const expiresAt = new Date(Date.now() + this.config.getOrThrow('IDENTITY_EMAIL_INVITATION_TTL_SECONDS') * 1_000);

    return this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.tenantMembership.findFirst({
        where: { id: membershipId, tenantRealmId: tenantId },
        include: {
          user: { include: { loginIdentifiers: true } },
          tenantRealm: true,
        },
      });
      if (!membership || membership.tenantRealm.status !== TenantRealmStatus.ACTIVE) this.notFound();
      if (membership.status !== MembershipStatus.PENDING_ACTIVATION) {
        this.conflict('The requested membership is not awaiting activation.');
      }
      const emailIdentifier = membership.user.loginIdentifiers.find(({ kind }) => kind === LoginIdentifierKind.EMAIL);
      if (!emailIdentifier) this.conflict('An email address is required for this activation method.');

      const previous = await transaction.invitation.updateMany({
        where: { membershipId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const invitation = await transaction.invitation.create({
        data: {
          id: issued.id,
          membershipId,
          tokenHash: issued.tokenHash,
          intendedEmail: emailIdentifier.normalizedValue,
          expiresAt,
        },
      });
      await this.emailOutbox.createIntent(transaction, {
        deliveryKey: `invitation:${invitation.id}`,
        eventType: 'identity.email.invitation.v1',
        aggregateId: invitation.id,
        message: createInvitationEmail(this.config, emailIdentifier.normalizedValue, plaintext),
      });
      await this.createOutboxEvent(transaction, 'identity.invitation.created.v1', invitation.id, {
        invitationId: invitation.id,
        membershipId,
        userId: membership.userId,
        tenantId,
        expiresAt: expiresAt.toISOString(),
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: previous.count > 0 ? 'INVITATION_RESENT' : 'INVITATION_CREATED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: principal.userId,
          tenantRealmId: tenantId,
          requestId,
          metadata: { membershipId, invitationId: invitation.id },
        },
      });

      return {
        membershipId,
        invitationId: invitation.id,
        status: 'PENDING_DELIVERY',
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async acceptInvitation(input: InvitationAcceptDto, requestId: string): Promise<Record<string, unknown>> {
    this.passwordPolicy.assertAcceptable(input.password);
    const parsed = this.opaqueTokens.parse(input.invitationToken, 'inv');
    if (!parsed) this.credentialExpired();
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: parsed.id },
      include: {
        membership: {
          include: {
            user: { include: { passwordCredential: true, loginIdentifiers: true } },
            tenantRealm: true,
          },
        },
      },
    });
    if (!invitation || !(await this.safeVerifyToken(invitation.tokenHash, parsed))) this.credentialExpired();
    const now = new Date();
    if (
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now ||
      invitation.membership.status !== MembershipStatus.PENDING_ACTIVATION ||
      invitation.membership.user.status !== IdentityUserStatus.ACTIVE
    ) this.credentialExpired();
    const emailIdentifier = invitation.membership.user.loginIdentifiers.find(
      ({ kind, normalizedValue }) => kind === LoginIdentifierKind.EMAIL && normalizedValue === invitation.intendedEmail,
    );
    if (!emailIdentifier) this.credentialExpired();

    return this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (consumed.count !== 1) this.credentialExpired();

      const passwordHash = await this.passwords.hashPassword(input.password);
      await transaction.passwordCredential.upsert({
        where: { userId: invitation.membership.userId },
        create: {
          userId: invitation.membership.userId,
          passwordHash,
          passwordSetAt: now,
        },
        update: {
          passwordHash,
          passwordSetAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      await transaction.loginIdentifier.update({
        where: { id: emailIdentifier.id },
        data: { verifiedAt: emailIdentifier.verifiedAt ?? now },
      });
      await transaction.tenantMembership.update({
        where: { id: invitation.membershipId },
        data: { status: MembershipStatus.ACTIVE, activatedAt: now, suspendedAt: null, revokedAt: null },
      });
      await this.revokeUserSessions(transaction, invitation.membership.userId, 'PASSWORD_ACTIVATED', requestId);
      await this.createOutboxEvent(transaction, 'identity.membership.activated.v1', invitation.membershipId, {
        membershipId: invitation.membershipId,
        userId: invitation.membership.userId,
        tenantId: invitation.membership.tenantRealmId,
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'INVITATION_ACCEPTED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: invitation.membership.userId,
          tenantRealmId: invitation.membership.tenantRealmId,
          requestId,
          metadata: { invitationId: invitation.id, membershipId: invitation.membershipId },
        },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'MEMBERSHIP_ACTIVATED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: invitation.membership.userId,
          tenantRealmId: invitation.membership.tenantRealmId,
          requestId,
          metadata: { membershipId: invitation.membershipId },
        },
      });
      return { membershipId: invitation.membershipId, status: MembershipStatus.ACTIVE };
    });
  }

  async createActivationChallenge(
    principal: AuthPrincipal,
    tenantId: string,
    membershipId: string,
    requestId: string,
    sourceAddress: string,
  ): Promise<Record<string, unknown>> {
    this.assertTenantAdmin(principal, tenantId);
    this.assertRecentAuthentication(principal);
    await this.assertRateLimit('activation', [sourceAddress, principal.userId, membershipId]);
    const issued = await this.opaqueTokens.issue('act');
    const activationCode = issued.revealOnce();
    const expiresAt = new Date(Date.now() + this.config.getOrThrow('IDENTITY_ACTIVATION_TTL_SECONDS') * 1_000);

    return this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.tenantMembership.findFirst({
        where: { id: membershipId, tenantRealmId: tenantId },
        include: { user: { include: { loginIdentifiers: true } }, tenantRealm: true },
      });
      if (!membership || membership.tenantRealm.status !== TenantRealmStatus.ACTIVE) this.notFound();
      if (membership.status !== MembershipStatus.PENDING_ACTIVATION) {
        this.conflict('The requested membership is not awaiting activation.');
      }
      if (membership.user.loginIdentifiers.some(({ kind }) => kind === LoginIdentifierKind.EMAIL)) {
        this.conflict('This membership has an email activation path.');
      }
      const username = membership.user.loginIdentifiers.find(({ kind }) => kind === LoginIdentifierKind.USERNAME);
      if (!username) this.conflict('An institutional username is required for this activation method.');
      await transaction.activationChallenge.updateMany({
        where: { membershipId, consumedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.activationChallenge.create({
        data: { id: issued.id, membershipId, codeHash: issued.tokenHash, expiresAt },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'ACTIVATION_CHALLENGE_CREATED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: principal.userId,
          tenantRealmId: tenantId,
          requestId,
          metadata: { membershipId, challengeId: issued.id },
        },
      });
      return {
        membershipId,
        username: username.normalizedValue,
        activationCode,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async completeActivation(
    input: ActivationChallengeCompleteDto,
    requestId: string,
    sourceAddress: string,
  ): Promise<Record<string, unknown>> {
    const normalizedUsername = this.normalization.normalizeUsername(input.institutionalUsername);
    const parsed = this.opaqueTokens.parse(input.activationCode, 'act');
    await this.assertRateLimit('activation', [sourceAddress, normalizedUsername, parsed?.id ?? 'malformed']);
    if (!parsed) this.credentialExpired();
    const challenge = await this.prisma.activationChallenge.findUnique({
      where: { id: parsed.id },
      include: {
        membership: {
          include: {
            user: { include: { loginIdentifiers: true } },
            tenantRealm: true,
          },
        },
      },
    });
    if (!challenge) this.credentialExpired();
    const username = challenge.membership.user.loginIdentifiers.find(
      ({ kind, normalizedValue, tenantRealmId }) =>
        kind === LoginIdentifierKind.USERNAME &&
        normalizedValue === normalizedUsername &&
        tenantRealmId === challenge.membership.tenantRealmId,
    );
    const validSecret = await this.safeVerifyToken(challenge.codeHash, parsed);
    const now = new Date();
    if (
      !validSecret ||
      !username ||
      challenge.consumedAt ||
      challenge.revokedAt ||
      challenge.expiresAt <= now ||
      challenge.membership.status !== MembershipStatus.PENDING_ACTIVATION ||
      challenge.membership.tenantRealm.status !== TenantRealmStatus.ACTIVE ||
      challenge.membership.user.status !== IdentityUserStatus.ACTIVE
    ) {
      await this.recordActivationFailure(challenge.id, challenge.failedAttemptCount, requestId);
      this.credentialExpired();
    }
    this.passwordPolicy.assertAcceptable(input.password);

    return this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.activationChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) this.credentialExpired();
      const passwordHash = await this.passwords.hashPassword(input.password);
      await transaction.passwordCredential.upsert({
        where: { userId: challenge.membership.userId },
        create: {
          userId: challenge.membership.userId,
          passwordHash,
          passwordSetAt: now,
        },
        update: {
          passwordHash,
          passwordSetAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      await transaction.tenantMembership.update({
        where: { id: challenge.membershipId },
        data: { status: MembershipStatus.ACTIVE, activatedAt: now },
      });
      await this.revokeUserSessions(transaction, challenge.membership.userId, 'ACTIVATION_COMPLETED', requestId);
      await this.createOutboxEvent(transaction, 'identity.membership.activated.v1', challenge.membershipId, {
        membershipId: challenge.membershipId,
        userId: challenge.membership.userId,
        tenantId: challenge.membership.tenantRealmId,
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'ACTIVATION_CHALLENGE_CONSUMED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: challenge.membership.userId,
          tenantRealmId: challenge.membership.tenantRealmId,
          requestId,
          metadata: { challengeId: challenge.id, membershipId: challenge.membershipId },
        },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'MEMBERSHIP_ACTIVATED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: challenge.membership.userId,
          tenantRealmId: challenge.membership.tenantRealmId,
          requestId,
          metadata: { membershipId: challenge.membershipId },
        },
      });
      return { membershipId: challenge.membershipId, status: MembershipStatus.ACTIVE };
    });
  }

  async requestPasswordRecovery(
    input: PasswordRecoveryRequestDto,
    requestId: string,
    sourceAddress: string,
  ): Promise<{ accepted: true }> {
    const isEmail = this.normalization.isEmail(input.identifier);
    const normalizedIdentifier = isEmail
      ? this.normalization.normalizeEmail(input.identifier)
      : this.normalization.normalizeUsername(input.identifier);
    const normalizedHandle = input.tenantHandle
      ? this.normalization.normalizeTenantHandle(input.tenantHandle)
      : undefined;
    await this.assertRateLimit('recovery', [sourceAddress, normalizedIdentifier, normalizedHandle ?? 'no-realm']);

    let eligible: {
      userId: string;
      tenantRealmId?: string;
      email: string;
    } | null = null;
    if (isEmail) {
      const tenant = normalizedHandle
        ? await this.prisma.tenantRealm.findUnique({ where: { handle: normalizedHandle } })
        : null;
      const identifier = normalizedHandle && !tenant
        ? null
        : await this.prisma.loginIdentifier.findFirst({
        where: {
          kind: LoginIdentifierKind.EMAIL,
          normalizedValue: normalizedIdentifier,
          verifiedAt: { not: null },
          user: {
            status: IdentityUserStatus.ACTIVE,
            passwordCredential: { isNot: null },
            ...(tenant
              ? {
                  memberships: {
                    some: {
                      tenantRealmId: tenant.id,
                      status: MembershipStatus.ACTIVE,
                      tenantRealm: { status: TenantRealmStatus.ACTIVE },
                    },
                  },
                }
              : {}),
          },
        },
      });
      if (identifier) {
        eligible = {
          userId: identifier.userId,
          ...(tenant ? { tenantRealmId: tenant.id } : {}),
          email: identifier.normalizedValue,
        };
      }
    } else if (normalizedHandle) {
      const tenant = await this.prisma.tenantRealm.findUnique({ where: { handle: normalizedHandle } });
      if (tenant) {
        const username = await this.prisma.loginIdentifier.findFirst({
          where: {
            kind: LoginIdentifierKind.USERNAME,
            tenantRealmId: tenant.id,
            normalizedValue: normalizedIdentifier,
            user: {
              status: IdentityUserStatus.ACTIVE,
              passwordCredential: { isNot: null },
              memberships: { some: { tenantRealmId: tenant.id, status: MembershipStatus.ACTIVE } },
            },
          },
          include: { user: { include: { loginIdentifiers: true } } },
        });
        const email = username?.user.loginIdentifiers.find(
          ({ kind, verifiedAt }) => kind === LoginIdentifierKind.EMAIL && verifiedAt,
        );
        if (username && email) eligible = { userId: username.userId, tenantRealmId: tenant.id, email: email.normalizedValue };
      }
    }

    const issued = eligible ? await this.opaqueTokens.issue('rst') : null;
    if (eligible && issued) {
      const plaintext = issued.revealOnce();
      const expiresAt = new Date(Date.now() + this.config.getOrThrow('IDENTITY_PASSWORD_RESET_TTL_SECONDS') * 1_000);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.passwordResetToken.updateMany({
          where: { userId: eligible.userId, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const reset = await transaction.passwordResetToken.create({
          data: { id: issued.id, userId: eligible.userId, tokenHash: issued.tokenHash, expiresAt },
        });
        await this.emailOutbox.createIntent(transaction, {
          deliveryKey: `password-reset:${reset.id}`,
          eventType: 'identity.email.password-recovery.v1',
          aggregateId: reset.id,
          message: createPasswordRecoveryEmail(this.config, eligible.email, plaintext),
        });
        await transaction.authAuditEvent.create({
          data: {
            eventType: 'PASSWORD_RECOVERY_REQUESTED',
            outcome: AuditOutcome.SUCCESS,
            ...(eligible.tenantRealmId ? { tenantRealmId: eligible.tenantRealmId } : {}),
            requestId,
            metadata: { identifierKind: isEmail ? 'EMAIL' : 'USERNAME' },
          },
        });
      });
    } else {
      await this.audit.record({
        eventType: 'PASSWORD_RECOVERY_REQUESTED',
        outcome: AuditOutcome.SUCCESS,
        requestId,
        metadata: { identifierKind: isEmail ? 'EMAIL' : 'USERNAME' },
      });
    }
    return { accepted: true };
  }

  async confirmPasswordRecovery(
    input: PasswordRecoveryConfirmDto,
    requestId: string,
    sourceAddress: string,
  ): Promise<Record<string, unknown>> {
    this.passwordPolicy.assertAcceptable(input.password);
    const parsed = this.opaqueTokens.parse(input.resetToken, 'rst');
    await this.assertRateLimit('recovery', [sourceAddress, parsed?.id ?? 'malformed']);
    if (!parsed) this.credentialExpired();
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { id: parsed.id },
      include: { user: true },
    });
    if (!reset || !(await this.safeVerifyToken(reset.tokenHash, parsed))) this.credentialExpired();
    const now = new Date();
    if (reset.consumedAt || reset.revokedAt || reset.expiresAt <= now || reset.user.status !== IdentityUserStatus.ACTIVE) {
      this.credentialExpired();
    }

    return this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: reset.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) this.credentialExpired();
      const passwordHash = await this.passwords.hashPassword(input.password);
      await transaction.passwordCredential.upsert({
        where: { userId: reset.userId },
        create: { userId: reset.userId, passwordHash, passwordSetAt: now },
        update: {
          passwordHash,
          passwordSetAt: now,
          failedAttemptCount: 0,
          lockedUntil: null,
        },
      });
      const revoked = await this.revokeUserSessions(transaction, reset.userId, 'PASSWORD_RESET', requestId);
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'PASSWORD_RESET_COMPLETED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: reset.userId,
          requestId,
          metadata: { revokedSessionCount: revoked },
        },
      });
      return { status: 'PASSWORD_RESET', revokedSessions: revoked };
    });
  }

  private async findMembership(
    client: PrismaService | LifecycleTransaction,
    tenantId: string,
    membershipId: string,
  ): Promise<MembershipDetails | null> {
    return client.tenantMembership.findFirst({
      where: { id: membershipId, tenantRealmId: tenantId },
      include: { tenantRealm: true, user: { include: { loginIdentifiers: true } }, roles: { include: { role: true } } },
    }) as Promise<MembershipDetails | null>;
  }

  private async ensureTenantRole(client: LifecycleTransaction, roleCode: RoleCode) {
    const existing = await client.role.findUnique({ where: { code: roleCode } });
    if (existing) {
      if (existing.scope !== RoleScope.TENANT) this.forbiddenRole();
      return existing;
    }
    return client.role.create({ data: { id: randomUUID(), code: roleCode, scope: RoleScope.TENANT } });
  }

  private async revokeMembershipSessions(
    transaction: LifecycleTransaction,
    membershipId: string,
    reason: string,
    requestId: string,
  ): Promise<number> {
    const sessions = await transaction.session.findMany({
      where: { activeMembershipId: membershipId, revokedAt: null },
      select: { id: true, userId: true },
    });
    if (sessions.length === 0) return 0;
    const now = new Date();
    await transaction.refreshToken.updateMany({
      where: { sessionId: { in: sessions.map(({ id }) => id) }, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.session.updateMany({
      where: { id: { in: sessions.map(({ id }) => id) }, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
    for (const session of sessions) {
      await this.createOutboxEvent(transaction, 'identity.session.revoked.v1', session.id, {
        sessionId: session.id,
        userId: session.userId,
        membershipId,
        reason,
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'SESSION_REVOKED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: session.userId,
          sessionId: session.id,
          requestId,
          metadata: { reason, membershipId },
        },
      });
    }
    return sessions.length;
  }

  private async revokeUserSessions(
    transaction: LifecycleTransaction,
    userId: string,
    reason: string,
    requestId: string,
  ): Promise<number> {
    const sessions = await transaction.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, userId: true, activeMembershipId: true },
    });
    if (sessions.length === 0) return 0;
    const now = new Date();
    await transaction.refreshToken.updateMany({
      where: { sessionId: { in: sessions.map(({ id }) => id) }, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.session.updateMany({
      where: { id: { in: sessions.map(({ id }) => id) }, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
    for (const session of sessions) {
      await this.createOutboxEvent(transaction, 'identity.session.revoked.v1', session.id, {
        sessionId: session.id,
        userId,
        membershipId: session.activeMembershipId,
        reason,
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'SESSION_REVOKED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: userId,
          sessionId: session.id,
          requestId,
          metadata: { reason },
        },
      });
    }
    return sessions.length;
  }

  private async recordActivationFailure(challengeId: string, priorFailures: number, requestId: string): Promise<void> {
    const limit = this.config.getOrThrow('ACTIVATION_ATTEMPT_LIMIT');
    await this.prisma.activationChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, revokedAt: null },
      data: {
        failedAttemptCount: { increment: 1 },
        ...(priorFailures + 1 >= limit ? { revokedAt: new Date() } : {}),
      },
    });
    await this.audit.record({
      eventType: 'ACTIVATION_CHALLENGE_FAILED',
      outcome: AuditOutcome.DENIED,
      requestId,
      metadata: { category: 'activation' },
    });
  }

  private assertTenantAdmin(principal: AuthPrincipal, tenantId: string): ActiveMembershipContext {
    const membership = principal.activeMembership;
    if (!membership) {
      throw new SafeHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'The requested action is not permitted.');
    }
    if (membership.tenantId !== tenantId) this.notFound();
    if (!membership.roles.includes(RoleCode.TENANT_ADMIN)) {
      throw new SafeHttpException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'The requested action is not permitted.');
    }
    return membership;
  }

  private assertRecentAuthentication(principal: AuthPrincipal): void {
    if (Math.floor(Date.now() / 1_000) - principal.authenticatedAt > this.config.getOrThrow('LOGOUT_ALL_REAUTH_MAX_AGE_SECONDS')) {
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'REAUTHENTICATION_REQUIRED',
        'Recent authentication is required for this action.',
      );
    }
  }

  private assertManagedRoles(roles: ReadonlyArray<RoleCode>): void {
    const unique = new Set(roles);
    if (unique.size !== roles.length || roles.some((role) => !MANAGED_ROLES.has(role))) this.forbiddenRole();
  }

  private forbiddenRole(): never {
    throw new SafeHttpException(HttpStatus.FORBIDDEN, 'ROLE_ASSIGNMENT_NOT_ALLOWED', 'The requested role assignment is not permitted.');
  }

  private async assertRateLimit(
    bucket: 'activation' | 'recovery' | 'management',
    keys: ReadonlyArray<string>,
  ): Promise<void> {
    const decision = await this.rateLimits.consume({ bucket, keys });
    if (!decision.allowed) {
      throw new SafeHttpException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests were received.');
    }
  }

  private async createOutboxEvent(
    transaction: LifecycleTransaction,
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        eventType,
        aggregateType: 'Identity',
        aggregateId,
        payload: payload as Prisma.InputJsonObject,
      },
    });
  }

  private roleCodes(membership: { roles: Array<{ role: { code: RoleCode } }> }): RoleCode[] {
    return membership.roles.map(({ role }) => role.code).sort();
  }

  private toManagedMembership(membership: MembershipDetails): Record<string, unknown> {
    const username = membership.user.loginIdentifiers?.find(
      ({ kind, tenantRealmId }) => kind === LoginIdentifierKind.USERNAME && tenantRealmId === membership.tenantRealmId,
    )?.normalizedValue;
    return {
      membershipId: membership.id,
      userId: membership.userId,
      tenantId: membership.tenantRealmId,
      status: membership.status,
      roles: this.roleCodes(membership),
      activatedAt: membership.activatedAt?.toISOString() ?? null,
      ...(username ? { institutionalUsername: username } : {}),
    };
  }

  private safeVerifyToken(hash: string, parsed: { id: string; secret: string }): Promise<boolean> {
    return this.opaqueTokens.verify(hash, parsed).catch(() => false);
  }

  private credentialExpired(): never {
    throw new SafeHttpException(HttpStatus.GONE, 'ACTIVATION_EXPIRED', TOKEN_EXPIRED_MESSAGE);
  }

  private notFound(): never {
    throw new SafeHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The requested resource was not found.');
  }

  private conflict(message: string): never {
    throw new SafeHttpException(HttpStatus.CONFLICT, 'CONFLICT', message);
  }
}
