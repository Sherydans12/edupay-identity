import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://identity:identity@localhost:5432/identity_test',
  JWT_ISSUER: 'https://identity.test.edupay.example',
  JWT_AUDIENCE: 'edupay-academico-api',
  JWT_ACCESS_TTL_SECONDS: '600',
  JWT_ALGORITHM: 'RS256',
  JWT_KEY_ID: 'test-key-1',
  JWT_PRIVATE_KEY_PATH: 'runtime/test-private-key.pem',
  JWT_PUBLIC_JWKS_PATH: 'runtime/test-public.jwks.json',
  JWKS_CACHE_MAX_AGE_SECONDS: '300',
  ARGON2_MEMORY_COST: '8192',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  ARGON2_HASH_LENGTH: '32',
  ARGON2_SALT_LENGTH: '16',
  OPAQUE_TOKEN_BYTES: '32',
} satisfies Record<string, unknown>;

describe('environment validation', () => {
  it('coerces explicitly configured numeric values', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      PORT: 3000,
      JWT_ACCESS_TTL_SECONDS: 600,
      OPAQUE_TOKEN_BYTES: 32,
    });
  });

  it('rejects access-token lifetimes beyond the accepted ten-minute ceiling', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, JWT_ACCESS_TTL_SECONDS: '601' }),
    ).toThrow('Invalid environment configuration: JWT_ACCESS_TTL_SECONDS');
  });

  it('rejects non-PostgreSQL database connections without echoing their values', () => {
    const secret = 'mysql://user:highly-sensitive@localhost/identity';

    expect(() => validateEnvironment({ ...validEnvironment, DATABASE_URL: secret })).toThrow(
      'Invalid environment configuration: DATABASE_URL',
    );

    try {
      validateEnvironment({ ...validEnvironment, DATABASE_URL: secret });
    } catch (error) {
      expect(String(error)).not.toContain('highly-sensitive');
    }
  });

  it('normalizes an explicitly configured trusted web-origin allowlist', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        IDENTITY_TRUSTED_WEB_ORIGINS: ' https://academico.example.test/,http://localhost:3001 ',
      }).IDENTITY_TRUSTED_WEB_ORIGINS,
    ).toEqual(['https://academico.example.test', 'http://localhost:3001']);
  });

  it('rejects malformed origins and insecure production cookie settings', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, IDENTITY_TRUSTED_WEB_ORIGINS: 'https://trusted.test/login' }),
    ).toThrow('Invalid environment configuration: IDENTITY_TRUSTED_WEB_ORIGINS');

    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        IDENTITY_TRUSTED_WEB_ORIGINS: 'https://academico.example.test',
        IDENTITY_COOKIE_SECURE: 'false',
      }),
    ).toThrow('Invalid environment configuration: IDENTITY_COOKIE_SECURE');

    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        IDENTITY_REFRESH_COOKIE_SAMESITE: 'none',
        IDENTITY_COOKIE_SECURE: 'false',
      }),
    ).toThrow('Invalid environment configuration: IDENTITY_COOKIE_SECURE');
  });
});
