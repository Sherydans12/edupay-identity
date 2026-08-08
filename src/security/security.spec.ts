import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { Argon2Service, PasswordHashService } from './argon2.service.js';
import { assertSecretFree } from './audit.service.js';
import { OpaqueTokenService } from './opaque-token.service.js';
import { TrustedTenantContextService } from './trusted-tenant-context.service.js';

const config = new ConfigService<Environment, true>({
  ARGON2_MEMORY_COST: 8192,
  ARGON2_TIME_COST: 2,
  ARGON2_PARALLELISM: 1,
  ARGON2_HASH_LENGTH: 32,
  ARGON2_SALT_LENGTH: 16,
  OPAQUE_TOKEN_BYTES: 32,
} as Environment);

describe('security foundations', () => {
  const argon2 = new Argon2Service(config);

  it('hashes and verifies passwords with Argon2id without retaining plaintext', async () => {
    const passwords = new PasswordHashService(argon2);
    const plaintext = 'synthetic-test-password';
    const encoded = await passwords.hashPassword(plaintext);

    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).not.toContain(plaintext);
    await expect(passwords.verifyPassword(encoded, plaintext)).resolves.toBe(true);
    await expect(passwords.verifyPassword(encoded, 'wrong-password')).resolves.toBe(false);
    expect(passwords.requiresRehash(encoded)).toBe(false);
  });

  it('creates parseable opaque tokens while redacting obvious serialization paths', async () => {
    const tokens = new OpaqueTokenService(config, argon2);
    const issued = await tokens.issue('act');
    const plaintext = issued.revealOnce();
    const parsed = tokens.parse(plaintext, 'act');

    expect(parsed).not.toBeNull();
    await expect(tokens.verify(issued.tokenHash, parsed!)).resolves.toBe(true);
    expect(issued.tokenHash).not.toContain(plaintext);
    expect(JSON.stringify(issued)).not.toContain(plaintext);
    expect(String(issued)).not.toContain(plaintext);
    expect(() => issued.revealOnce()).toThrow('no longer available');
  });

  it('rejects client-selected cross-tenant targets', () => {
    const tenants = new TrustedTenantContextService();
    const context = {
      userId: 'user-a',
      membershipId: 'membership-a',
      tenantId: 'tenant-a',
      roles: ['TEACHER'],
    };

    expect(tenants.assertTarget(context, 'tenant-a')).toBe(context);
    expect(() => tenants.assertTarget(context, 'tenant-b')).toThrow();
    expect(() => tenants.assertTarget(null, 'tenant-a')).toThrow();
  });

  it('rejects secret-shaped audit metadata at any depth', () => {
    expect(() => assertSecretFree({ device: { label: 'test' } })).not.toThrow();
    expect(() => assertSecretFree({ nested: { refreshToken: 'must-not-persist' } })).toThrow(
      'Secret-like audit metadata key rejected',
    );
  });
});
