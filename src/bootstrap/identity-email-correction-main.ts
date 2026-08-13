import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import { IdentifierNormalizationService } from '../auth/identifier-normalization.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import {
  IDENTITY_EMAIL_CORRECTION_USAGE,
  IdentityEmailCorrectionConflictError,
  IdentityEmailCorrectionService,
  IdentityEmailCorrectionUsageError,
  parseIdentityEmailCorrectionArguments,
} from './identity-email-correction.js';
import type { IdentityEmailCorrectionResult } from './identity-email-correction.js';

const operatorEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().min(1).refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'must use the PostgreSQL protocol',
  ),
});

export function validateIdentityEmailCorrectionEnvironment(source: Record<string, unknown>): Pick<Environment, 'NODE_ENV' | 'DATABASE_URL'> {
  const result = operatorEnvironmentSchema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new IdentityEmailCorrectionUsageError(`Invalid operator environment configuration: ${fields}`);
  }
  return result.data;
}

export function formatIdentityEmailCorrectionOutput(result: IdentityEmailCorrectionResult): string {
  return JSON.stringify({
    action: 'IDENTITY_EMAIL_CORRECTION',
    status: result.status,
    userId: result.userId,
    membershipId: result.membershipId,
    tenantId: result.tenantId,
    username: result.username,
    destinationEmail: result.destinationEmail,
    sessionsRevoked: result.sessionsRevoked,
    passwordResetTokensRevoked: result.passwordResetTokensRevoked,
    invitationsRevoked: result.invitationsRevoked,
    activationChallengesRevoked: result.activationChallengesRevoked,
    requestId: result.requestId,
  });
}

async function main(): Promise<void> {
  const parsed = parseIdentityEmailCorrectionArguments(process.argv.slice(2));
  if ('help' in parsed) {
    console.log(IDENTITY_EMAIL_CORRECTION_USAGE);
    return;
  }

  const environment = validateIdentityEmailCorrectionEnvironment(process.env);
  const config = new ConfigService<Environment, true>(environment as Environment);
  const prisma = new PrismaService(config);
  const correction = new IdentityEmailCorrectionService(prisma, new IdentifierNormalizationService());

  try {
    const result = await correction.correct(parsed);
    console.log(formatIdentityEmailCorrectionOutput(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    if (error instanceof IdentityEmailCorrectionUsageError) {
      console.error(`${error.message}\n${IDENTITY_EMAIL_CORRECTION_USAGE}`);
    } else if (error instanceof IdentityEmailCorrectionConflictError) {
      console.error(`Identity email correction refused: ${error.message}`);
    } else {
      console.error('Identity email correction failed. No credential or token value was logged.');
    }
    process.exitCode = 1;
  });
}
