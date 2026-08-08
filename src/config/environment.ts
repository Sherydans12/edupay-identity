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
