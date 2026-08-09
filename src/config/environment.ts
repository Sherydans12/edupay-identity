import { z } from 'zod';

const integerFromEnvironment = z.coerce.number().int().positive();

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must use the PostgreSQL protocol',
      ),
    JWT_ISSUER: z.url(),
    JWT_AUDIENCE: z.string().min(1),
    JWT_ACCESS_TTL_SECONDS: integerFromEnvironment.max(600),
    JWT_ALGORITHM: z.enum(['RS256', 'ES256', 'EdDSA']),
    JWT_KEY_ID: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/),
    JWT_PRIVATE_KEY_PATH: z.string().min(1),
    JWT_PUBLIC_JWKS_PATH: z.string().min(1),
    JWKS_CACHE_MAX_AGE_SECONDS: integerFromEnvironment,
    ARGON2_MEMORY_COST: integerFromEnvironment,
    ARGON2_TIME_COST: integerFromEnvironment,
    ARGON2_PARALLELISM: integerFromEnvironment,
    ARGON2_HASH_LENGTH: integerFromEnvironment,
    ARGON2_SALT_LENGTH: integerFromEnvironment,
    OPAQUE_TOKEN_BYTES: integerFromEnvironment.min(32),
    REFRESH_IDLE_TTL_SECONDS: integerFromEnvironment.max(2_592_000).default(2_592_000),
    SESSION_ABSOLUTE_TTL_SECONDS: integerFromEnvironment.max(7_776_000).default(7_776_000),
    LOGOUT_ALL_REAUTH_MAX_AGE_SECONDS: integerFromEnvironment.max(3_600).default(600),
    PASSWORD_LOCK_THRESHOLD: integerFromEnvironment.max(100).default(10),
    PASSWORD_LOCK_SECONDS: integerFromEnvironment.max(86_400).default(900),
    RATE_LIMIT_WINDOW_SECONDS: integerFromEnvironment.max(3_600).default(900),
    RATE_LIMIT_LOGIN_MAX: integerFromEnvironment.max(1_000).default(10),
    RATE_LIMIT_REFRESH_MAX: integerFromEnvironment.max(10_000).default(60),
    RESEND_API_KEY: z.string().optional().default(''),
    IDENTITY_EMAIL_FROM: z.string().min(3).default('EduPay Identity <no-reply@identity.invalid>'),
    IDENTITY_PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    IDENTITY_EMAIL_INVITATION_TTL_SECONDS: integerFromEnvironment.max(604_800).default(86_400),
    IDENTITY_ACTIVATION_TTL_SECONDS: integerFromEnvironment.max(86_400).default(3_600),
    IDENTITY_PASSWORD_RESET_TTL_SECONDS: integerFromEnvironment.max(86_400).default(3_600),
    ACTIVATION_ATTEMPT_LIMIT: integerFromEnvironment.max(100).default(10),
    PASSWORD_MIN_LENGTH: integerFromEnvironment.min(8).max(256).default(12),
    OUTBOX_MAX_ATTEMPTS: integerFromEnvironment.max(20).default(5),
    OUTBOX_BASE_BACKOFF_SECONDS: integerFromEnvironment.max(3_600).default(30),
    IDENTITY_OUTBOX_ENCRYPTION_KEY: z.string().optional(),
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  return result.data;
}
