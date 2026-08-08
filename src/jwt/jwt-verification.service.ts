import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import { JwksService } from './jwks.service.js';

const stringArray = z.array(z.string().min(1).max(128)).max(32);
const accessClaimsSchema = z
  .object({
    iss: z.string().min(1),
    aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    sub: z.uuid(),
    sid: z.uuid(),
    jti: z.uuid(),
    iat: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    tenant_id: z.uuid().optional(),
    membership_id: z.uuid().optional(),
    roles: stringArray.optional(),
    scope: stringArray,
    amr: stringArray,
    auth_time: z.number().int().nonnegative(),
  })
  .passthrough()
  .superRefine((claims, context) => {
    const hasTenant = claims.tenant_id !== undefined;
    const hasMembership = claims.membership_id !== undefined;
    const hasRoles = claims.roles !== undefined;
    if (hasTenant !== hasMembership || hasTenant !== hasRoles) {
      context.addIssue({ code: 'custom', message: 'Tenant context claims must be complete' });
    }
    if (claims.exp <= claims.iat || claims.nbf < claims.iat) {
      context.addIssue({ code: 'custom', message: 'Invalid token time bounds' });
    }
  });

export type VerifiedAccessClaims = z.infer<typeof accessClaimsSchema>;

@Injectable()
export class JwtVerificationService {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly jwks: JwksService,
  ) {}

  async verifyAccessToken(token: string): Promise<VerifiedAccessClaims> {
    const publicJwks = await this.jwks.getPublicJwks();
    const keySet = createLocalJWKSet(publicJwks);
    const algorithm = this.config.getOrThrow('JWT_ALGORITHM');
    const { payload } = await jwtVerify(token, keySet, {
      issuer: this.config.getOrThrow('JWT_ISSUER'),
      audience: this.config.getOrThrow('JWT_AUDIENCE'),
      algorithms: [algorithm],
      typ: 'JWT',
      requiredClaims: ['sub', 'sid', 'jti', 'iat', 'nbf', 'exp', 'scope', 'amr', 'auth_time'],
    });

    const claims = accessClaimsSchema.parse(payload);
    if (claims.exp - claims.iat > this.config.getOrThrow('JWT_ACCESS_TTL_SECONDS')) {
      throw new Error('Access token lifetime exceeds the configured maximum');
    }
    return claims;
  }
}
