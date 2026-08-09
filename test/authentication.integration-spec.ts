import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  IdentityUserStatus,
  LoginIdentifierKind,
  MembershipStatus,
  RoleCode,
  RoleScope,
} from '../src/generated/prisma/enums.js';
import { argon2id, hash } from 'argon2';
import { exportJWK, importJWK, importPKCS8, jwtVerify, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApplication } from '../src/bootstrap.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

interface Fixture {
  password: string;
  tenantA: { id: string; handle: string };
  tenantB: { id: string; handle: string };
  userAId: string;
  membershipAId: string;
  membershipBId: string;
  otherMembershipId: string;
  disabledUsername: string;
  inactiveUsername: string;
}

describeWithDatabase('authentication core (PostgreSQL integration)', () => {
  const trustedOrigin = 'https://academico.test';
  const refreshCookieName = '__Host-edupay-refresh';
  let app: INestApplication;
  let directory: string;
  let privateKeyPem: string;
  let prisma: PrismaClient;
  let fixture: Fixture;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edupay-identity-auth-'));
    const privateKeyPath = join(directory, 'private.pem');
    const jwksPath = join(directory, 'public.jwks.json');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      kid: 'auth-integration-key',
      alg: 'RS256',
      use: 'sig',
    };
    await writeFile(privateKeyPath, privateKeyPem);
    await writeFile(jwksPath, JSON.stringify({ keys: [publicJwk] }));

    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: databaseUrl,
      JWT_ISSUER: 'https://identity.test.edupay.example',
      JWT_AUDIENCE: 'edupay-academico-api',
      JWT_ACCESS_TTL_SECONDS: '600',
      JWT_ALGORITHM: 'RS256',
      JWT_KEY_ID: 'auth-integration-key',
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
      REFRESH_IDLE_TTL_SECONDS: '2592000',
      SESSION_ABSOLUTE_TTL_SECONDS: '7776000',
      LOGOUT_ALL_REAUTH_MAX_AGE_SECONDS: '600',
      PASSWORD_LOCK_THRESHOLD: '100',
      PASSWORD_LOCK_SECONDS: '900',
      RATE_LIMIT_WINDOW_SECONDS: '900',
      RATE_LIMIT_LOGIN_MAX: '1000',
      RATE_LIMIT_REFRESH_MAX: '1000',
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
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('logs in with a tenant-scoped username and issues the approved access-token claims', async () => {
    const response = await loginAsUserA(app, fixture).expect(200);
    const jwksResponse = await request(app.getHttpServer()).get('/.well-known/jwks.json').expect(200);
    const verificationKey = await importJWK(jwksResponse.body.keys[0], 'RS256');
    const { payload } = await jwtVerify(response.body.accessToken, verificationKey, {
      issuer: 'https://identity.test.edupay.example',
      audience: 'edupay-academico-api',
    });

    expect(payload).toMatchObject({
      sub: fixture.userAId,
      sid: response.body.sessionId,
      tenant_id: fixture.tenantA.id,
      membership_id: fixture.membershipAId,
      roles: ['TEACHER'],
      scope: ['academic:use'],
      amr: ['password'],
    });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600);
    expect(payload).toHaveProperty('jti');
    expect(payload).toHaveProperty('nbf');
    expect(payload).toHaveProperty('auth_time');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('username');

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({
      userId: fixture.userAId,
      session: { id: response.body.sessionId, activeMembership: { membershipId: fixture.membershipAId } },
    });
    const memberships = await request(app.getHttpServer())
      .get('/api/v1/auth/memberships')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(memberships.body).toHaveLength(2);
  });

  it('logs in with a verified global email when a tenant hint selects an owned membership', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        tenantHandle: fixture.tenantB.handle,
        identifier: ' PERSON@EXAMPLE.TEST ',
        password: fixture.password,
      })
      .expect(200);

    expect(response.body.activeMembership).toMatchObject({
      membershipId: fixture.membershipBId,
      tenantId: fixture.tenantB.id,
      roles: ['STUDENT'],
    });
  });

  it('keeps browser refresh tokens in a secure HttpOnly host-only cookie and rotates that cookie', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({
        tenantHandle: fixture.tenantA.handle,
        identifier: 'MATIAS.GONZALEZ',
        password: fixture.password,
      })
      .expect(200);

    expect(login.body).not.toHaveProperty('refreshToken');
    const firstSetCookie = login.headers['set-cookie'];
    expect(firstSetCookie).toHaveLength(1);
    const firstCookie = firstSetCookie![0]!;
    expect(firstCookie).toMatch(
      new RegExp(`^${refreshCookieName}=[^;]+; Max-Age=\\d+; Path=/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$`),
    );
    expect(firstCookie).not.toContain('Domain=');
    const firstCookiePair = firstCookie.split(';', 1)[0]!;
    const firstRefreshSecret = firstCookiePair.split('=', 2)[1]!;
    const loginAudits = await prisma.authAuditEvent.findMany({ where: { sessionId: login.body.sessionId } });
    expect(JSON.stringify(loginAudits)).not.toContain(firstRefreshSecret);

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', firstCookiePair)
      .send({})
      .expect(200);

    expect(refresh.body).not.toHaveProperty('refreshToken');
    const secondCookie = refresh.headers['set-cookie']![0]!;
    expect(secondCookie).not.toBe(firstCookie);
    expect(secondCookie).toContain(`${refreshCookieName}=`);
    expect(JSON.stringify(login.body)).not.toContain(firstRefreshSecret);

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', firstCookiePair)
      .send({})
      .expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSE_DETECTED');
    expect(reuse.headers['set-cookie']![0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(JSON.stringify(reuse.body)).not.toContain(firstRefreshSecret);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: login.body.sessionId } });
    expect(session.revocationReason).toBe('REFRESH_TOKEN_REUSE');
  });

  it('rejects missing, malformed, and hostile browser refresh requests', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: fixture.password })
      .expect(200);
    const cookiePair = login.headers['set-cookie']![0]!.split(';', 1)[0]!;

    const missing = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .send({})
      .expect(401);
    expect(missing.body.error.code).toBe('TOKEN_INVALID');

    const malformed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', `${refreshCookieName}=malformed`)
      .send({})
      .expect(401);
    expect(malformed.body.error.code).toBe('TOKEN_INVALID');
    expect(JSON.stringify(malformed.body)).not.toContain('malformed');

    const hostile = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.test')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', cookiePair)
      .send({})
      .expect(403);
    expect(hostile.body.error.code).toBe('ORIGIN_NOT_ALLOWED');

    const missingOrigin = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookiePair)
      .send({})
      .expect(403);
    expect(missingOrigin.body.error.code).toBe('ORIGIN_NOT_ALLOWED');

    const hostileLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.test')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('Cookie', cookiePair)
      .expect(403);
    expect(hostileLogout.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('preserves generic login failures and does not establish browser cookies for untrusted origins', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: 'incorrect' })
      .expect(401);
    expect(invalid.body.error).toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'The credentials could not be verified.',
      details: [],
    });
    expect(invalid.headers['set-cookie']).toBeUndefined();

    const untrusted = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.test')
      .send({ tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: fixture.password })
      .expect(403);
    expect(untrusted.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(untrusted.body).not.toHaveProperty('accessToken');
    expect(untrusted.body).not.toHaveProperty('refreshToken');
    expect(untrusted.headers['set-cookie']).toBeUndefined();
  });

  it('uses generic failures for invalid passwords, disabled users, and inactive memberships', async () => {
    const attempts = [
      { tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: 'incorrect' },
      { tenantHandle: fixture.tenantA.handle, identifier: fixture.disabledUsername, password: fixture.password },
      { tenantHandle: fixture.tenantA.handle, identifier: fixture.inactiveUsername, password: fixture.password },
    ];

    for (const attempt of attempts) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(attempt)
        .expect(401);
      expect(response.body.error).toMatchObject({
        code: 'AUTHENTICATION_FAILED',
        message: 'The credentials could not be verified.',
        details: [],
      });
      expect(JSON.stringify(response.body)).not.toContain(attempt.password);
      expect(JSON.stringify(response.body)).not.toContain('argon2');
    }

    const audits = await prisma.authAuditEvent.findMany({ where: { eventType: 'LOGIN' } });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(fixture.password);
    expect(serialized).not.toContain('incorrect');
    expect(serialized).not.toContain('refreshToken');
  });

  it('rehashes an outdated Argon2id verifier after successful authentication without changing password age', async () => {
    const previousSetAt = new Date('2026-01-01T00:00:00.000Z');
    const outdatedHash = await hash(fixture.password, {
      type: argon2id,
      memoryCost: 4096,
      timeCost: 1,
      parallelism: 1,
      hashLength: 16,
    });
    await prisma.passwordCredential.update({
      where: { userId: fixture.userAId },
      data: { passwordHash: outdatedHash, passwordSetAt: previousSetAt },
    });

    await loginAsUserA(app, fixture).expect(200);
    const credential = await prisma.passwordCredential.findUniqueOrThrow({
      where: { userId: fixture.userAId },
    });
    expect(credential.passwordHash).not.toBe(outdatedHash);
    expect(credential.passwordHash).toContain('$m=8192,p=1,t=2$');
    expect(credential.passwordSetAt).toEqual(previousSetAt);
  });

  it('requires tenant selection for ambiguous email login and rejects cross-user membership selection', async () => {
    const selection = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'person@example.test', password: fixture.password })
      .expect(409);
    expect(selection.body.error.code).toBe('MEMBERSHIP_SELECTION_REQUIRED');
    expect(selection.body.error.details).toHaveLength(2);
    expect(selection.body).not.toHaveProperty('accessToken');
    expect(selection.body).not.toHaveProperty('refreshToken');

    const login = await loginAsUserA(app, fixture).expect(200);
    const rejected = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions/current-context')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ membershipId: fixture.otherMembershipId })
      .expect(404);
    expect(rejected.body.error.code).toBe('NOT_FOUND');
  });

  it('switches only to an owned active membership and invalidates the prior context token', async () => {
    const login = await loginAsUserA(app, fixture).expect(200);
    const switched = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions/current-context')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ membershipId: fixture.membershipBId })
      .expect(200);

    expect(switched.body.activeMembership).toMatchObject({
      membershipId: fixture.membershipBId,
      tenantId: fixture.tenantB.id,
      roles: ['STUDENT'],
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${switched.body.accessToken}`)
      .expect(200);

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(refreshed.body.activeMembership.membershipId).toBe(fixture.membershipBId);
  });

  it('rotates refresh tokens and revokes the complete family on sequential reuse', async () => {
    const login = await loginAsUserA(app, fixture).expect(200);
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSE_DETECTED');
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: login.body.sessionId } });
    expect(session.revocationReason).toBe('REFRESH_TOKEN_REUSE');
  });

  it('treats a concurrent refresh race as reuse and leaves the session revoked', async () => {
    const login = await loginAsUserA(app, fixture).expect(200);
    const calls = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }),
      request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }),
    ]);

    expect(calls.map(({ status }) => status).sort()).toEqual([200, 401]);
    expect(calls.find(({ status }) => status === 401)!.body.error.code).toBe('REFRESH_REUSE_DETECTED');
    const session = await prisma.session.findUniqueOrThrow({ where: { id: login.body.sessionId } });
    expect(session.revokedAt).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { sessionId: session.id, revokedAt: null } })).toBe(0);
  });

  it('revokes the current session on logout and every active session on logout-all', async () => {
    const first = await loginAsUserA(app, fixture).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);

    const second = await loginAsUserA(app, fixture).expect(200);
    const third = await loginAsUserA(app, fixture).expect(200);
    const logoutAll = await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .expect(200);
    expect(logoutAll.body.revokedSessions).toBe(2);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${third.body.accessToken}`)
      .expect(401);
  });

  it('revokes and clears the current browser session on logout, including retries', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: fixture.password })
      .expect(200);
    const cookiePair = login.headers['set-cookie']![0]!.split(';', 1)[0]!;

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('Cookie', cookiePair)
      .expect(204);
    expect(logout.headers['set-cookie']![0]).toContain(`${refreshCookieName}=;`);
    expect(logout.headers['set-cookie']![0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');

    const session = await prisma.session.findUniqueOrThrow({ where: { id: login.body.sessionId } });
    expect(session.revocationReason).toBe('USER_LOGOUT');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('Cookie', cookiePair)
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', cookiePair)
      .send({})
      .expect(401);
  });

  it('clears the current browser cookie when logout-all revokes all recent sessions', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: fixture.password })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', trustedOrigin)
      .send({ tenantHandle: fixture.tenantA.handle, identifier: 'matias.gonzalez', password: fixture.password })
      .expect(200);
    const cookiePair = second.headers['set-cookie']![0]!.split(';', 1)[0]!;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Origin', trustedOrigin)
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .set('Cookie', cookiePair)
      .expect(200);

    expect(response.body.revokedSessions).toBe(2);
    expect(response.headers['set-cookie']![0]).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect((await prisma.session.findUniqueOrThrow({ where: { id: first.body.sessionId } })).revokedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: second.body.sessionId } })).revokedAt).not.toBeNull();
  });

  it('rejects malformed and expired access tokens with the token-specific safe envelope', async () => {
    const malformed = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer malformed-token')
      .expect(401);
    expect(malformed.body.error).toMatchObject({
      code: 'TOKEN_INVALID',
      message: 'The access token is invalid or expired.',
      details: [],
    });

    const login = await loginAsUserA(app, fixture).expect(200);
    const privateKey = await importPKCS8(privateKeyPem, 'RS256');
    const now = Math.floor(Date.now() / 1_000);
    const expired = await new SignJWT({
      sid: login.body.sessionId,
      scope: ['academic:use'],
      amr: ['password'],
      auth_time: now - 700,
      tenant_id: fixture.tenantA.id,
      membership_id: fixture.membershipAId,
      roles: ['TEACHER'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'auth-integration-key', typ: 'JWT' })
      .setIssuer('https://identity.test.edupay.example')
      .setAudience('edupay-academico-api')
      .setSubject(fixture.userAId)
      .setJti(randomUUID())
      .setIssuedAt(now - 700)
      .setNotBefore(now - 700)
      .setExpirationTime(now - 100)
      .sign(privateKey);
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(response.body.error.code).toBe('TOKEN_INVALID');
    expect(JSON.stringify(response.body)).not.toContain(expired);
  });
});

