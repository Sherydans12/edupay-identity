import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import { IdentifierNormalizationService } from '../auth/identifier-normalization.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import {
  IDENTITY_EMAIL_VERIFICATION_USAGE,
  IdentityEmailVerificationConflictError,
  IdentityEmailVerificationGateError,
  IdentityEmailVerificationService,
  IdentityEmailVerificationUsageError,
  assertIdentityEmailVerificationPostconditions,
  parseIdentityEmailVerificationArguments,
} from './identity-email-verification.js';
import type { IdentityEmailVerificationResult } from './identity-email-verification.js';

const operatorEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().min(1).refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'must use the PostgreSQL protocol',
  ),
});

export function validateIdentityEmailVerificationEnvironment(source: Record<string, unknown>): Pick<Environment, 'NODE_ENV' | 'DATABASE_URL'> {
  const result = operatorEnvironmentSchema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new IdentityEmailVerificationUsageError(`Invalid operator environment configuration: ${fields}`);
  }
  return result.data;
}

export function formatIdentityEmailVerificationOutput(result: IdentityEmailVerificationResult): string {
  return JSON.stringify({
    action: 'IDENTITY_EMAIL_VERIFICATION',
    userId: result.userId,
    membershipId: result.membershipId,
    tenantId: result.tenantId,
    username: result.username,
    destinationEmail: result.destinationEmail,
    emailIdentifierCount: result.emailIdentifierCount,
    emailDestinationMatches: result.emailDestinationMatches,
    emailVerified: result.emailVerified,
    tenantAdminPresent: result.tenantAdminPresent,
  });
}

async function main(): Promise<void> {
  const parsed = parseIdentityEmailVerificationArguments(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(IDENTITY_EMAIL_VERIFICATION_USAGE);
    return;
  }

  const environment = validateIdentityEmailVerificationEnvironment(process.env);
  const config = new ConfigService<Environment, true>(environment as Environment);
  const prisma = new PrismaService(config);
  const verification = new IdentityEmailVerificationService(prisma, new IdentifierNormalizationService());

  try {
    const result = await verification.verify(parsed);
    console.log(formatIdentityEmailVerificationOutput(result));
    assertIdentityEmailVerificationPostconditions(result);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    if (error instanceof IdentityEmailVerificationUsageError) {
      console.error(`${error.message}\n${IDENTITY_EMAIL_VERIFICATION_USAGE}`);
    } else if (error instanceof IdentityEmailVerificationConflictError) {
      console.error(`Identity email verification refused: ${error.message}`);
    } else if (error instanceof IdentityEmailVerificationGateError) {
      console.error(`Identity email verification gate failed: ${error.message}`);
    } else {
      console.error('Identity email verification failed. No credential or token value was logged.');
    }
    process.exitCode = 1;
  });
}
