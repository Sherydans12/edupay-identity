import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { importPKCS8, SignJWT } from 'jose';
import type { Environment } from '../config/environment.js';

interface TenantAccessContext {
  tenantId: string;
  membershipId: string;
  roles: ReadonlyArray<string>;
}

export interface AccessTokenInput {
  userId: string;
  sessionId: string;
  jwtId: string;
  scope: ReadonlyArray<string>;
  authenticationMethods: ReadonlyArray<string>;
  authenticatedAt: number;
  tenantContext?: TenantAccessContext;
}

@Injectable()
export class JwtSigningService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async signAccessToken(input: AccessTokenInput): Promise<string> {
    const algorithm = this.config.getOrThrow('JWT_ALGORITHM');
    const pem = await readFile(this.config.getOrThrow('JWT_PRIVATE_KEY_PATH'), 'utf8');
    const privateKey = await importPKCS8(pem, algorithm);
    const now = Math.floor(Date.now() / 1000);
    const ttl = this.config.getOrThrow('JWT_ACCESS_TTL_SECONDS');
    const contextClaims = input.tenantContext
      ? {
          tenant_id: input.tenantContext.tenantId,
          membership_id: input.tenantContext.membershipId,
          roles: [...input.tenantContext.roles],
        }
      : {};

    return new SignJWT({
      sid: input.sessionId,
      scope: [...input.scope],
      amr: [...input.authenticationMethods],
      auth_time: input.authenticatedAt,
      ...contextClaims,
    })
      .setProtectedHeader({
        alg: algorithm,
        kid: this.config.getOrThrow('JWT_KEY_ID'),
        typ: 'JWT',
      })
      .setIssuer(this.config.getOrThrow('JWT_ISSUER'))
      .setAudience(this.config.getOrThrow('JWT_AUDIENCE'))
      .setSubject(input.userId)
      .setJti(input.jwtId)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + ttl)
      .sign(privateKey);
  }
}
