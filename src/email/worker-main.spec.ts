import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailModule } from './email.module.js';
import { EmailOutboxService } from './email-outbox.service.js';

const environment = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://identity:identity@127.0.0.1:5432/identity_test',
  JWT_ISSUER: 'https://identity.worker.test',
  JWT_AUDIENCE: 'edupay-academico-api',
  JWT_ACCESS_TTL_SECONDS: '600',
  JWT_ALGORITHM: 'RS256',
  JWT_KEY_ID: 'worker-test-key',
  JWT_PRIVATE_KEY_PATH: join(tmpdir(), 'edupay-identity-worker-private.pem'),
  JWT_PUBLIC_JWKS_PATH: join(tmpdir(), 'edupay-identity-worker-public.jwks.json'),
  JWKS_CACHE_MAX_AGE_SECONDS: '300',
  ARGON2_MEMORY_COST: '8192',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  ARGON2_HASH_LENGTH: '32',
  ARGON2_SALT_LENGTH: '16',
  OPAQUE_TOKEN_BYTES: '32',
  RESEND_API_KEY: '',
  IDENTITY_OUTBOX_ENCRYPTION_KEY: '',
};

const originalEnvironment = new Map<string, string | undefined>();

describe('email worker Nest context', () => {
  beforeAll(() => {
    for (const [key, value] of Object.entries(environment)) {
      originalEnvironment.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves the outbox provider from the worker-owned EmailModule and closes cleanly', async () => {
    const { AppModule } = await import('../app.module.js');
    const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });

    try {
      const emailOutbox = app.select(EmailModule).get(EmailOutboxService, { strict: true });

      expect(emailOutbox).toBeInstanceOf(EmailOutboxService);
    } finally {
      await expect(app.close()).resolves.toBeUndefined();
    }
  });
});
