import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  IdentityUserStatus,
  LoginIdentifierKind,
  MembershipStatus,
  OutboxStatus,
  RoleCode,
  RoleScope,
  TenantRealmStatus,
} from '../src/generated/prisma/enums.js';
import type { Environment } from '../src/config/environment.js';
import { IdentifierNormalizationService } from '../src/auth/identifier-normalization.service.js';
import { PrismaService } from '../src/persistence/prisma.service.js';
import {
  IdentityEmailCorrectionConflictError,
  IdentityEmailCorrectionService,
  parseIdentityEmailCorrectionArguments,
} from '../src/bootstrap/identity-email-correction.js';
import { formatIdentityEmailCorrectionOutput } from '../src/bootstrap/identity-email-correction-main.js';
import {
  IdentityEmailVerificationConflictError,
  IdentityEmailVerificationGateError,
  IdentityEmailVerificationService,
  assertIdentityEmailVerificationPostconditions,
  getIdentityEmailVerificationExitCode,
} from '../src/bootstrap/identity-email-verification.js';
import { formatIdentityEmailVerificationOutput } from '../src/bootstrap/identity-email-verification-main.js';
import type { IdentityEmailVerificationResult } from '../src/bootstrap/identity-email-verification.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('operator Identity email correction (PostgreSQL integration)', () => {
  let prisma: PrismaClient;
  let correction: IdentityEmailCorrectionService;
  let verification: IdentityEmailVerificationService;
  let target: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(() => {
    const config = new ConfigService<Environment, true>({ DATABASE_URL: databaseUrl } as unknown as Environment);
    const service = new PrismaService(config);
    prisma = service;
    correction = new IdentityEmailCorrectionService(service, new IdentifierNormalizationService());
    verification = new IdentityEmailVerificationService(service, new IdentifierNormalizationService());
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    target = await createFixture(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('corrects the email and revokes sessions, reset tokens, and pending activation artifacts', async () => {
    const session = await createSession(prisma, target.userId, target.membershipId);
    const resetTokenId = randomUUID();
    await prisma.passwordResetToken.create({
      data: {
        id: resetTokenId,
        userId: target.userId,
        tokenHash: 'synthetic-reset-hash',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const invitationId = randomUUID();
    await prisma.invitation.create({
      data: {
        id: invitationId,
        membershipId: target.membershipId,
        tokenHash: 'synthetic-invitation-hash',
        intendedEmail: target.oldEmail,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.outboxEvent.create({
      data: {
        eventType: 'identity.email.invitation.v1',
        aggregateType: 'IdentityEmail',
        aggregateId: invitationId,
        deliveryKey: `invitation:${invitationId}`,
        payload: { encryptedMessage: 'synthetic-encrypted-payload' },
      },
    });
    const challengeId = randomUUID();
    await prisma.activationChallenge.create({
      data: {
        id: challengeId,
        membershipId: target.membershipId,
        codeHash: 'synthetic-challenge-hash',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const result = await correction.correct({
      tenantId: target.tenantId,
      username: '  Target.Admin ',
      email: ' Corrected@Example.Test ',
      requestId: 'operator-test:correction',
    });

    expect(result).toMatchObject({
      status: 'corrected',
      userId: target.userId,
      membershipId: target.membershipId,
      tenantId: target.tenantId,
      username: 'target.admin',
      destinationEmail: 'c***@e***.test',
      sessionsRevoked: 1,
      passwordResetTokensRevoked: 1,
      invitationsRevoked: 1,
      activationChallengesRevoked: 1,
      requestId: 'operator-test:correction',
    });

    const identifier = await prisma.loginIdentifier.findFirstOrThrow({
      where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL },
    });
    expect(identifier.normalizedValue).toBe('corrected@example.test');
    expect(identifier.verifiedAt).not.toBeNull();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      revokedAt: expect.any(Date),
      revocationReason: 'EMAIL_CORRECTION',
    });
    expect(await prisma.refreshToken.findFirstOrThrow({ where: { sessionId: session.id } })).toHaveProperty('revokedAt');
    expect(await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: resetTokenId } })).toHaveProperty('revokedAt');
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } })).toHaveProperty('revokedAt');
    expect(await prisma.activationChallenge.findUniqueOrThrow({ where: { id: challengeId } })).toHaveProperty('revokedAt');
    expect(await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: invitationId } })).toMatchObject({
      status: OutboxStatus.FAILED,
      lastError: 'EMAIL_INTENT_REVOKED',
    });

    const audit = await prisma.authAuditEvent.findFirstOrThrow({
      where: { eventType: 'OPERATOR_EMAIL_CORRECTED', requestId: 'operator-test:correction' },
    });
    expect(audit.metadata).toMatchObject({
      userId: target.userId,
      membershipId: target.membershipId,
      emailChanged: true,
      emailVerification: 'operator-established',
      sessionsRevoked: 1,
      passwordResetTokensRevoked: 1,
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('corrected@example.test');
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: 'corrected@example.test',
    })).resolves.toMatchObject({
      emailIdentifierCount: 1,
      emailDestinationMatches: true,
      emailVerified: true,
      tenantAdminPresent: true,
    });
  });

  it('preserves the membership identity, roles, and username', async () => {
    const before = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: target.membershipId },
      include: { roles: { include: { role: true } } },
    });
    await correction.correct(input(target, 'new@example.test'));
    const after = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: target.membershipId },
      include: { roles: { include: { role: true } } },
    });
    expect(after.id).toBe(before.id);
    expect(after.userId).toBe(before.userId);
    expect(after.tenantRealmId).toBe(before.tenantRealmId);
    expect(after.status).toBe(MembershipStatus.ACTIVE);
    expect(after.roles.map(({ role }) => role.code)).toEqual([RoleCode.TENANT_ADMIN]);
    expect(await prisma.loginIdentifier.findFirstOrThrow({
      where: { userId: target.userId, kind: LoginIdentifierKind.USERNAME },
    })).toMatchObject({ normalizedValue: 'target.admin', tenantRealmId: target.tenantId });
  });

  it('does not change the password or assign SYSTEM_ADMIN', async () => {
    const passwordBefore = await prisma.passwordCredential.findUniqueOrThrow({ where: { userId: target.userId } });
    await correction.correct(input(target, 'new@example.test'));
    const passwordAfter = await prisma.passwordCredential.findUniqueOrThrow({ where: { userId: target.userId } });
    expect(passwordAfter.passwordHash).toBe(passwordBefore.passwordHash);
    expect(await prisma.userRole.count({ where: { userId: target.userId } })).toBe(0);
    expect(await prisma.membershipRole.count({ where: { membershipId: target.membershipId } })).toBe(1);
  });

  it('returns already-compatible without additional mutations on rerun', async () => {
    const first = await correction.correct(input(target, 'new@example.test'));
    const auditCount = await prisma.authAuditEvent.count();
    const outboxCount = await prisma.outboxEvent.count();
    const second = await correction.correct(input(target, 'NEW@EXAMPLE.TEST'));
    expect(first.status).toBe('corrected');
    expect(second).toMatchObject({ status: 'already-compatible', sessionsRevoked: 0, passwordResetTokensRevoked: 0 });
    expect(await prisma.authAuditEvent.count()).toBe(auditCount);
    expect(await prisma.outboxEvent.count()).toBe(outboxCount);
  });

  it('establishes verification for an existing unverified replacement email', async () => {
    await prisma.loginIdentifier.updateMany({
      where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL },
      data: { verifiedAt: null },
    });
    await correction.correct(input(target, target.oldEmail));
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: target.oldEmail,
    })).resolves.toMatchObject({ emailIdentifierCount: 1, emailVerified: true });
  });

  it('creates and verifies an email identifier when the user has none', async () => {
    await prisma.loginIdentifier.deleteMany({ where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL } });
    await correction.correct(input(target, 'created@example.test'));
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: 'created@example.test',
    })).resolves.toMatchObject({ emailIdentifierCount: 1, emailVerified: true });
  });

  it('reports an unverified or mismatched email without mutating state', async () => {
    await prisma.loginIdentifier.updateMany({
      where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL },
      data: { verifiedAt: null },
    });
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: target.oldEmail,
    })).resolves.toMatchObject({ emailIdentifierCount: 1, emailDestinationMatches: true, emailVerified: false });
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: 'different@example.test',
    })).resolves.toMatchObject({ emailIdentifierCount: 1, emailDestinationMatches: false, emailVerified: false });
  });

  it('reports missing EMAIL state without mutating the account', async () => {
    await prisma.loginIdentifier.deleteMany({ where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL } });
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: target.oldEmail,
    })).resolves.toMatchObject({
      emailIdentifierCount: 0,
      emailDestinationMatches: false,
      emailVerified: false,
      tenantAdminPresent: true,
    });
  });

  it('reports missing TENANT_ADMIN state without mutating the account', async () => {
    await prisma.membershipRole.deleteMany({ where: { membershipId: target.membershipId } });
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: target.oldEmail,
    })).resolves.toMatchObject({
      emailIdentifierCount: 1,
      emailDestinationMatches: true,
      emailVerified: true,
      tenantAdminPresent: false,
    });
  });

  it('refuses ambiguous multiple-email state', async () => {
    await prisma.loginIdentifier.create({
      data: { userId: target.userId, kind: LoginIdentifierKind.EMAIL, normalizedValue: 'alternate@example.test' },
    });
    await expect(verification.verify({
      tenantId: target.tenantId,
      username: 'target.admin',
      email: target.oldEmail,
    })).rejects.toBeInstanceOf(IdentityEmailVerificationConflictError);
  });

  it('rejects a replacement email used by another user', async () => {
    const other = await prisma.identityUser.create({ data: {} });
    await prisma.loginIdentifier.create({
      data: { userId: other.id, kind: LoginIdentifierKind.EMAIL, normalizedValue: 'new@example.test', verifiedAt: new Date() },
    });
    await expect(correction.correct(input(target, 'new@example.test'))).rejects.toBeInstanceOf(
      IdentityEmailCorrectionConflictError,
    );
    expect(await prisma.loginIdentifier.findFirstOrThrow({ where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL } })).toMatchObject({
      normalizedValue: target.oldEmail,
    });
  });

  it('rejects a wrong tenant without mutating the target', async () => {
    await expect(correction.correct({ ...input(target, 'new@example.test'), tenantId: target.otherTenantId })).rejects.toBeInstanceOf(
      IdentityEmailCorrectionConflictError,
    );
    expect(await prisma.loginIdentifier.findFirstOrThrow({ where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL } })).toMatchObject({
      normalizedValue: target.oldEmail,
    });
  });

  it('rejects a wrong username without mutating the target', async () => {
    await expect(correction.correct({ ...input(target, 'new@example.test'), username: 'different.admin' })).rejects.toBeInstanceOf(
      IdentityEmailCorrectionConflictError,
    );
    expect(await prisma.loginIdentifier.findFirstOrThrow({ where: { userId: target.userId, kind: LoginIdentifierKind.EMAIL } })).toMatchObject({
      normalizedValue: target.oldEmail,
    });
  });

  it('rejects inactive users and memberships', async () => {
    await prisma.identityUser.update({ where: { id: target.userId }, data: { status: IdentityUserStatus.DISABLED } });
    await expect(correction.correct(input(target, 'new@example.test'))).rejects.toBeInstanceOf(
      IdentityEmailCorrectionConflictError,
    );
    await prisma.identityUser.update({ where: { id: target.userId }, data: { status: IdentityUserStatus.ACTIVE } });
    await prisma.tenantMembership.update({ where: { id: target.membershipId }, data: { status: MembershipStatus.SUSPENDED } });
    await expect(correction.correct(input(target, 'new@example.test'))).rejects.toBeInstanceOf(
      IdentityEmailCorrectionConflictError,
    );
  });

  it('does not mutate a second tenant with the same username', async () => {
    const otherUser = await prisma.identityUser.create({ data: {} });
    const otherMembership = await prisma.tenantMembership.create({
      data: { userId: otherUser.id, tenantRealmId: target.otherTenantId, status: MembershipStatus.ACTIVE },
    });
    await prisma.loginIdentifier.createMany({
      data: [
        { userId: otherUser.id, tenantRealmId: target.otherTenantId, kind: LoginIdentifierKind.USERNAME, normalizedValue: 'target.admin' },
        { userId: otherUser.id, kind: LoginIdentifierKind.EMAIL, normalizedValue: 'other@example.test', verifiedAt: new Date() },
      ],
    });
    await prisma.membershipRole.create({ data: { membershipId: otherMembership.id, roleId: target.tenantAdminRoleId } });
    const otherSession = await createSession(prisma, otherUser.id, otherMembership.id);

    await correction.correct(input(target, 'new@example.test'));

    expect(await prisma.loginIdentifier.findFirstOrThrow({ where: { userId: otherUser.id, kind: LoginIdentifierKind.EMAIL } })).toMatchObject({
      normalizedValue: 'other@example.test',
    });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: otherSession.id } })).toHaveProperty('revokedAt', null);
  });
});

