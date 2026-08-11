import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
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
import { createInvitationEmail } from '../email/account-lifecycle-email.js';
import { EmailOutboxService } from '../email/email-outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { OpaqueTokenService } from '../security/opaque-token.service.js';
import { IdentifierNormalizationService } from '../auth/identifier-normalization.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const TENANT_ADMIN_BOOTSTRAP_USAGE =
  'Usage: pnpm bootstrap:tenant-admin -- --tenant-id <canonical-tenant-uuid> --tenant-handle <identity-handle> --username <institutional-username> --activation <code|email> [--email <intended-email>] [--reissue-activation] [--request-id <operator-request-id>]';

export type TenantAdminActivationMethod = 'code' | 'email';

export interface TenantAdminBootstrapInput {
  readonly tenantId: string;
  readonly tenantHandle: string;
  readonly institutionalUsername: string;
  readonly activationMethod: TenantAdminActivationMethod;
  readonly email?: string;
  readonly reissueActivation: boolean;
  readonly requestId: string;
}

interface CodeActivationResult {
  readonly method: 'code';
  readonly issued: true;
  readonly oneTimeSensitive: true;
  readonly activationCode: string;
  readonly expiresAt: string;
}

interface EmailActivationResult {
  readonly method: 'email';
  readonly issued: true;
  readonly invitationQueued: true;
  readonly destination: string;
  readonly expiresAt: string;
}

interface ExistingActivationResult {
  readonly method: TenantAdminActivationMethod;
  readonly issued: false;
  readonly state: 'already-issued' | 'activated';
}

export interface TenantAdminBootstrapResult {
  readonly operation: 'created' | 'already-compatible' | 'activation-reissued';
  readonly tenantId: string;
  readonly tenantHandle: string;
  readonly username: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly membershipStatus: MembershipStatus;
  readonly tenantCreated: boolean;
  readonly userCreated: boolean;
  readonly membershipCreated: boolean;
  readonly roles: readonly [typeof RoleCode.TENANT_ADMIN];
  readonly activation: CodeActivationResult | EmailActivationResult | ExistingActivationResult;
}

export class TenantAdminBootstrapConflictError extends Error {}

export class TenantAdminBootstrapUsageError extends Error {}

export function parseTenantAdminBootstrapArguments(
  args: readonly string[],
): TenantAdminBootstrapInput | { readonly help: true } {
  const values = new Map<string, string>();
  let reissueActivation = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--reissue-activation') {
      if (reissueActivation) {
        throw new TenantAdminBootstrapUsageError('Specify --reissue-activation at most once.');
      }
      reissueActivation = true;
      continue;
    }
    if (!['--tenant-id', '--tenant-handle', '--username', '--activation', '--email', '--request-id'].includes(argument)) {
      throw new TenantAdminBootstrapUsageError(`Unknown option: ${argument}`);
    }
    if (values.has(argument)) {
      throw new TenantAdminBootstrapUsageError(`Specify ${argument} once.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new TenantAdminBootstrapUsageError(`Missing value for ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }

  const tenantId = requiredValue(values, '--tenant-id');
  const tenantHandle = requiredValue(values, '--tenant-handle');
  const institutionalUsername = requiredValue(values, '--username');
  const activation = requiredValue(values, '--activation');
  const email = values.get('--email');
  const requestId = values.get('--request-id') ?? `identity-tenant-admin-bootstrap:${randomUUID()}`;

  if (!UUID_PATTERN.test(tenantId)) {
    throw new TenantAdminBootstrapUsageError('--tenant-id must be a canonical UUID.');
  }
  if (tenantHandle.length > 128) {
    throw new TenantAdminBootstrapUsageError('--tenant-handle must contain between 1 and 128 characters.');
  }
  if (institutionalUsername.length > 128) {
    throw new TenantAdminBootstrapUsageError('--username must contain between 1 and 128 characters.');
  }
  if (activation !== 'code' && activation !== 'email') {
    throw new TenantAdminBootstrapUsageError('--activation must be either code or email.');
  }
  if (activation === 'email' && (!email || !isEmail(email) || email.length > 320)) {
    throw new TenantAdminBootstrapUsageError('--email must be a valid intended email in email activation mode.');
  }
  if (activation === 'code' && email) {
    throw new TenantAdminBootstrapUsageError('--email is not accepted in code activation mode.');
  }
  if (!SAFE_REQUEST_ID_PATTERN.test(requestId)) {
    throw new TenantAdminBootstrapUsageError(
      '--request-id must contain only letters, numbers, dot, underscore, colon, or hyphen.',
    );
  }

  return {
    tenantId: tenantId.toLowerCase(),
    tenantHandle,
    institutionalUsername,
    activationMethod: activation,
    ...(email ? { email } : {}),
    reissueActivation,
    requestId,
  };
}

