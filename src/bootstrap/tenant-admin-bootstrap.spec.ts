import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TenantAdminBootstrapUsageError,
  maskEmail,
  parseTenantAdminBootstrapArguments,
} from './tenant-admin-bootstrap.js';
import { validateTenantAdminBootstrapEnvironment } from './tenant-admin-main.js';

describe('tenant-admin bootstrap CLI boundary', () => {
  it('requires explicit canonical tenant, handle, username, and activation method', () => {
    const tenantId = randomUUID();
    expect(parseTenantAdminBootstrapArguments([
      '--tenant-id', tenantId,
      '--tenant-handle', 'Colegio-Conquistadores',
      '--username', 'Pilot.Admin',
      '--activation', 'code',
    ])).toMatchObject({
      tenantId,
      tenantHandle: 'Colegio-Conquistadores',
      institutionalUsername: 'Pilot.Admin',
      activationMethod: 'code',
      reissueActivation: false,
    });
    expect(() => parseTenantAdminBootstrapArguments([
      '--tenant-id', 'colegio-conquistadores',
      '--tenant-handle', 'colegio-conquistadores',
      '--username', 'pilot.admin',
      '--activation', 'code',
    ])).toThrow(TenantAdminBootstrapUsageError);
  });

  it('never accepts a password and binds email only to email activation', () => {
    const base = [
      '--tenant-id', randomUUID(),
      '--tenant-handle', 'colegio-conquistadores',
      '--username', 'pilot.admin',
    ];
    expect(() => parseTenantAdminBootstrapArguments([
      ...base,
      '--activation', 'code',
      '--password', randomUUID(),
    ])).toThrow('Unknown option: --password');
    expect(() => parseTenantAdminBootstrapArguments([
      ...base,
      '--activation', 'code',
      '--email', 'pilot@example.test',
    ])).toThrow('--email is not accepted in code activation mode.');
    expect(parseTenantAdminBootstrapArguments([
      ...base,
      '--activation', 'email',
      '--email', 'pilot@example.test',
    ])).toMatchObject({ activationMethod: 'email', email: 'pilot@example.test' });
  });

  it('requires email-outbox configuration only for email activation', () => {
    const shared = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://identity:identity@127.0.0.1:5432/identity',
      ARGON2_MEMORY_COST: '8192',
      ARGON2_TIME_COST: '2',
      ARGON2_PARALLELISM: '1',
      ARGON2_HASH_LENGTH: '32',
      ARGON2_SALT_LENGTH: '16',
      OPAQUE_TOKEN_BYTES: '32',
    };
    expect(validateTenantAdminBootstrapEnvironment(shared, 'code')).toMatchObject({
      IDENTITY_ACTIVATION_TTL_SECONDS: 3600,
    });
    expect(() => validateTenantAdminBootstrapEnvironment(shared, 'email')).toThrow(
      'Invalid bootstrap environment configuration',
    );
    expect(validateTenantAdminBootstrapEnvironment({
      ...shared,
      IDENTITY_EMAIL_FROM: 'EduPay Identity <identity@example.test>',
      IDENTITY_PUBLIC_BASE_URL: 'https://identity.example.test',
      IDENTITY_OUTBOX_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }, 'email')).toMatchObject({ IDENTITY_EMAIL_INVITATION_TTL_SECONDS: 86400 });
  });

  it('masks the email destination in safe operator output', () => {
    expect(maskEmail('pilot.admin@example.test')).toBe('p***@e***.test');
  });
});