describe('operator Identity email correction CLI safety', () => {
  it('parses the tenant and username selectors and rejects unsafe request IDs', () => {
    expect(parseIdentityEmailCorrectionArguments([
      '--tenant-id', '6DC797A8-2012-4C28-B212-C1449109A12F',
      '--username', 'Target.Admin',
      '--email', 'New@Example.Test',
      '--request-id', 'change:2026-08-13',
    ])).toEqual({
      tenantId: '6dc797a8-2012-4c28-b212-c1449109a12f',
      username: 'Target.Admin',
      email: 'New@Example.Test',
      requestId: 'change:2026-08-13',
    });
    expect(() => parseIdentityEmailCorrectionArguments([
      '--tenant-id', randomUUID(), '--username', 'target.admin', '--email', 'new@example.test', '--request-id', 'bad value',
    ])).toThrow('request-id');
  });

  it('formats only safe structured evidence', () => {
    const output = formatIdentityEmailCorrectionOutput({
      status: 'corrected',
      userId: randomUUID(),
      membershipId: randomUUID(),
      tenantId: randomUUID(),
      username: 'target.admin',
      destinationEmail: 'n***@e***.test',
      sessionsRevoked: 1,
      passwordResetTokensRevoked: 1,
      invitationsRevoked: 0,
      activationChallengesRevoked: 0,
      requestId: 'operator:test',
    });
    expect(output).not.toContain('passwordHash');
    expect(output).not.toContain('tokenHash');
    expect(output).not.toContain('new@example.test');
  });

  it('formats only masked read-only verification evidence', () => {
    const output = formatIdentityEmailVerificationOutput({
      userId: randomUUID(),
      membershipId: randomUUID(),
      tenantId: randomUUID(),
      username: 'target.admin',
      destinationEmail: 'n***@e***.test',
      emailIdentifierCount: 1,
      emailDestinationMatches: true,
      emailVerified: true,
      tenantAdminPresent: true,
    });
    expect(output).not.toContain('new@example.test');
    expect(output).not.toContain('passwordHash');
  });

  it('passes the fully compatible state with exit code 0', () => {
    const result = verificationResult();
    expect(getIdentityEmailVerificationExitCode(result)).toBe(0);
    expect(() => assertIdentityEmailVerificationPostconditions(result)).not.toThrow();
  });

  it.each([
    ['verifiedAt NULL', { emailVerified: false }],
    ['expected email mismatch', { emailDestinationMatches: false, emailVerified: false }],
    ['no EMAIL', { emailIdentifierCount: 0, emailDestinationMatches: false, emailVerified: false }],
    ['multiple EMAIL', { emailIdentifierCount: 2 }],
    ['TENANT_ADMIN missing', { tenantAdminPresent: false }],
  ])('fails closed for %s with exit code 1', (_state, overrides) => {
    const result = verificationResult(overrides);
    expect(getIdentityEmailVerificationExitCode(result)).toBe(1);
    expect(() => assertIdentityEmailVerificationPostconditions(result)).toThrow(IdentityEmailVerificationGateError);
  });

  it('does not write through Prisma while verifying', async () => {
    const writeAttempt = vi.fn(() => {
      throw new Error('verification attempted a write');
    });
    const userId = randomUUID();
    const membershipId = randomUUID();
    const tenantId = randomUUID();
    const readOnlyPrisma = {
      tenantRealm: {
        findUnique: vi.fn().mockResolvedValue({ status: TenantRealmStatus.ACTIVE }),
        create: writeAttempt,
        update: writeAttempt,
        delete: writeAttempt,
      },
      loginIdentifier: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ userId }])
          .mockResolvedValueOnce([{ normalizedValue: 'target@example.test', verifiedAt: new Date() }]),
        create: writeAttempt,
        update: writeAttempt,
        delete: writeAttempt,
      },
      tenantMembership: {
        findMany: vi.fn().mockResolvedValue([{ id: membershipId }]),
        create: writeAttempt,
        update: writeAttempt,
        delete: writeAttempt,
      },
      membershipRole: {
        count: vi.fn().mockResolvedValue(1),
        create: writeAttempt,
        update: writeAttempt,
        delete: writeAttempt,
      },
      $transaction: writeAttempt,
    } as unknown as PrismaService;

    await expect(new IdentityEmailVerificationService(
      readOnlyPrisma,
      new IdentifierNormalizationService(),
    ).verify({ tenantId, username: 'target.admin', email: 'target@example.test' })).resolves.toMatchObject({
      emailIdentifierCount: 1,
      emailDestinationMatches: true,
      emailVerified: true,
      tenantAdminPresent: true,
    });
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});