function requiredValue(values: ReadonlyMap<string, string>, option: string): string {
  const value = values.get(option);
  if (!value) throw new TenantAdminBootstrapUsageError(`${option} is required.`);
  return value;
}

export function maskEmail(value: string): string {
  const separator = value.lastIndexOf('@');
  if (separator < 1) return '[redacted]';
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const labels = domain.split('.');
  const maskedDomain = labels
    .map((label, index) => (index === labels.length - 1 ? label : `${label.slice(0, 1)}***`))
    .join('.');
  return `${local.slice(0, 1)}***@${maskedDomain}`;
}

type BootstrapTransaction = Prisma.TransactionClient;

@Injectable()
export class TenantAdminBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly normalization: IdentifierNormalizationService,
    private readonly config: ConfigService<Environment, true>,
    @Optional() private readonly emailOutbox?: EmailOutboxService,
  ) {}

  async bootstrap(input: TenantAdminBootstrapInput): Promise<TenantAdminBootstrapResult> {
    const tenantId = input.tenantId.toLowerCase();
    const tenantHandle = this.normalization.normalizeTenantHandle(input.tenantHandle);
    const username = this.normalization.normalizeUsername(input.institutionalUsername);
    const email = input.email ? this.normalization.normalizeEmail(input.email) : undefined;
    this.assertNormalizedInputs(tenantId, tenantHandle, username, input.activationMethod, email);

    const issued = await this.opaqueTokens.issue(input.activationMethod === 'code' ? 'act' : 'inv');

    return this.prisma.$transaction(async (transaction) => {
      const tenantById = await transaction.tenantRealm.findUnique({ where: { id: tenantId } });
      const tenantByHandle = await transaction.tenantRealm.findUnique({ where: { handle: tenantHandle } });
      if (tenantById && (tenantById.handle !== tenantHandle || tenantById.status !== TenantRealmStatus.ACTIVE)) {
        this.conflict('The tenant UUID exists with incompatible Identity metadata or status.');
      }
      if (tenantByHandle && tenantByHandle.id !== tenantId) {
        this.conflict('The tenant handle belongs to a different canonical tenant UUID.');
      }

      const tenantCreated = !tenantById;
      if (!tenantById) {
        await transaction.tenantRealm.create({ data: { id: tenantId, handle: tenantHandle } });
        await this.audit(transaction, 'TENANT_BOOTSTRAPPED', tenantId, input.requestId, {
          handle: tenantHandle,
        });
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
              passwordCredential: true,
              loginIdentifiers: true,
              platformRoles: { include: { role: true } },
              memberships: {
                where: { tenantRealmId: tenantId },
                include: {
                  roles: { include: { role: true } },
                  invitations: true,
                  activationChallenges: true,
                },
              },
            },
          },
        },
      });
      if (usernameIdentifiers.length > 1) {
        this.conflict('The institutional username resolves to incompatible Identity users.');
      }

      const existingIdentifier = usernameIdentifiers[0];
      if (existingIdentifier) {
        return this.handleExisting(
          transaction,
          input,
          { tenantId, tenantHandle, username, ...(email ? { email } : {}) },
          existingIdentifier,
          issued,
        );
      }

      const existingTenantState = await transaction.tenantMembership.count({ where: { tenantRealmId: tenantId } });
      const existingTenantIdentifiers = await transaction.loginIdentifier.count({ where: { tenantRealmId: tenantId } });
      if (existingTenantState > 0 || existingTenantIdentifiers > 0) {
        this.conflict('The tenant already contains Identity state for a different initial administrator.');
      }
      if (email) await this.assertEmailUnclaimed(transaction, email);

      const user = await transaction.identityUser.create({ data: {} });
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
      if (email) {
        await transaction.loginIdentifier.create({
          data: { userId: user.id, kind: LoginIdentifierKind.EMAIL, normalizedValue: email },
        });
      }

      const role = await this.ensureTenantAdminRole(transaction);
      await transaction.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });

      await this.integrationEvent(transaction, 'identity.user.created.v1', user.id, { userId: user.id });
      await this.audit(transaction, 'USER_PROVISIONED', tenantId, input.requestId, { userId: user.id });
      await this.integrationEvent(transaction, 'identity.membership.created.v1', membership.id, {
        membershipId: membership.id,
        userId: user.id,
        tenantId,
        roles: [RoleCode.TENANT_ADMIN],
      });
      await this.audit(transaction, 'MEMBERSHIP_CREATED', tenantId, input.requestId, {
        membershipId: membership.id,
        roles: [RoleCode.TENANT_ADMIN],
      });
      await this.integrationEvent(transaction, 'identity.role.changed.v1', membership.id, {
        membershipId: membership.id,
        tenantId,
        roles: [RoleCode.TENANT_ADMIN],
      });
      await this.audit(transaction, 'ROLE_ASSIGNED', tenantId, input.requestId, {
        membershipId: membership.id,
        role: RoleCode.TENANT_ADMIN,
      });

      const activation = await this.issueActivation(
        transaction,
        input,
        { membershipId: membership.id, userId: user.id, tenantId, username, ...(email ? { email } : {}) },
        issued,
        false,
      );
      return {
        operation: 'created',
        tenantId,
        tenantHandle,
        username,
        userId: user.id,
        membershipId: membership.id,
        membershipStatus: MembershipStatus.PENDING_ACTIVATION,
        tenantCreated,
        userCreated: true,
        membershipCreated: true,
        roles: [RoleCode.TENANT_ADMIN],
        activation,
      };
    }, { isolationLevel: 'Serializable' });
  }

  private async handleExisting(
    transaction: BootstrapTransaction,
    input: TenantAdminBootstrapInput,
    expected: { tenantId: string; tenantHandle: string; username: string; email?: string },
    identifier: {
      userId: string;
      user: {
        status: IdentityUserStatus;
        passwordCredential: unknown | null;
        loginIdentifiers: Array<{
          kind: LoginIdentifierKind;
          tenantRealmId: string | null;
          normalizedValue: string;
        }>;
        platformRoles: Array<{ role: { code: RoleCode } }>;
        memberships: Array<{
          id: string;
          status: MembershipStatus;
          roles: Array<{ role: { code: RoleCode; scope: RoleScope } }>;
          invitations: Array<{
            id: string;
            intendedEmail: string | null;
            acceptedAt: Date | null;
          }>;
          activationChallenges: Array<{ id: string; consumedAt: Date | null }>;
        }>;
      };
    },
    issued: Awaited<ReturnType<OpaqueTokenService['issue']>>,
  ): Promise<TenantAdminBootstrapResult> {
    const { user } = identifier;
    if (user.status !== IdentityUserStatus.ACTIVE || user.platformRoles.length > 0) {
      this.conflict('The existing initial administrator has incompatible account or platform-role state.');
    }
    const usernames = user.loginIdentifiers.filter(
      ({ kind, tenantRealmId }) => kind === LoginIdentifierKind.USERNAME && tenantRealmId === expected.tenantId,
    );
    if (usernames.length !== 1 || usernames[0]!.normalizedValue !== expected.username) {
      this.conflict('The institutional username belongs to incompatible Identity state.');
    }
    if (user.memberships.length !== 1) {
      this.conflict('The institutional username does not have the expected tenant membership.');
    }
    const membership = user.memberships[0]!;
    const roles = membership.roles.map(({ role }) => role.code).sort();
    if (
      membership.roles.some(({ role }) => role.scope !== RoleScope.TENANT) ||
      roles.length !== 1 ||
      roles[0] !== RoleCode.TENANT_ADMIN
    ) {
      this.conflict('The existing membership does not contain exactly TENANT_ADMIN.');
    }
    if (
      membership.status !== MembershipStatus.PENDING_ACTIVATION &&
      membership.status !== MembershipStatus.ACTIVE
    ) {
      this.conflict('The existing membership has an incompatible lifecycle status.');
    }
    if (
      (membership.status === MembershipStatus.PENDING_ACTIVATION && user.passwordCredential) ||
      (membership.status === MembershipStatus.ACTIVE && !user.passwordCredential)
    ) {
      this.conflict('The existing administrator credential state is incompatible with membership activation.');
    }

    const emails = user.loginIdentifiers.filter(({ kind }) => kind === LoginIdentifierKind.EMAIL);
    if (input.activationMethod === 'code') {
      if (emails.length > 0 || membership.invitations.length > 0) {
        this.conflict('The existing administrator uses a different activation method.');
      }
      if (membership.activationChallenges.length === 0 && !input.reissueActivation) {
        this.conflict('No compatible activation challenge exists; use --reissue-activation to issue one explicitly.');
      }
    } else {
      if (
        emails.length !== 1 ||
        emails[0]!.normalizedValue !== expected.email ||
        membership.activationChallenges.length > 0 ||
        membership.invitations.some(({ intendedEmail }) => intendedEmail !== expected.email)
      ) {
        this.conflict('The existing administrator uses incompatible email or activation state.');
      }
      await this.assertEmailUnclaimed(transaction, expected.email!, identifier.userId);
      if (membership.invitations.length === 0 && !input.reissueActivation) {
        this.conflict('No compatible invitation exists; use --reissue-activation to issue one explicitly.');
      }
      if (membership.invitations.length > 0) {
        const deliveryCount = await transaction.outboxEvent.count({
          where: { deliveryKey: { in: membership.invitations.map(({ id }) => `invitation:${id}`) } },
        });
        if (deliveryCount !== membership.invitations.length) {
          this.conflict('The existing invitation delivery state is incomplete.');
        }
      }
    }

    if (input.reissueActivation) {
      if (membership.status !== MembershipStatus.PENDING_ACTIVATION) {
        this.conflict('Activation cannot be reissued after the administrator has activated the membership.');
      }
      const activation = await this.issueActivation(
        transaction,
        input,
        {
          membershipId: membership.id,
          userId: identifier.userId,
          tenantId: expected.tenantId,
          username: expected.username,
          ...(expected.email ? { email: expected.email } : {}),
        },
        issued,
        true,
      );
      return this.result('activation-reissued', expected, identifier.userId, membership, activation);
    }

    return this.result('already-compatible', expected, identifier.userId, membership, {
      method: input.activationMethod,
      issued: false,
      state: membership.status === MembershipStatus.ACTIVE ? 'activated' : 'already-issued',
    });
  }

  private async issueActivation(
    transaction: BootstrapTransaction,
    input: TenantAdminBootstrapInput,
    identity: {
      membershipId: string;
      userId: string;
      tenantId: string;
      username: string;
      email?: string;
    },
    issued: Awaited<ReturnType<OpaqueTokenService['issue']>>,
    reissued: boolean,
  ): Promise<CodeActivationResult | EmailActivationResult> {
    const now = new Date();
    if (input.activationMethod === 'code') {
      await transaction.activationChallenge.updateMany({
        where: { membershipId: identity.membershipId, consumedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const expiresAt = new Date(
        Date.now() + this.config.getOrThrow('IDENTITY_ACTIVATION_TTL_SECONDS') * 1_000,
      );
      await transaction.activationChallenge.create({
        data: {
          id: issued.id,
          membershipId: identity.membershipId,
          codeHash: issued.tokenHash,
          expiresAt,
        },
      });
      await this.audit(
        transaction,
        reissued ? 'ACTIVATION_CHALLENGE_REISSUED' : 'ACTIVATION_CHALLENGE_CREATED',
        identity.tenantId,
        input.requestId,
        { membershipId: identity.membershipId, challengeId: issued.id },
      );
      return {
        method: 'code',
        issued: true,
        oneTimeSensitive: true,
        activationCode: issued.revealOnce(),
        expiresAt: expiresAt.toISOString(),
      };
    }

    if (!identity.email || !this.emailOutbox) {
      throw new TenantAdminBootstrapUsageError('Email activation requires the Identity email-outbox configuration.');
    }
    await transaction.invitation.updateMany({
      where: { membershipId: identity.membershipId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow('IDENTITY_EMAIL_INVITATION_TTL_SECONDS') * 1_000,
    );
    const plaintext = issued.revealOnce();
    const invitation = await transaction.invitation.create({
      data: {
        id: issued.id,
        membershipId: identity.membershipId,
        tokenHash: issued.tokenHash,
        intendedEmail: identity.email,
        expiresAt,
      },
    });
    await this.emailOutbox.createIntent(transaction, {
      deliveryKey: `invitation:${invitation.id}`,
      eventType: 'identity.email.invitation.v1',
      aggregateId: invitation.id,
      message: createInvitationEmail(this.config, identity.email, plaintext),
    });
    await this.integrationEvent(transaction, 'identity.invitation.created.v1', invitation.id, {
      invitationId: invitation.id,
      membershipId: identity.membershipId,
      userId: identity.userId,
      tenantId: identity.tenantId,
      expiresAt: expiresAt.toISOString(),
    });
    await this.audit(
      transaction,
      reissued ? 'INVITATION_REISSUED' : 'INVITATION_CREATED',
      identity.tenantId,
      input.requestId,
      { membershipId: identity.membershipId, invitationId: invitation.id },
    );
    return {
      method: 'email',
      issued: true,
      invitationQueued: true,
      destination: maskEmail(identity.email),
      expiresAt: expiresAt.toISOString(),
    };
  }

  private result(
    operation: TenantAdminBootstrapResult['operation'],
    expected: { tenantId: string; tenantHandle: string; username: string },
    userId: string,
    membership: { id: string; status: MembershipStatus },
    activation: TenantAdminBootstrapResult['activation'],
  ): TenantAdminBootstrapResult {
    return {
      operation,
      tenantId: expected.tenantId,
      tenantHandle: expected.tenantHandle,
      username: expected.username,
      userId,
      membershipId: membership.id,
      membershipStatus: membership.status,
      tenantCreated: false,
      userCreated: false,
      membershipCreated: false,
      roles: [RoleCode.TENANT_ADMIN],
      activation,
    };
  }

  private async ensureTenantAdminRole(transaction: BootstrapTransaction) {
    const role = await transaction.role.findUnique({ where: { code: RoleCode.TENANT_ADMIN } });
    if (role) {
      if (role.scope !== RoleScope.TENANT) {
        this.conflict('The TENANT_ADMIN role has an incompatible scope.');
      }
      return role;
    }
    return transaction.role.create({
      data: { id: randomUUID(), code: RoleCode.TENANT_ADMIN, scope: RoleScope.TENANT },
    });
  }

  private async assertEmailUnclaimed(
    transaction: BootstrapTransaction,
    email: string,
    expectedUserId?: string,
  ): Promise<void> {
    const owners = await transaction.loginIdentifier.findMany({
      where: { kind: LoginIdentifierKind.EMAIL, normalizedValue: email },
      select: { userId: true },
    });
    if (owners.some(({ userId }) => userId !== expectedUserId)) {
      this.conflict('The intended email belongs to another Identity user.');
    }
  }

  private assertNormalizedInputs(
    tenantId: string,
    tenantHandle: string,
    username: string,
    activationMethod: TenantAdminActivationMethod,
    email?: string,
  ): void {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new TenantAdminBootstrapUsageError('The canonical tenant ID must be a UUID.');
    }
    if (!tenantHandle || tenantHandle.length > 128) {
      throw new TenantAdminBootstrapUsageError('The tenant handle must contain between 1 and 128 characters.');
    }
    if (!username || username.length > 128) {
      throw new TenantAdminBootstrapUsageError('The institutional username must contain between 1 and 128 characters.');
    }
    if (activationMethod === 'email' && (!email || !isEmail(email) || email.length > 320)) {
      throw new TenantAdminBootstrapUsageError('Email activation requires a valid intended email.');
    }
    if (activationMethod === 'code' && email) {
      throw new TenantAdminBootstrapUsageError('Code activation cannot persist an intended email.');
    }
  }

  private audit(
    transaction: BootstrapTransaction,
    eventType: string,
    tenantRealmId: string,
    requestId: string,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return transaction.authAuditEvent.create({
      data: {
        eventType,
        outcome: AuditOutcome.SUCCESS,
        tenantRealmId,
        requestId,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  }

  private integrationEvent(
    transaction: BootstrapTransaction,
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return transaction.outboxEvent.create({
      data: {
        eventType,
        aggregateType: 'Identity',
        aggregateId,
        payload: payload as Prisma.InputJsonObject,
      },
    });
  }

  private conflict(message: string): never {
    throw new TenantAdminBootstrapConflictError(message);
  }
}