function loginAsUserA(app: INestApplication, fixture: Fixture) {
  return request(app.getHttpServer()).post('/api/v1/auth/login').send({
    tenantHandle: fixture.tenantA.handle,
    identifier: 'MATIAS.GONZALEZ',
    password: fixture.password,
    device: { label: 'Synthetic integration client' },
  });
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
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 8192,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
  const tenantA = { id: randomUUID(), handle: `tenant-a-${randomUUID().slice(0, 8)}` };
  const tenantB = { id: randomUUID(), handle: `tenant-b-${randomUUID().slice(0, 8)}` };
  const userAId = randomUUID();
  const userBId = randomUUID();
  const disabledUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const membershipAId = randomUUID();
  const membershipBId = randomUUID();
  const otherMembershipId = randomUUID();
  const disabledMembershipId = randomUUID();
  const inactiveMembershipId = randomUUID();
  const disabledUsername = `disabled.${randomUUID().slice(0, 8)}`;
  const inactiveUsername = `inactive.${randomUUID().slice(0, 8)}`;

  await prisma.tenantRealm.createMany({ data: [tenantA, tenantB] });
  const teacherRole = await prisma.role.create({
    data: { code: RoleCode.TEACHER, scope: RoleScope.TENANT },
  });
  const studentRole = await prisma.role.create({
    data: { code: RoleCode.STUDENT, scope: RoleScope.TENANT },
  });
  await prisma.identityUser.createMany({
    data: [
      { id: userAId },
      { id: userBId },
      { id: disabledUserId, status: IdentityUserStatus.DISABLED, disabledAt: new Date() },
      { id: inactiveUserId },
    ],
  });
  await prisma.passwordCredential.createMany({
    data: [userAId, userBId, disabledUserId, inactiveUserId].map((userId) => ({
      userId,
      passwordHash,
      passwordSetAt: new Date(),
    })),
  });
  await prisma.tenantMembership.createMany({
    data: [
      { id: membershipAId, userId: userAId, tenantRealmId: tenantA.id, status: MembershipStatus.ACTIVE },
      { id: membershipBId, userId: userAId, tenantRealmId: tenantB.id, status: MembershipStatus.ACTIVE },
      { id: otherMembershipId, userId: userBId, tenantRealmId: tenantA.id, status: MembershipStatus.ACTIVE },
      { id: disabledMembershipId, userId: disabledUserId, tenantRealmId: tenantA.id, status: MembershipStatus.ACTIVE },
      { id: inactiveMembershipId, userId: inactiveUserId, tenantRealmId: tenantA.id, status: MembershipStatus.SUSPENDED },
    ],
  });
  await prisma.membershipRole.createMany({
    data: [
      { membershipId: membershipAId, roleId: teacherRole.id },
      { membershipId: membershipBId, roleId: studentRole.id },
      { membershipId: otherMembershipId, roleId: studentRole.id },
      { membershipId: disabledMembershipId, roleId: studentRole.id },
      { membershipId: inactiveMembershipId, roleId: studentRole.id },
    ],
  });
  await prisma.loginIdentifier.createMany({
    data: [
      {
        userId: userAId,
        tenantRealmId: tenantA.id,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: 'matias.gonzalez',
      },
      {
        userId: userAId,
        kind: LoginIdentifierKind.EMAIL,
        normalizedValue: 'person@example.test',
        verifiedAt: new Date(),
      },
      {
        userId: userBId,
        tenantRealmId: tenantA.id,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: `other.${randomUUID().slice(0, 8)}`,
      },
      {
        userId: disabledUserId,
        tenantRealmId: tenantA.id,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: disabledUsername,
      },
      {
        userId: inactiveUserId,
        tenantRealmId: tenantA.id,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: inactiveUsername,
      },
    ],
  });

  return {
    password,
    tenantA,
    tenantB,
    userAId,
    membershipAId,
    membershipBId,
    otherMembershipId,
    disabledUsername,
    inactiveUsername,
  };
}