function verificationResult(
  overrides: Partial<IdentityEmailVerificationResult> = {},
): IdentityEmailVerificationResult {
  return {
    userId: randomUUID(),
    membershipId: randomUUID(),
    tenantId: randomUUID(),
    username: 'target.admin',
    destinationEmail: 't***@e***.test',
    emailIdentifierCount: 1,
    emailDestinationMatches: true,
    emailVerified: true,
    tenantAdminPresent: true,
    ...overrides,
  };
}

function input(target: Awaited<ReturnType<typeof createFixture>>, email: string) {
  return {
    tenantId: target.tenantId,
    username: 'target.admin',
    email,
    requestId: `operator-test:${randomUUID()}`,
  };
}

async function createFixture(prisma: PrismaClient) {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  await prisma.tenantRealm.createMany({
    data: [
      { id: tenantId, handle: `correction-a-${randomUUID().slice(0, 8)}` },
      { id: otherTenantId, handle: `correction-b-${randomUUID().slice(0, 8)}` },
    ],
  });
  const tenantAdminRole = await prisma.role.create({
    data: { id: randomUUID(), code: RoleCode.TENANT_ADMIN, scope: RoleScope.TENANT },
  });
  await prisma.role.create({ data: { id: randomUUID(), code: RoleCode.SYSTEM_ADMIN, scope: RoleScope.PLATFORM } });
  const user = await prisma.identityUser.create({ data: {} });
  await prisma.passwordCredential.create({
    data: { userId: user.id, passwordHash: 'known-password-hash', passwordSetAt: new Date() },
  });
  const membership = await prisma.tenantMembership.create({
    data: { userId: user.id, tenantRealmId: tenantId, status: MembershipStatus.ACTIVE, activatedAt: new Date() },
  });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: tenantAdminRole.id } });
  await prisma.loginIdentifier.createMany({
    data: [
      { userId: user.id, tenantRealmId: tenantId, kind: LoginIdentifierKind.USERNAME, normalizedValue: 'target.admin' },
      { userId: user.id, kind: LoginIdentifierKind.EMAIL, normalizedValue: 'old@example.test', verifiedAt: new Date() },
    ],
  });
  return {
    tenantId,
    otherTenantId,
    userId: user.id,
    membershipId: membership.id,
    tenantAdminRoleId: tenantAdminRole.id,
    oldEmail: 'old@example.test',
  };
}

async function createSession(prisma: PrismaClient, userId: string, membershipId: string) {
  const id = randomUUID();
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + 3_600_000);
  const session = await prisma.session.create({
    data: {
      id,
      userId,
      activeMembershipId: membershipId,
      refreshTokenFamilyId: familyId,
      idleExpiresAt: expiresAt,
      absoluteExpiresAt: expiresAt,
    },
  });
  await prisma.refreshToken.create({
    data: { id: randomUUID(), sessionId: id, familyId, tokenHash: 'synthetic-refresh-hash', expiresAt },
  });
  return session;
}

async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.outboxEvent.deleteMany();
  await prisma.authAuditEvent.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.activationChallenge.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.membershipRole.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.loginIdentifier.deleteMany();
  await prisma.tenantMembership.deleteMany();
  await prisma.role.deleteMany();
  await prisma.tenantRealm.deleteMany();
  await prisma.passwordCredential.deleteMany();
  await prisma.identityUser.deleteMany();
}
