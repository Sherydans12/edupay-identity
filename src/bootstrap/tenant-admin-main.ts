import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import { EmailOutboxService } from '../email/email-outbox.service.js';
import { EmailDeliveryAdapter } from '../email/email.types.js';
import type { EmailDeliveryResult, EmailMessage } from '../email/email.types.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { Argon2Service } from '../security/argon2.service.js';
import { OpaqueTokenService } from '../security/opaque-token.service.js';
import { IdentifierNormalizationService } from '../auth/identifier-normalization.service.js';
import {
  TENANT_ADMIN_BOOTSTRAP_USAGE,
  TenantAdminBootstrapConflictError,
  TenantAdminBootstrapService,
  TenantAdminBootstrapUsageError,
  parseTenantAdminBootstrapArguments,
} from './tenant-admin-bootstrap.js';
import type {
  TenantAdminActivationMethod,
  TenantAdminBootstrapResult,
} from './tenant-admin-bootstrap.js';

const positiveInteger = z.coerce.number().int().positive();

const sharedEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().min(1).refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'must use the PostgreSQL protocol',
  ),
  ARGON2_MEMORY_COST: positiveInteger,
  ARGON2_TIME_COST: positiveInteger,
  ARGON2_PARALLELISM: positiveInteger,
  ARGON2_HASH_LENGTH: positiveInteger,
  ARGON2_SALT_LENGTH: positiveInteger,
  OPAQUE_TOKEN_BYTES: positiveInteger.min(32),
  IDENTITY_ACTIVATION_TTL_SECONDS: positiveInteger.max(86_400).default(3_600),
});

const emailEnvironmentSchema = sharedEnvironmentSchema.extend({
  IDENTITY_EMAIL_FROM: z.string().min(3),
  IDENTITY_PUBLIC_BASE_URL: z.url(),
  IDENTITY_EMAIL_INVITATION_TTL_SECONDS: positiveInteger.max(604_800).default(86_400),
  OUTBOX_MAX_ATTEMPTS: positiveInteger.max(20).default(5),
  OUTBOX_BASE_BACKOFF_SECONDS: positiveInteger.max(3_600).default(30),
  IDENTITY_OUTBOX_ENCRYPTION_KEY: z.string().optional(),
}).superRefine((environment, context) => {
  const encodedKey = environment.IDENTITY_OUTBOX_ENCRYPTION_KEY;
  if (environment.NODE_ENV === 'production' && !encodedKey) {
    context.addIssue({
      code: 'custom',
      path: ['IDENTITY_OUTBOX_ENCRYPTION_KEY'],
      message: 'is required for email activation in production',
    });
  }
  if (encodedKey && Buffer.from(encodedKey, 'base64').length !== 32) {
    context.addIssue({
      code: 'custom',
      path: ['IDENTITY_OUTBOX_ENCRYPTION_KEY'],
      message: 'must decode to exactly 32 bytes',
    });
  }
});

class BootstrapOnlyEmailAdapter extends EmailDeliveryAdapter {
  send(message: EmailMessage, deliveryKey: string): Promise<EmailDeliveryResult> {
    void message;
    void deliveryKey;
    return Promise.reject(new Error('The bootstrap command queues email but never delivers it.'));
  }
}

export function validateTenantAdminBootstrapEnvironment(
  source: Record<string, unknown>,
  activationMethod: TenantAdminActivationMethod,
): Environment {
  const result = (activationMethod === 'email' ? emailEnvironmentSchema : sharedEnvironmentSchema).safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new TenantAdminBootstrapUsageError(`Invalid bootstrap environment configuration: ${fields}`);
  }
  return result.data as unknown as Environment;
}

export function formatTenantAdminBootstrapOutput(result: TenantAdminBootstrapResult): string {
  const evidence = {
    action: 'IDENTITY_TENANT_ADMIN_BOOTSTRAP',
    status: result.operation,
    tenantId: result.tenantId,
    tenantHandle: result.tenantHandle,
    username: result.username,
    membershipId: result.membershipId,
    membershipStatus: result.membershipStatus,
    roles: result.roles,
    activation: result.activation,
  };
  if (result.activation.method === 'code' && result.activation.issued) {
    return [
      'ONE-TIME SENSITIVE OUTPUT — deliver the activation code through the approved institutional channel.',
      JSON.stringify(evidence),
      'The activation code cannot be recovered later. Do not place this output in logs, tickets, or release evidence.',
    ].join('\n');
  }
  return JSON.stringify(evidence);
}

async function main(): Promise<void> {
  const parsed = parseTenantAdminBootstrapArguments(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(TENANT_ADMIN_BOOTSTRAP_USAGE);
    return;
  }

  const environment = validateTenantAdminBootstrapEnvironment(process.env, parsed.activationMethod);
  const config = new ConfigService<Environment, true>(environment);
  const prisma = new PrismaService(config);
  const argon2 = new Argon2Service(config);
  const opaqueTokens = new OpaqueTokenService(config, argon2);
  const normalization = new IdentifierNormalizationService();
  const emailOutbox = parsed.activationMethod === 'email'
    ? new EmailOutboxService(prisma, new BootstrapOnlyEmailAdapter(), config)
    : undefined;
  const bootstrap = new TenantAdminBootstrapService(
    prisma,
    opaqueTokens,
    normalization,
    config,
    emailOutbox,
  );

  try {
    const result = await bootstrap.bootstrap(parsed);
    console.log(formatTenantAdminBootstrapOutput(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    if (error instanceof TenantAdminBootstrapUsageError) {
      console.error(`${error.message}\n${TENANT_ADMIN_BOOTSTRAP_USAGE}`);
    } else if (error instanceof TenantAdminBootstrapConflictError) {
      console.error(`Identity tenant-admin bootstrap refused: ${error.message}`);
    } else {
      console.error('Identity tenant-admin bootstrap failed. No bootstrap secret was logged.');
    }
    process.exitCode = 1;
  });
}
