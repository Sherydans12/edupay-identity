import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApplication } from '../src/bootstrap.js';

describe('application bootstrap (e2e)', () => {
  let app: INestApplication;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edupay-identity-e2e-'));
    const privateKeyPath = join(directory, 'private.pem');
    const jwksPath = join(directory, 'public.jwks.json');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: 'jwk' });

    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgresql://identity:identity@localhost:5432/identity_test',
      JWT_ISSUER: 'https://identity.test.edupay.example',
      JWT_AUDIENCE: 'edupay-academico-api',
      JWT_ACCESS_TTL_SECONDS: '600',
      JWT_ALGORITHM: 'RS256',
      JWT_KEY_ID: 'test-key-1',
      JWT_PRIVATE_KEY_PATH: privateKeyPath,
      JWT_PUBLIC_JWKS_PATH: jwksPath,
      JWKS_CACHE_MAX_AGE_SECONDS: '300',
      ARGON2_MEMORY_COST: '8192',
      ARGON2_TIME_COST: '2',
      ARGON2_PARALLELISM: '1',
      ARGON2_HASH_LENGTH: '32',
      ARGON2_SALT_LENGTH: '16',
      OPAQUE_TOKEN_BYTES: '32',
    });
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(
      jwksPath,
      JSON.stringify({
        keys: [{ ...publicJwk, kid: 'test-key-1', alg: 'RS256', use: 'sig' }],
      }),
    );

    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves operational health under the approved versioned path', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/identity/health')
      .set('X-Request-Id', 'req_test-health')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'edupay-identity' });
    expect(response.headers['x-request-id']).toBe('req_test-health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('publishes only the configured public JWKS outside the API prefix', async () => {
    const response = await request(app.getHttpServer()).get('/.well-known/jwks.json').expect(200);

    expect(response.body.keys).toHaveLength(1);
    expect(response.body.keys[0]).not.toHaveProperty('d');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
  });

  it('returns a stable safe error envelope and replaces unsafe request IDs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/not-present')
      .set('X-Request-Id', 'unsafe request id')
      .expect(404);

    expect(response.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        details: [],
      },
    });
    expect(response.body.error.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
  });
});
