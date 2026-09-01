import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  LoginIdentifierKind,
  MembershipStatus,
  RoleCode,
  RoleScope,
} from '../src/generated/prisma/enums.js';
import { argon2id, hash } from 'argon2';
import { exportJWK } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApplication } from '../src/bootstrap.js';
import { EmailDeliveryAdapter } from '../src/email/email.types.js';
import type { EmailDeliveryResult, EmailMessage } from '../src/email/email.types.js';
import { EmailOutboxService } from '../src/email/email-outbox.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
let lifecycleApp: INestApplication;
let lifecycleAdminPassword = '';

class FakeEmailAdapter extends EmailDeliveryAdapter {
  readonly messages: Array<{ message: EmailMessage; deliveryKey: string }> = [];

  send(message: EmailMessage, deliveryKey: string): Promise<EmailDeliveryResult> {
    this.messages.push({ message, deliveryKey });
    return Promise.resolve({ providerResponseId: `fake_${deliveryKey}` });
  }
}

describeWithDatabase('account lifecycle (PostgreSQL integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let directory: string;
  let fakeEmail: FakeEmailAdapter;
  let emailOutbox: EmailOutboxService;
  let adminPassword: string;
  let tenantA: { id: string; handle: string };
  let tenantB: { id: string; handle: string };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edupay-identity-lifecycle-'));
    const privateKeyPath = join(directory, 'private.pem');
    const jwksPath = join(directory, 'public.jwks.json');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(
      jwksPath,
      JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: 'lifecycle-key', alg: 'RS256', use: 'sig' }] }),
    );
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: databaseUrl,
      JWT_ISSUER: 'https://identity.lifecycle.test',
      JWT_AUDIENCE: 'edupay-academico-api',
      JWT_ACCESS_TTL_SECONDS: '600',
      JWT_ALGORITHM: 'RS256',
      JWT_KEY_ID: 'lifecycle-key',
      JWT_PRIVATE_KEY_PATH: privateKeyPath,
      JWT_PUBLIC_JWKS_PATH: jwksPath,
      JWKS_CACHE_MAX_AGE_SECONDS: '300',
      ARGON2_MEMORY_COST: '8192',
      ARGON2_TIME_COST: '2',
      ARGON2_PARALLELISM: '1',
      ARGON2_HASH_LENGTH: '32',
      ARGON2_SALT_LENGTH: '16',
      OPAQUE_TOKEN_BYTES: '32',
      REFRESH_IDLE_TTL_SECONDS: '2592000',
      SESSION_ABSOLUTE_TTL_SECONDS: '7776000',
      LOGOUT_ALL_REAUTH_MAX_AGE_SECONDS: '600',
      PASSWORD_LOCK_THRESHOLD: '100',
      PASSWORD_LOCK_SECONDS: '900',
      RATE_LIMIT_WINDOW_SECONDS: '900',
      RATE_LIMIT_LOGIN_MAX: '1000',
      RATE_LIMIT_REFRESH_MAX: '1000',
      RESEND_API_KEY: '',
      IDENTITY_EMAIL_FROM: 'EduPay Identity <identity@example.test>',
      IDENTITY_PUBLIC_BASE_URL: 'https://identity.lifecycle.test',
      IDENTITY_OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });

    const { AppModule } = await import('../src/app.module.js');
    fakeEmail = new FakeEmailAdapter();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailDeliveryAdapter)
      .useValue(fakeEmail)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    lifecycleApp = app;
    emailOutbox = app.get(EmailOutboxService);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    fakeEmail.messages.length = 0;
    tenantA = { id: randomUUID(), handle: `lifecycle-a-${randomUUID().slice(0, 8)}` };
    tenantB = { id: randomUUID(), handle: `lifecycle-b-${randomUUID().slice(0, 8)}` };
    await prisma.tenantRealm.createMany({ data: [tenantA, tenantB] });
    for (const code of [RoleCode.TENANT_ADMIN, RoleCode.STUDENT, RoleCode.TEACHER]) {
      await prisma.role.create({ data: { id: randomUUID(), code, scope: RoleScope.TENANT } });
    }
    adminPassword = 'admin-lifecycle-password';
    lifecycleAdminPassword = adminPassword;
    const admin = await prisma.identityUser.create({ data: {} });
    await prisma.passwordCredential.create({
      data: {
        userId: admin.id,
        passwordHash: await hash(adminPassword, { type: argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1, hashLength: 32 }),
        passwordSetAt: new Date(),
      },
    });
    await prisma.loginIdentifier.createMany({
      data: [
        { userId: admin.id, tenantRealmId: tenantA.id, kind: LoginIdentifierKind.USERNAME, normalizedValue: 'lifecycle.admin' },
        { userId: admin.id, tenantRealmId: tenantB.id, kind: LoginIdentifierKind.USERNAME, normalizedValue: 'lifecycle.admin' },
      ],
    });
    const adminMemberships = await prisma.tenantMembership.createManyAndReturn({
      data: [
        { userId: admin.id, tenantRealmId: tenantA.id, status: MembershipStatus.ACTIVE, activatedAt: new Date() },
        { userId: admin.id, tenantRealmId: tenantB.id, status: MembershipStatus.ACTIVE, activatedAt: new Date() },
      ],
    });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.TENANT_ADMIN } });
    await prisma.membershipRole.createMany({
      data: adminMemberships.map(({ id }) => ({ membershipId: id, roleId: adminRole.id })),
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it('provisions tenant-scoped users, rejects duplicates/cross-tenant access, and never returns a password', async () => {
    const admin = await loginAdmin(tenantA);
    const first = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ institutionalUsername: 'Shared.Student', roles: [RoleCode.STUDENT] })
      .expect(201);
    expect(first.body).toMatchObject({
      institutionalUsername: 'shared.student',
      status: MembershipStatus.PENDING_ACTIVATION,
      roles: [RoleCode.STUDENT],
    });
    expect(JSON.stringify(first.body)).not.toContain('password');

    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: first.body.userId, institutionalUsername: 'second.username', roles: [RoleCode.STUDENT] })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ institutionalUsername: 'SHARED.STUDENT', roles: [RoleCode.STUDENT] })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ institutionalUsername: 'another.student', roles: [RoleCode.TENANT_ADMIN] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantB.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ institutionalUsername: 'shared.student', roles: [RoleCode.STUDENT] })
      .expect(404);

    const switched = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions/current-context')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ membershipId: (await prisma.tenantMembership.findFirstOrThrow({ where: { tenantRealmId: tenantB.id } })).id })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantB.id}/memberships`)
      .set('Authorization', `Bearer ${switched.body.accessToken}`)
      .send({ institutionalUsername: 'shared.student', roles: [RoleCode.STUDENT] })
      .expect(201);
  });

  it('replays the persisted receipt, rejects payload collisions, and preserves the HTTP body', async () => {
    const admin = await loginAdmin(tenantA);
    const payload = { institutionalUsername: 'idempotent.student', roles: [RoleCode.STUDENT] };
    const first = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'provision-replay-1')
      .send(payload)
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'provision-replay-1')
      .send({ institutionalUsername: 'IDEMPOTENT.STUDENT', roles: [RoleCode.STUDENT] })
      .expect(201);

    expect(replay.text).toBe(first.text);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.provisioningIdempotencyReceipt.count()).toBe(1);
    const receipt = await prisma.provisioningIdempotencyReceipt.findFirstOrThrow();
    expect(receipt.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.responseBody).toBe(first.text);

    const collision = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'provision-replay-1')
      .send({ institutionalUsername: 'idempotent.student', roles: [RoleCode.TEACHER] })
      .expect(409);
    expect(collision.body.error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', details: [] });
    expect(await prisma.identityUser.count()).toBe(2);
    expect(await prisma.tenantMembership.count()).toBe(3);
  });

  it('collapses two concurrent PostgreSQL requests into one committed operation and receipt', async () => {
    const admin = await loginAdmin(tenantA);
    const send = () => request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', 'provision-concurrent-1')
      .send({ institutionalUsername: 'concurrent.student', roles: [RoleCode.STUDENT] });

    const [first, second] = await Promise.all([send(), send()]);
    expect([first.status, second.status].sort()).toEqual([201, 201]);
    expect(first.text).toBe(second.text);
    expect(first.body.membershipId).toBe(second.body.membershipId);
    expect(await prisma.identityUser.count()).toBe(2);
    expect(await prisma.tenantMembership.count()).toBe(3);
    expect(await prisma.provisioningIdempotencyReceipt.count()).toBe(1);

    const race = (key: string) => request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ institutionalUsername: 'unique-error-race.student', roles: [RoleCode.STUDENT] });
    const [raceFirst, raceSecond] = await Promise.all([race('unique-race-a'), race('unique-race-b')]);
    expect([raceFirst.status, raceSecond.status].sort()).toEqual([201, 409]);
    expect(raceFirst.status).not.toBe(500);
    expect(raceSecond.status).not.toBe(500);
  });

  it('rolls back users, membership, events, audit, and receipt when provisioning fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_test_provisioning_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW."eventType" = 'MEMBERSHIP_CREATED' THEN
          RAISE EXCEPTION 'forced disposable provisioning failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_test_provisioning_audit_trigger
      AFTER INSERT ON "auth_audit_events"
      FOR EACH ROW EXECUTE FUNCTION fail_test_provisioning_audit();
    `);
    const admin = await loginAdmin(tenantA);
    const before = await Promise.all([
      prisma.identityUser.count(),
      prisma.tenantMembership.count(),
      prisma.loginIdentifier.count(),
      prisma.membershipRole.count(),
      prisma.outboxEvent.count(),
      prisma.authAuditEvent.count(),
      prisma.provisioningIdempotencyReceipt.count(),
    ]);

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/tenants/${tenantA.id}/memberships`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', 'provision-rollback-1')
        .send({ institutionalUsername: 'rollback.student', roles: [RoleCode.STUDENT] })
        .expect(500);

      const after = await Promise.all([
        prisma.identityUser.count(),
        prisma.tenantMembership.count(),
        prisma.loginIdentifier.count(),
        prisma.membershipRole.count(),
        prisma.outboxEvent.count(),
        prisma.authAuditEvent.count(),
        prisma.provisioningIdempotencyReceipt.count(),
      ]);
      expect(after).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_test_provisioning_audit_trigger ON "auth_audit_events";');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_test_provisioning_audit();');
    }
  });

  it('sends invitation intent without returning or persisting the plaintext token, then activates with a user-chosen password', async () => {
    const admin = await loginAdmin(tenantA);
    const provisioned = await provision(admin, tenantA, 'teacher.email', 'teacher@example.test', RoleCode.TEACHER);
    const invitation = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships/${provisioned.membershipId}/invite`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    expect(invitation.body).not.toHaveProperty('invitationToken');
    expect(invitation.body).toHaveProperty('invitationId');
    expect(await prisma.outboxEvent.count({ where: { eventType: 'identity.email.invitation.v1' } })).toBe(1);

    await emailOutbox.deliverPending();
    const email = fakeEmail.messages.at(-1)!.message;
    const token = new URL(email.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.body.invitationId } });
    expect(stored.tokenHash).not.toContain(token);
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain(token);

    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/accept')
      .send({ invitationToken: token, password: 'teacher-chosen-password' })
      .expect(200);
    expect(await prisma.tenantMembership.findUniqueOrThrow({ where: { id: provisioned.membershipId } })).toMatchObject({ status: MembershipStatus.ACTIVE });
    expect(await prisma.loginIdentifier.findFirstOrThrow({ where: { userId: provisioned.userId, kind: LoginIdentifierKind.EMAIL } })).toHaveProperty('verifiedAt');
    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/accept')
      .send({ invitationToken: token, password: 'teacher-chosen-password' })
      .expect(410);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantHandle: tenantA.handle, identifier: 'teacher.email', password: 'teacher-chosen-password' })
      .expect(200);

    const expired = await provision(admin, tenantA, 'expired.invite', 'expired@example.test', RoleCode.TEACHER);
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships/${expired.membershipId}/invite`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    await emailOutbox.deliverPending();
    const expiredToken = new URL(fakeEmail.messages.at(-1)!.message.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    await prisma.invitation.update({ where: { id: (await prisma.invitation.findFirstOrThrow({ where: { membershipId: expired.membershipId } })).id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(app.getHttpServer()).post('/api/v1/auth/invitations/accept').send({ invitationToken: expiredToken, password: 'expired-invite-password' }).expect(410);
  });

  it('returns a no-store no-email activation code once and consumes it only with the bound username', async () => {
    const admin = await loginAdmin(tenantA);
    const provisioned = await provision(admin, tenantA, 'student.noemail', undefined, RoleCode.STUDENT);
    const challenge = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships/${provisioned.membershipId}/activation-challenge`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    expect(challenge.headers['cache-control']).toContain('no-store');
    expect(challenge.body.activationCode).toMatch(/^act_[0-9a-f-]+\./);
    const stored = await prisma.activationChallenge.findUniqueOrThrow({ where: { id: challenge.body.activationCode.split('.')[0].slice(4) } });
    expect(stored.codeHash).not.toBe(challenge.body.activationCode);
    expect(JSON.stringify(await prisma.authAuditEvent.findMany())).not.toContain(challenge.body.activationCode);

    await request(app.getHttpServer())
      .post('/api/v1/auth/activations/complete')
      .send({ activationCode: challenge.body.activationCode, institutionalUsername: 'wrong.username', password: 'student-chosen-password' })
      .expect(410);
    await request(app.getHttpServer())
      .post('/api/v1/auth/activations/complete')
      .send({ activationCode: challenge.body.activationCode, institutionalUsername: 'student.noemail', password: 'student-chosen-password' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/activations/complete')
      .send({ activationCode: challenge.body.activationCode, institutionalUsername: 'student.noemail', password: 'student-chosen-password' })
      .expect(410);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantHandle: tenantA.handle, identifier: 'student.noemail', password: 'student-chosen-password' })
      .expect(200);

    const expired = await provision(admin, tenantA, 'expired.activation', undefined, RoleCode.STUDENT);
    const expiredChallenge = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships/${expired.membershipId}/activation-challenge`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    await prisma.activationChallenge.update({ where: { id: expiredChallenge.body.activationCode.split('.')[0].slice(4) }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(app.getHttpServer()).post('/api/v1/auth/activations/complete').send({ activationCode: expiredChallenge.body.activationCode, institutionalUsername: 'expired.activation', password: 'expired-activation-password' }).expect(410);
  });

  it('uses a generic recovery response, sends only for verified email, and revokes prior sessions on reset', async () => {
    const admin = await loginAdmin(tenantA);
    const provisioned = await provision(admin, tenantA, 'recovery.user', 'recovery@example.test', RoleCode.STUDENT);
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantA.id}/memberships/${provisioned.membershipId}/invite`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);
    await emailOutbox.deliverPending();
    const invitationToken = new URL(fakeEmail.messages.at(-1)!.message.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    await request(app.getHttpServer()).post('/api/v1/auth/invitations/accept').send({ invitationToken, password: 'recovery-old-password' }).expect(200);
    const session = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantHandle: tenantA.handle, identifier: 'recovery.user', password: 'recovery-old-password' }).expect(200);
    const before = await prisma.outboxEvent.count({ where: { eventType: 'identity.email.password-recovery.v1' } });

    await request(app.getHttpServer()).post('/api/v1/auth/password-recovery/request').send({ identifier: 'unknown@example.test' }).expect(202, { accepted: true });
    expect(await prisma.outboxEvent.count({ where: { eventType: 'identity.email.password-recovery.v1' } })).toBe(before);
    await request(app.getHttpServer()).post('/api/v1/auth/password-recovery/request').send({ identifier: 'RECOVERY.USER', tenantHandle: tenantA.handle }).expect(202, { accepted: true });
    expect(await prisma.outboxEvent.count({ where: { eventType: 'identity.email.password-recovery.v1' } })).toBe(before + 1);
    await emailOutbox.deliverPending();
    const resetToken = new URL(fakeEmail.messages.at(-1)!.message.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    const reset = await prisma.passwordResetToken.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(reset.tokenHash).not.toContain(resetToken);
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain(resetToken);

    await request(app.getHttpServer()).post('/api/v1/auth/password-recovery/confirm').send({ resetToken, password: 'recovery-new-password' }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${session.body.accessToken}`).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantHandle: tenantA.handle, identifier: 'recovery.user', password: 'recovery-new-password' }).expect(200);

    await request(app.getHttpServer()).post('/api/v1/auth/password-recovery/request').send({ identifier: 'recovery@example.test' }).expect(202, { accepted: true });
    await emailOutbox.deliverPending();
    const expiredResetToken = new URL(fakeEmail.messages.at(-1)!.message.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    const expiredReset = await prisma.passwordResetToken.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    await prisma.passwordResetToken.update({ where: { id: expiredReset.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(app.getHttpServer()).post('/api/v1/auth/password-recovery/confirm').send({ resetToken: expiredResetToken, password: 'recovery-expired-password' }).expect(410);
  });

  it('revokes affected sessions when membership roles change or access is revoked', async () => {
    const admin = await loginAdmin(tenantA);
    const provisioned = await provision(admin, tenantA, 'managed.user', 'managed@example.test', RoleCode.TEACHER);
    await request(app.getHttpServer()).post(`/api/v1/tenants/${tenantA.id}/memberships/${provisioned.membershipId}/invite`).set('Authorization', `Bearer ${admin.accessToken}`).expect(201);
    await emailOutbox.deliverPending();
    const token = new URL(fakeEmail.messages.at(-1)!.message.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    await request(app.getHttpServer()).post('/api/v1/auth/invitations/accept').send({ invitationToken: token, password: 'managed-password' }).expect(200);
    const user = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantHandle: tenantA.handle, identifier: 'managed.user', password: 'managed-password' }).expect(200);

    await request(app.getHttpServer()).patch(`/api/v1/tenants/${tenantA.id}/memberships/${provisioned.membershipId}`).set('Authorization', `Bearer ${admin.accessToken}`).send({ roles: [RoleCode.STUDENT] }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${user.body.accessToken}`).expect(401);
    const freshAdmin = await loginAdmin(tenantA);
    const freshUser = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantHandle: tenantA.handle, identifier: 'managed.user', password: 'managed-password' }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/tenants/${tenantA.id}/memberships/${provisioned.membershipId}/revoke`).set('Authorization', `Bearer ${freshAdmin.accessToken}`).expect(201);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${freshUser.body.accessToken}`).expect(401);
  });
});

async function loginAdmin(tenant: { id: string; handle: string }): Promise<{ accessToken: string; sessionId: string }> {
  const response = await request(lifecycleApp.getHttpServer()).post('/api/v1/auth/login').send({ tenantHandle: tenant.handle, identifier: 'lifecycle.admin', password: lifecycleAdminPassword });
  expect(response.status).toBe(200);
  return response.body;
}

async function provision(
  admin: { accessToken: string },
  tenant: { id: string },
  username: string,
  email: string | undefined,
  role: RoleCode,
): Promise<{ userId: string; membershipId: string }> {
  const response = await request(lifecycleApp.getHttpServer())
    .post(`/api/v1/tenants/${tenant.id}/memberships`)
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ institutionalUsername: username, ...(email ? { email } : {}), roles: [role] })
    .expect(201);
  return response.body;
}

async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.provisioningIdempotencyReceipt.deleteMany();
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
