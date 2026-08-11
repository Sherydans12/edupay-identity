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
import { exportJWK } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApplication } from '../src/bootstrap.js';
import {
  TenantAdminBootstrapConflictError,
  TenantAdminBootstrapService,
} from '../src/bootstrap/tenant-admin-bootstrap.js';
import type { TenantAdminBootstrapInput } from '../src/bootstrap/tenant-admin-bootstrap.js';
import { formatTenantAdminBootstrapOutput } from '../src/bootstrap/tenant-admin-main.js';
import { EmailOutboxService } from '../src/email/email-outbox.service.js';
import { EmailDeliveryAdapter } from '../src/email/email.types.js';
import type { EmailDeliveryResult, EmailMessage } from '../src/email/email.types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

class FakeEmailAdapter extends EmailDeliveryAdapter {
  readonly messages: Array<{ message: EmailMessage; deliveryKey: string }> = [];

  send(message: EmailMessage, deliveryKey: string): Promise<EmailDeliveryResult> {
    this.messages.push({ message, deliveryKey });
    return Promise.resolve({ providerResponseId: `fake_${deliveryKey}` });
  }
}

describeWithDatabase('production tenant-admin bootstrap (PostgreSQL integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let directory: string;
  let bootstrap: TenantAdminBootstrapService;
  let emailOutbox: EmailOutboxService;
  let fakeEmail: FakeEmailAdapter;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edupay-identity-production-bootstrap-'));
    const privateKeyPath = join(directory, 'private.pem');
    const jwksPath = join(directory, 'public.jwks.json');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(
      jwksPath,
      JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: 'bootstrap-key', alg: 'RS256', use: 'sig' }] }),
    );
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: databaseUrl,
      JWT_ISSUER: 'https://identity.bootstrap.test',
      JWT_AUDIENCE: 'edupay-academico-api',
      JWT_ACCESS_TTL_SECONDS: '600',
      JWT_ALGORITHM: 'RS256',
      JWT_KEY_ID: 'bootstrap-key',
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
      IDENTITY_PUBLIC_BASE_URL: 'https://identity.bootstrap.test',
      IDENTITY_ACTIVATION_TTL_SECONDS: '3600',
      IDENTITY_EMAIL_INVITATION_TTL_SECONDS: '86400',
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
    bootstrap = app.get(TenantAdminBootstrapService);
    emailOutbox = app.get(EmailOutboxService);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    fakeEmail.messages.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it('creates only the first pending TENANT_ADMIN with a hash-only code and supports normal activation/login', async () => {
    const input = codeInput();
    const result = await bootstrap.bootstrap(input);
    expect(result).toMatchObject({
      operation: 'created',
      tenantId: input.tenantId,
      tenantHandle: 'colegio-conquistadores',
      username: 'pilot.admin',
      membershipStatus: MembershipStatus.PENDING_ACTIVATION,
      roles: [RoleCode.TENANT_ADMIN],
      activation: { method: 'code', issued: true, oneTimeSensitive: true },
    });
    expect(result.activation.method).toBe('code');
    expect(result.activation.issued).toBe(true);
    if (result.activation.method !== 'code' || !result.activation.issued) throw new Error('code expected');

    const membership = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: result.membershipId },
      include: { roles: { include: { role: true } }, user: { include: { passwordCredential: true } } },
    });
    expect(membership.roles.map(({ role }) => role.code)).toEqual([RoleCode.TENANT_ADMIN]);
    expect(membership.user.passwordCredential).toBeNull();
    expect(await prisma.userRole.count()).toBe(0);
    expect(await prisma.role.count({ where: { code: RoleCode.SYSTEM_ADMIN } })).toBe(0);

    const challenge = await prisma.activationChallenge.findFirstOrThrow({
      where: { membershipId: result.membershipId },
    });
    expect(challenge.codeHash).not.toContain(result.activation.activationCode);
    expect(JSON.stringify(await prisma.authAuditEvent.findMany())).not.toContain(result.activation.activationCode);
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain(result.activation.activationCode);
    const output = formatTenantAdminBootstrapOutput(result);
    expect(output.split(result.activation.activationCode)).toHaveLength(2);
    expect(output).toContain('ONE-TIME SENSITIVE OUTPUT');

    const rerun = await bootstrap.bootstrap(input);
    expect(rerun).toMatchObject({
      operation: 'already-compatible',
      activation: { method: 'code', issued: false, state: 'already-issued' },
    });
    expect(formatTenantAdminBootstrapOutput(rerun)).not.toContain(result.activation.activationCode);
    expect(await prisma.identityUser.count()).toBe(1);
    expect(await prisma.tenantMembership.count()).toBe(1);

    await request(app.getHttpServer())
      .post('/api/v1/auth/activations/complete')
      .send({
        activationCode: result.activation.activationCode,
        institutionalUsername: input.institutionalUsername,
        password: 'administrator-chosen-password',
      })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        tenantHandle: input.tenantHandle,
        identifier: input.institutionalUsername,
        password: 'administrator-chosen-password',
      })
      .expect(200);

    const activatedRerun = await bootstrap.bootstrap(input);
    expect(activatedRerun).toMatchObject({
      operation: 'already-compatible',
      activation: { issued: false, state: 'activated' },
    });
  });

  it('queues an encrypted email invitation without returning its token or contacting Resend', async () => {
    const input = emailInput();
    const result = await bootstrap.bootstrap(input);
    const output = formatTenantAdminBootstrapOutput(result);
    expect(result).toMatchObject({
      operation: 'created',
      activation: {
        method: 'email',
        issued: true,
        invitationQueued: true,
        destination: 'p***@e***.test',
      },
    });
    expect(output).not.toContain('invitationToken');
    expect(output).not.toContain('tokenHash');
    expect(fakeEmail.messages).toHaveLength(0);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'identity.email.invitation.v1' } })).toBe(1);
    expect(await prisma.passwordCredential.count()).toBe(0);

    await emailOutbox.deliverPending();
    expect(fakeEmail.messages).toHaveLength(1);
    const token = new URL(fakeEmail.messages[0]!.message.text.match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
    expect(output).not.toContain(token);
    expect(JSON.stringify(await prisma.invitation.findMany())).not.toContain(token);
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain(token);

    const rerun = await bootstrap.bootstrap(input);
    expect(rerun).toMatchObject({
      operation: 'already-compatible',
      activation: { method: 'email', issued: false, state: 'already-issued' },
    });
    expect(await prisma.outboxEvent.count({ where: { eventType: 'identity.email.invitation.v1' } })).toBe(1);
  });

  it('requires explicit reissue and rotates the prior one-time activation challenge', async () => {
    const input = codeInput();
    const first = await bootstrap.bootstrap(input);
    if (first.activation.method !== 'code' || !first.activation.issued) throw new Error('code expected');
    const reissued = await bootstrap.bootstrap({ ...input, reissueActivation: true });
    expect(reissued.operation).toBe('activation-reissued');
    if (reissued.activation.method !== 'code' || !reissued.activation.issued) throw new Error('code expected');
    expect(reissued.activation.activationCode).not.toBe(first.activation.activationCode);
    const challenges = await prisma.activationChallenge.findMany({ orderBy: { createdAt: 'asc' } });
    expect(challenges).toHaveLength(2);
    expect(challenges[0]!.revokedAt).not.toBeNull();
    expect(challenges[1]!.revokedAt).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/auth/activations/complete')
      .send({
        activationCode: first.activation.activationCode,
        institutionalUsername: input.institutionalUsername,
        password: 'administrator-chosen-password',
      })
      .expect(410);
    await request(app.getHttpServer())
      .post('/api/v1/auth/activations/complete')
      .send({
        activationCode: reissued.activation.activationCode,
        institutionalUsername: input.institutionalUsername,
        password: 'administrator-chosen-password',
      })
      .expect(200);
  });

  it('fails loudly for conflicting tenant, user, membership, role, and activation state', async () => {
    const first = codeInput();
    await bootstrap.bootstrap(first);

    await expect(bootstrap.bootstrap({ ...first, tenantHandle: 'different-handle' })).rejects.toThrow(
      TenantAdminBootstrapConflictError,
    );
    await expect(bootstrap.bootstrap({ ...first, tenantId: randomUUID() })).rejects.toThrow(
      TenantAdminBootstrapConflictError,
    );
    await expect(bootstrap.bootstrap({ ...first, activationMethod: 'email', email: 'pilot@example.test' })).rejects.toThrow(
      TenantAdminBootstrapConflictError,
    );

    const membership = await prisma.tenantMembership.findFirstOrThrow();
    const teacher = await prisma.role.create({ data: { code: RoleCode.TEACHER, scope: RoleScope.TENANT } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: teacher.id } });
    await expect(bootstrap.bootstrap(first)).rejects.toThrow(TenantAdminBootstrapConflictError);

    await clearDatabase(prisma);
    await prisma.tenantRealm.create({ data: { id: first.tenantId, handle: first.tenantHandle } });
    const otherUser = await prisma.identityUser.create({ data: {} });
    await prisma.loginIdentifier.create({
      data: {
        userId: otherUser.id,
        tenantRealmId: first.tenantId,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: first.institutionalUsername,
      },
    });
    await expect(bootstrap.bootstrap(first)).rejects.toThrow(TenantAdminBootstrapConflictError);
  });
});

function codeInput(): TenantAdminBootstrapInput {
  return {
    tenantId: randomUUID(),
    tenantHandle: 'Colegio-Conquistadores',
    institutionalUsername: 'Pilot.Admin',
    activationMethod: 'code',
    reissueActivation: false,
    requestId: `bootstrap-test:${randomUUID()}`,
  };
}

function emailInput(): TenantAdminBootstrapInput {
  return {
    ...codeInput(),
    activationMethod: 'email',
    email: 'Pilot.Admin@Example.Test',
  };
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
