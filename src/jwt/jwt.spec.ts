import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { exportJWK, importJWK, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Environment } from '../config/environment.js';
import { JwksService } from './jwks.service.js';
import { JwtSigningService } from './jwt-signing.service.js';
import { JwtVerificationService } from './jwt-verification.service.js';

describe('JWT and JWKS foundation', () => {
  let directory: string;
  let privateKeyPath: string;
  let jwksPath: string;
  let publicJwk: Record<string, unknown>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edupay-identity-jwt-'));
    privateKeyPath = join(directory, 'private.pem');
    jwksPath = join(directory, 'public.jwks.json');

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    publicJwk = {
      ...(await exportJWK(publicKey)),
      kid: 'test-key-1',
      alg: 'RS256',
      use: 'sig',
    };
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(jwksPath, JSON.stringify({ keys: [publicJwk] }));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function createConfig(): ConfigService<Environment, true> {
    return new ConfigService<Environment, true>({
      JWT_ISSUER: 'https://identity.test.edupay.example',
      JWT_AUDIENCE: 'edupay-academico-api',
      JWT_ACCESS_TTL_SECONDS: 600,
      JWT_ALGORITHM: 'RS256',
      JWT_KEY_ID: 'test-key-1',
      JWT_PRIVATE_KEY_PATH: privateKeyPath,
      JWT_PUBLIC_JWKS_PATH: jwksPath,
      JWKS_CACHE_MAX_AGE_SECONDS: 300,
    } as Environment);
  }

  it('signs the approved minimum claims and verifies with the published public key', async () => {
    const config = createConfig();
    const signer = new JwtSigningService(config);
    const signed = await signer.signAccessToken({
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      jwtId: '00000000-0000-4000-8000-000000000003',
      scope: ['academic:use'],
      authenticationMethods: ['password'],
      authenticatedAt: Math.floor(Date.now() / 1000),
      tenantContext: {
        tenantId: '00000000-0000-4000-8000-000000000004',
        membershipId: '00000000-0000-4000-8000-000000000005',
        roles: ['TEACHER'],
      },
    });
    const verificationKey = await importJWK(publicJwk, 'RS256');
    const { payload, protectedHeader } = await jwtVerify(signed, verificationKey, {
      issuer: 'https://identity.test.edupay.example',
      audience: 'edupay-academico-api',
    });

    expect(protectedHeader).toMatchObject({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' });
    expect(payload).toMatchObject({
      sub: '00000000-0000-4000-8000-000000000001',
      sid: '00000000-0000-4000-8000-000000000002',
      tenant_id: '00000000-0000-4000-8000-000000000004',
      membership_id: '00000000-0000-4000-8000-000000000005',
      roles: ['TEACHER'],
    });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('username');
  });

  it('omits tenant claims when no active membership context exists', async () => {
    const signer = new JwtSigningService(createConfig());
    const signed = await signer.signAccessToken({
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      jwtId: '00000000-0000-4000-8000-000000000003',
      scope: [],
      authenticationMethods: ['password'],
      authenticatedAt: Math.floor(Date.now() / 1000),
    });
    const verificationKey = await importJWK(publicJwk, 'RS256');
    const { payload } = await jwtVerify(signed, verificationKey);

    expect(payload).not.toHaveProperty('tenant_id');
    expect(payload).not.toHaveProperty('membership_id');
    expect(payload).not.toHaveProperty('roles');
  });

  it('publishes public material only and refuses a JWKS containing private members', async () => {
    const jwks = new JwksService(createConfig());
    const publicDocument = await jwks.getPublicJwks();

    expect(JSON.stringify(publicDocument)).not.toContain('private.pem');
    expect(publicDocument.keys[0]).not.toHaveProperty('d');

    await writeFile(jwksPath, JSON.stringify({ keys: [{ ...publicJwk, d: 'private-material' }] }));
    const unsafeJwks = new JwksService(createConfig());
    await expect(unsafeJwks.getPublicJwks()).rejects.toThrow('private key material');
  });

  it('validates the complete consumer contract and rejects malformed or expired tokens', async () => {
    const config = createConfig();
    const jwks = new JwksService(config);
    const verifier = new JwtVerificationService(config, jwks);
    const signer = new JwtSigningService(config);
    const valid = await signer.signAccessToken({
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      jwtId: '00000000-0000-4000-8000-000000000003',
      scope: ['academic:use'],
      authenticationMethods: ['password'],
      authenticatedAt: Math.floor(Date.now() / 1_000),
    });

    await expect(verifier.verifyAccessToken(valid)).resolves.toMatchObject({
      iss: 'https://identity.test.edupay.example',
      aud: 'edupay-academico-api',
      sub: '00000000-0000-4000-8000-000000000001',
      sid: '00000000-0000-4000-8000-000000000002',
      scope: ['academic:use'],
      amr: ['password'],
    });
    await expect(verifier.verifyAccessToken('not-a-jwt')).rejects.toBeDefined();

    const privateKey = await importPKCS8(await readFile(privateKeyPath, 'utf8'), 'RS256');
    const now = Math.floor(Date.now() / 1_000);
    const expired = await new SignJWT({
      sid: '00000000-0000-4000-8000-000000000002',
      scope: ['academic:use'],
      amr: ['password'],
      auth_time: now - 700,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' })
      .setIssuer('https://identity.test.edupay.example')
      .setAudience('edupay-academico-api')
      .setSubject('00000000-0000-4000-8000-000000000001')
      .setJti('00000000-0000-4000-8000-000000000003')
      .setIssuedAt(now - 700)
      .setNotBefore(now - 700)
      .setExpirationTime(now - 100)
      .sign(privateKey);
    await expect(verifier.verifyAccessToken(expired)).rejects.toBeDefined();
  });
});
