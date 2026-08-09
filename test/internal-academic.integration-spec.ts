import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { exportJWK, importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApplication } from '../src/bootstrap.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  MembershipStatus,
  RoleCode,
  RoleScope,
} from '../src/generated/prisma/enums.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const currentServiceToken = randomBytes(32).toString('base64url');
const previousServiceToken = randomBytes(32).toString('base64url');

interface Fixture {
  tenantAId: string;
  tenantBId: string;
  actorUserId: string;
  actorMembershipId: string;
  actorSessionId: string;
  nonAdminUserId: string;
  nonAdminMembershipId: string;
  nonAdminSessionId: string;
  systemAdminUserId: string;
  systemAdminSessionId: string;
  pendingStudentUserId: string;
  pendingStudentMembershipId: string;
  activeStudentUserId: string;
  activeStudentMembershipId: string;
  activeTeacherUserId: string;
  activeTeacherMembershipId: string;
  otherTenantStudentUserId: string;
  suspendedStudentUserId: string;
  revokedStudentUserId: string;
}

describeWithDatabase('restricted Academic integration (PostgreSQL)', () => {
  let app: INestApplication;
  let directory: string;
  let privateKeyPem: string;
  let prisma: PrismaClient;
  let fixture: Fixture;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edupay-identity-internal-academic-'));
    const privateKeyPath = join(directory, 'private.pem');
    const jwksPath = join(directory, 'public.jwks.json');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await writeFile(privateKeyPath, privateKeyPem);
    await writeFile(
      jwksPath,
      JSON.stringify({
        keys: [
          {
            ...(await exportJWK(publicKey)),
            kid: 'internal-academic-key',
            alg: 'RS256',
            use: 'sig',
          },
        ],
      }),
    );

    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: databaseUrl,
      JWT_ISSUER: 'https://identity.test.edupay.example',
      JWT_AUDIENCE: 'edupay-academico-api',
      JWT_ACCESS_TTL_SECONDS: '600',
      JWT_ALGORITHM: 'RS256',
      JWT_KEY_ID: 'internal-academic-key',
      JWT_PRIVATE_KEY_PATH: privateKeyPath,
      JWT_PUBLIC_JWKS_PATH: jwksPath,
      JWKS_CACHE_MAX_AGE_SECONDS: '300',
      IDENTITY_TRUSTED_WEB_ORIGINS: 'https://academico.test',
      IDENTITY_COOKIE_SECURE: 'true',
      IDENTITY_REFRESH_COOKIE_SAMESITE: 'lax',
      ARGON2_MEMORY_COST: '8192',
      ARGON2_TIME_COST: '2',
      ARGON2_PARALLELISM: '1',
      ARGON2_HASH_LENGTH: '32',
      ARGON2_SALT_LENGTH: '16',
      OPAQUE_TOKEN_BYTES: '32',
      RATE_LIMIT_WINDOW_SECONDS: '900',
      RATE_LIMIT_LOGIN_MAX: '1000',
      RATE_LIMIT_REFRESH_MAX: '1000',
      RATE_LIMIT_INTERNAL_MAX: '100000',
      IDENTITY_ACADEMICO_SERVICE_TOKEN: currentServiceToken,
      IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS: previousServiceToken,
      IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT: new Date(
        Date.now() + 60 * 60 * 1_000,
      ).toISOString(),
    });

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    fixture = await seedFixture(prisma);
  });

  afterAll(async () => {
    if (prisma) await clearDatabase(prisma);
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('accepts the current token and bounded previous rotation token', async () => {
    await statusRequest(fixture.actorSessionId, currentServiceToken).expect(200);
    await statusRequest(fixture.actorSessionId, previousServiceToken).expect(200);
  });

  it('denies missing, wrong, browser-origin, and ordinary end-user bearer credentials safely', async () => {
    await request(app.getHttpServer())
      .get(`/internal/v1/sessions/${fixture.actorSessionId}/status`)
      .expect(401);

    const wrongToken = randomBytes(32).toString('base64url');
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wrong = await statusRequest(fixture.actorSessionId, wrongToken).expect(401);
    expect(JSON.stringify(wrong.body)).not.toContain(wrongToken);
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain(wrongToken);
    logSpy.mockRestore();

    await statusRequest(fixture.actorSessionId, currentServiceToken)
      .set('Origin', 'https://academico.test')
      .expect(403);

    const accessToken = await signOrdinaryAccessToken();
    const jwtResponse = await statusRequest(fixture.actorSessionId, accessToken).expect(401);
    expect(JSON.stringify(jwtResponse.body)).not.toContain(accessToken);
  });

  it('returns the exact current session and membership state without credentials or PII', async () => {
    const response = await statusRequest(fixture.actorSessionId, currentServiceToken)
      .set('X-Request-Id', 'req_internal-status')
      .expect(200);

    expect(response.body).toEqual({
      active: true,
      identityUserId: fixture.actorUserId,
      membershipActive: true,
      membershipId: fixture.actorMembershipId,
      sessionActive: true,
      sessionId: fixture.actorSessionId,
      tenantId: fixture.tenantAId,
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'active',
      'identityUserId',
      'membershipActive',
      'membershipId',
      'sessionActive',
      'sessionId',
      'tenantId',
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/access|refresh|password|email/i);
    expect(response.headers['x-request-id']).toBe('req_internal-status');
  });

  it('reports revoked sessions and inactive memberships without caller-manufactured tenant context', async () => {
    await prisma.session.update({
      where: { id: fixture.actorSessionId },
      data: { revokedAt: new Date(), revocationReason: 'TEST_REVOKED' },
    });
    const revoked = await statusRequest(fixture.actorSessionId, currentServiceToken).expect(200);
    expect(revoked.body).toMatchObject({ active: false, sessionActive: false });

    fixture = await resetFixture(prisma);
    await prisma.session.update({
      where: { id: fixture.actorSessionId },
      data: { idleExpiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await statusRequest(fixture.actorSessionId, currentServiceToken).expect(200);
    expect(expired.body).toMatchObject({ active: false, sessionActive: false });

    fixture = await resetFixture(prisma);
    await prisma.tenantMembership.update({
      where: { id: fixture.actorMembershipId },
      data: { status: MembershipStatus.SUSPENDED, suspendedAt: new Date() },
    });
    const inactive = await statusRequest(fixture.actorSessionId, currentServiceToken).expect(200);
    expect(inactive.body).toMatchObject({
      active: false,
      sessionActive: true,
      membershipActive: false,
    });

    fixture = await resetFixture(prisma);
    const selected = await statusRequest(fixture.actorSessionId, currentServiceToken)
      .query({ tenantId: fixture.tenantBId, membershipId: randomUUID() })
      .expect(200);
    expect(selected.body.tenantId).toBe(fixture.tenantAId);
    expect(selected.body.membershipId).toBe(fixture.actorMembershipId);
  });

  it('returns the same safe not-found error for unknown session identifiers', async () => {
    const first = await statusRequest(randomUUID(), currentServiceToken).expect(404);
    const second = await statusRequest(randomUUID(), currentServiceToken).expect(404);
    expect(stripRequestId(first.body)).toEqual(stripRequestId(second.body));
  });

  it('verifies exact PENDING_ACTIVATION and ACTIVE STUDENT memberships', async () => {
    const pending = await resolveRequest(
      fixture.pendingStudentUserId,
      RoleCode.STUDENT,
    ).expect(200);
    expect(pending.body).toEqual({
      verified: true,
      identityUserId: fixture.pendingStudentUserId,
      membershipId: fixture.pendingStudentMembershipId,
      tenantId: fixture.tenantAId,
      membershipStatus: MembershipStatus.PENDING_ACTIVATION,
      roles: [RoleCode.STUDENT],
    });

    const active = await resolveRequest(
      fixture.activeStudentUserId,
      RoleCode.STUDENT,
    ).expect(200);
    expect(active.body).toMatchObject({
      verified: true,
      identityUserId: fixture.activeStudentUserId,
      membershipId: fixture.activeStudentMembershipId,
      tenantId: fixture.tenantAId,
      membershipStatus: MembershipStatus.ACTIVE,
      roles: [RoleCode.STUDENT],
    });
  });

  it('verifies an exact active TEACHER membership', async () => {
    const response = await resolveRequest(
      fixture.activeTeacherUserId,
      RoleCode.TEACHER,
    ).expect(200);
    expect(response.body).toEqual({
      verified: true,
      identityUserId: fixture.activeTeacherUserId,
      membershipId: fixture.activeTeacherMembershipId,
      tenantId: fixture.tenantAId,
      membershipStatus: MembershipStatus.ACTIVE,
      roles: [RoleCode.TEACHER],
    });
  });

  it('rejects cross-tenant, wrong-role, suspended, revoked, and unknown targets uniformly', async () => {
    const attempts = [
      [fixture.otherTenantStudentUserId, RoleCode.STUDENT],
      [fixture.activeTeacherUserId, RoleCode.STUDENT],
      [fixture.suspendedStudentUserId, RoleCode.STUDENT],
      [fixture.revokedStudentUserId, RoleCode.STUDENT],
      [randomUUID(), RoleCode.STUDENT],
    ] as const;
    const bodies: unknown[] = [];
    for (const [targetIdentityUserId, expectedRole] of attempts) {
      const response = await resolveRequest(targetIdentityUserId, expectedRole).expect(404);
      bodies.push(stripRequestId(response.body));
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  });

  it('rejects revoked actor sessions and inactive actor memberships', async () => {
    await prisma.session.update({
      where: { id: fixture.actorSessionId },
      data: { revokedAt: new Date(), revocationReason: 'TEST_REVOKED' },
    });
    await resolveRequest(fixture.activeStudentUserId, RoleCode.STUDENT).expect(403);

    fixture = await resetFixture(prisma);
    await prisma.tenantMembership.update({
      where: { id: fixture.actorMembershipId },
      data: { status: MembershipStatus.SUSPENDED, suspendedAt: new Date() },
    });
    await resolveRequest(fixture.activeStudentUserId, RoleCode.STUDENT).expect(403);
  });

  it('rejects a non-admin actor and SYSTEM_ADMIN without tenant membership', async () => {
    await resolveWithActor(
      {
        identityUserId: fixture.nonAdminUserId,
        sessionId: fixture.nonAdminSessionId,
        membershipId: fixture.nonAdminMembershipId,
        tenantId: fixture.tenantAId,
      },
      fixture.activeStudentUserId,
      RoleCode.STUDENT,
    ).expect(403);

    await resolveWithActor(
      {
        identityUserId: fixture.systemAdminUserId,
        sessionId: fixture.systemAdminSessionId,
        membershipId: randomUUID(),
        tenantId: fixture.tenantAId,
      },
      fixture.activeStudentUserId,
      RoleCode.STUDENT,
    ).expect(403);
  });

  it('does not expose an unbounded directory or accept search-shaped resolve input', async () => {
    await request(app.getHttpServer())
      .get('/internal/v1/identity-users')
      .set(serviceAuthorization(currentServiceToken))
      .expect(404);
    await request(app.getHttpServer())
      .post('/internal/v1/identity-users/resolve')
      .set(serviceAuthorization(currentServiceToken))
      .send({
        actor: actorBody(),
        targetIdentityUserId: fixture.activeStudentUserId,
        expectedRole: RoleCode.STUDENT,
        search: 'student',
      })
      .expect(400);
    const oversized = await request(app.getHttpServer())
      .post('/internal/v1/identity-users/resolve')
      .set(serviceAuthorization(currentServiceToken))
      .send({
        actor: actorBody(),
        targetIdentityUserId: fixture.activeStudentUserId,
        expectedRole: RoleCode.STUDENT,
        padding: 'x'.repeat(17_000),
      })
      .expect(413);
    expect(oversized.body.error.code).toBe('REQUEST_TOO_LARGE');
    await request(app.getHttpServer())
      .get(`/api/internal/v1/sessions/${fixture.actorSessionId}/status`)
      .set(serviceAuthorization(currentServiceToken))
      .expect(404);
  });

  function statusRequest(sessionId: string, token: string) {
    return request(app.getHttpServer())
      .get(`/internal/v1/sessions/${sessionId}/status`)
      .set(serviceAuthorization(token));
  }

  function resolveRequest(
    targetIdentityUserId: string,
    expectedRole: typeof RoleCode.STUDENT | typeof RoleCode.TEACHER,
  ) {
    return resolveWithActor(actorBody(), targetIdentityUserId, expectedRole);
  }

  function resolveWithActor(
    actor: ReturnType<typeof actorBody>,
    targetIdentityUserId: string,
    expectedRole: typeof RoleCode.STUDENT | typeof RoleCode.TEACHER,
  ) {
    return request(app.getHttpServer())
      .post('/internal/v1/identity-users/resolve')
      .set(serviceAuthorization(currentServiceToken))
      .set('X-Request-Id', `req_${randomUUID()}`)
      .send({ actor, targetIdentityUserId, expectedRole });
  }

  function actorBody() {
    return {
      identityUserId: fixture.actorUserId,
      sessionId: fixture.actorSessionId,
      membershipId: fixture.actorMembershipId,
      tenantId: fixture.tenantAId,
    };
  }

  async function signOrdinaryAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    const key = await importPKCS8(privateKeyPem, 'RS256');
    return new SignJWT({
      sid: fixture.actorSessionId,
      jti: randomUUID(),
      tenant_id: fixture.tenantAId,
      membership_id: fixture.actorMembershipId,
      roles: [RoleCode.TENANT_ADMIN],
      scope: ['academic:use'],
      auth_time: now,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'internal-academic-key', typ: 'JWT' })
      .setIssuer('https://identity.test.edupay.example')
      .setAudience('edupay-academico-api')
      .setSubject(fixture.actorUserId)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 600)
      .sign(key);
  }
});

function serviceAuthorization(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function stripRequestId(body: unknown): unknown {
  const copy = structuredClone(body) as { error?: { requestId?: string } };
  if (copy.error) delete copy.error.requestId;
  return copy;
}

async function resetFixture(prisma: PrismaClient): Promise<Fixture> {
  await clearDatabase(prisma);
  return seedFixture(prisma);
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

async function seedFixture(prisma: PrismaClient): Promise<Fixture> {
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  await prisma.tenantRealm.createMany({
    data: [
      { id: tenantAId, handle: `tenant-a-${randomUUID().slice(0, 8)}` },
      { id: tenantBId, handle: `tenant-b-${randomUUID().slice(0, 8)}` },
    ],
  });

  const tenantAdminRole = await prisma.role.create({
    data: { code: RoleCode.TENANT_ADMIN, scope: RoleScope.TENANT },
  });
  const studentRole = await prisma.role.create({
    data: { code: RoleCode.STUDENT, scope: RoleScope.TENANT },
  });
  const teacherRole = await prisma.role.create({
    data: { code: RoleCode.TEACHER, scope: RoleScope.TENANT },
  });
  const systemAdminRole = await prisma.role.create({
    data: { code: RoleCode.SYSTEM_ADMIN, scope: RoleScope.PLATFORM },
  });

  const ids = {
    actorUserId: randomUUID(),
    nonAdminUserId: randomUUID(),
    systemAdminUserId: randomUUID(),
    pendingStudentUserId: randomUUID(),
    activeStudentUserId: randomUUID(),
    activeTeacherUserId: randomUUID(),
    otherTenantStudentUserId: randomUUID(),
    suspendedStudentUserId: randomUUID(),
    revokedStudentUserId: randomUUID(),
  };
  await prisma.identityUser.createMany({
    data: Object.values(ids).map((id) => ({ id })),
  });
  await prisma.userRole.create({
    data: { userId: ids.systemAdminUserId, roleId: systemAdminRole.id },
  });

  const memberships = {
    actorMembershipId: randomUUID(),
    nonAdminMembershipId: randomUUID(),
    pendingStudentMembershipId: randomUUID(),
    activeStudentMembershipId: randomUUID(),
    activeTeacherMembershipId: randomUUID(),
    otherTenantStudentMembershipId: randomUUID(),
    suspendedStudentMembershipId: randomUUID(),
    revokedStudentMembershipId: randomUUID(),
  };
  await prisma.tenantMembership.createMany({
    data: [
      {
        id: memberships.actorMembershipId,
        userId: ids.actorUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: memberships.nonAdminMembershipId,
        userId: ids.nonAdminUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: memberships.pendingStudentMembershipId,
        userId: ids.pendingStudentUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.PENDING_ACTIVATION,
      },
      {
        id: memberships.activeStudentMembershipId,
        userId: ids.activeStudentUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: memberships.activeTeacherMembershipId,
        userId: ids.activeTeacherUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: memberships.otherTenantStudentMembershipId,
        userId: ids.otherTenantStudentUserId,
        tenantRealmId: tenantBId,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: memberships.suspendedStudentMembershipId,
        userId: ids.suspendedStudentUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.SUSPENDED,
        suspendedAt: new Date(),
      },
      {
        id: memberships.revokedStudentMembershipId,
        userId: ids.revokedStudentUserId,
        tenantRealmId: tenantAId,
        status: MembershipStatus.REVOKED,
        revokedAt: new Date(),
      },
    ],
  });
  await prisma.membershipRole.createMany({
    data: [
      { membershipId: memberships.actorMembershipId, roleId: tenantAdminRole.id },
      { membershipId: memberships.nonAdminMembershipId, roleId: teacherRole.id },
      { membershipId: memberships.pendingStudentMembershipId, roleId: studentRole.id },
      { membershipId: memberships.activeStudentMembershipId, roleId: studentRole.id },
      { membershipId: memberships.activeTeacherMembershipId, roleId: teacherRole.id },
      { membershipId: memberships.otherTenantStudentMembershipId, roleId: studentRole.id },
      { membershipId: memberships.suspendedStudentMembershipId, roleId: studentRole.id },
      { membershipId: memberships.revokedStudentMembershipId, roleId: studentRole.id },
    ],
  });

  const actorSessionId = await createSession(prisma, ids.actorUserId, memberships.actorMembershipId);
  const nonAdminSessionId = await createSession(
    prisma,
    ids.nonAdminUserId,
    memberships.nonAdminMembershipId,
  );
  const systemAdminSessionId = await createSession(prisma, ids.systemAdminUserId, null);

  return {
    tenantAId,
    tenantBId,
    actorUserId: ids.actorUserId,
    actorMembershipId: memberships.actorMembershipId,
    actorSessionId,
    nonAdminUserId: ids.nonAdminUserId,
    nonAdminMembershipId: memberships.nonAdminMembershipId,
    nonAdminSessionId,
    systemAdminUserId: ids.systemAdminUserId,
    systemAdminSessionId,
    pendingStudentUserId: ids.pendingStudentUserId,
    pendingStudentMembershipId: memberships.pendingStudentMembershipId,
    activeStudentUserId: ids.activeStudentUserId,
    activeStudentMembershipId: memberships.activeStudentMembershipId,
    activeTeacherUserId: ids.activeTeacherUserId,
    activeTeacherMembershipId: memberships.activeTeacherMembershipId,
    otherTenantStudentUserId: ids.otherTenantStudentUserId,
    suspendedStudentUserId: ids.suspendedStudentUserId,
    revokedStudentUserId: ids.revokedStudentUserId,
  };
}

async function createSession(
  prisma: PrismaClient,
  userId: string,
  activeMembershipId: string | null,
): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId,
      activeMembershipId,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    },
  });
  return session.id;
}
