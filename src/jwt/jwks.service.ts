import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';

const publicJwkSchema = z
  .object({
    kty: z.string().min(1),
    kid: z.string().min(1),
    use: z.literal('sig'),
    alg: z.string().min(1),
  })
  .passthrough();

const jwksSchema = z.object({ keys: z.array(publicJwkSchema).min(1) }).strict();
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;

export interface PublicJwks {
  keys: Array<Record<string, unknown>>;
}

@Injectable()
export class JwksService {
  private cached: PublicJwks | undefined;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async getPublicJwks(): Promise<PublicJwks> {
    if (this.cached) return this.cached;

    const content = await readFile(this.config.getOrThrow('JWT_PUBLIC_JWKS_PATH'), 'utf8');
    const parsed = jwksSchema.parse(JSON.parse(content));

    for (const key of parsed.keys) {
      if (PRIVATE_JWK_MEMBERS.some((member) => member in key)) {
        throw new Error('Configured JWKS contains private key material');
      }
    }

    const expectedKeyId = this.config.getOrThrow('JWT_KEY_ID');
    const expectedAlgorithm = this.config.getOrThrow('JWT_ALGORITHM');
    if (!parsed.keys.some((key) => key.kid === expectedKeyId && key.alg === expectedAlgorithm)) {
      throw new Error('Configured JWKS does not contain the active public signing key');
    }

    this.cached = { keys: parsed.keys };
    return this.cached;
  }
}
