import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../config/environment.js';
import { ConfiguredRateLimitPolicy } from '../security/rate-limit.policy.js';
import { IdentifierNormalizationService } from './identifier-normalization.service.js';

describe('authentication domain rules', () => {
  it('normalizes usernames and emails independently', () => {
    const normalization = new IdentifierNormalizationService();

    expect(normalization.normalizeUsername('  MATÍAS.GONZALEZ  ')).toBe('matías.gonzalez');
    expect(normalization.normalizeUsername('ＭＡＴＩＡＳ')).toBe('matias');
    expect(normalization.normalizeEmail('  Person@Example.TEST  ')).toBe('person@example.test');
    expect(normalization.isEmail('student.username')).toBe(false);
    expect(normalization.isEmail('student@example.test')).toBe(true);
  });

  it('enforces configured rate limits per independently hashed key', async () => {
    const config = new ConfigService<Environment, true>({
      RATE_LIMIT_WINDOW_SECONDS: 900,
      RATE_LIMIT_LOGIN_MAX: 2,
      RATE_LIMIT_REFRESH_MAX: 3,
    } as Environment);
    const policy = new ConfiguredRateLimitPolicy(config);

    await expect(policy.consume({ bucket: 'login', keys: ['ip-a', 'person-a'] })).resolves.toEqual({
      allowed: true,
    });
    await expect(policy.consume({ bucket: 'login', keys: ['ip-a', 'person-a'] })).resolves.toEqual({
      allowed: true,
    });
    await expect(policy.consume({ bucket: 'login', keys: ['ip-a', 'person-b'] })).resolves.toMatchObject({
      allowed: false,
      reason: 'limit-exceeded',
    });
  });

  it('fails closed when no usable rate-limit key is available', async () => {
    const config = new ConfigService<Environment, true>({
      RATE_LIMIT_WINDOW_SECONDS: 900,
      RATE_LIMIT_LOGIN_MAX: 2,
      RATE_LIMIT_REFRESH_MAX: 3,
    } as Environment);
    const policy = new ConfiguredRateLimitPolicy(config);
    await expect(policy.consume({ bucket: 'login', keys: [] })).resolves.toMatchObject({
      allowed: false,
    });
  });
});
