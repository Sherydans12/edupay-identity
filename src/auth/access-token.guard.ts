import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { MembershipStatus, TenantRealmStatus } from '../generated/prisma/enums.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { JwtVerificationService } from '../jwt/jwt-verification.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { ActiveMembershipContext, AuthenticatedRequest } from './auth.types.js';

const TOKEN_INVALID_MESSAGE = 'The access token is invalid or expired.';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer ([^\s,]+)$/);
    if (!match?.[1]) this.reject();

    try {
      const claims = await this.verifier.verifyAccessToken(match[1]);
      const session = await this.prisma.session.findUnique({
        where: { id: claims.sid },
        include: {
          user: true,
          activeMembership: {
            include: {
              tenantRealm: true,
              roles: { include: { role: true } },
            },
          },
        },
      });
      const now = new Date();
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.idleExpiresAt <= now ||
        session.absoluteExpiresAt <= now ||
        session.user.status !== 'ACTIVE'
      ) {
        this.reject();
      }

      let activeMembership: ActiveMembershipContext | null = null;
      if (session.activeMembership) {
        const membership = session.activeMembership;
        const roles = membership.roles.map(({ role }) => role.code).sort();
        const tokenRoles = [...(claims.roles ?? [])].sort();
        if (
          membership.status !== MembershipStatus.ACTIVE ||
          membership.tenantRealm.status !== TenantRealmStatus.ACTIVE ||
          claims.membership_id !== membership.id ||
          claims.tenant_id !== membership.tenantRealmId ||
          roles.join('\0') !== tokenRoles.join('\0')
        ) {
          this.reject();
        }
        activeMembership = {
          membershipId: membership.id,
          tenantId: membership.tenantRealmId,
          tenantHandle: membership.tenantRealm.handle,
          status: 'ACTIVE',
          roles,
        };
      } else if (claims.membership_id || claims.tenant_id || claims.roles) {
        this.reject();
      }

      (request as AuthenticatedRequest).auth = {
        userId: session.userId,
        sessionId: session.id,
        jwtId: claims.jti,
        authenticatedAt: claims.auth_time,
        scope: [...claims.scope],
        activeMembership,
      };
      return true;
    } catch (error) {
      if (error instanceof SafeHttpException) throw error;
      this.reject();
    }
  }

  private reject(): never {
    throw new SafeHttpException(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', TOKEN_INVALID_MESSAGE);
  }
}
