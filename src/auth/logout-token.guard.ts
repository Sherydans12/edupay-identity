import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { JwtVerificationService } from '../jwt/jwt-verification.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

/** Allows an otherwise valid access token to retry logout after its session was revoked. */
@Injectable()
export class LogoutTokenGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const match = request.header('authorization')?.match(/^Bearer ([^\s,]+)$/);
    try {
      if (!match?.[1]) throw new Error('Missing bearer token');
      const claims = await this.verifier.verifyAccessToken(match[1]);
      const session = await this.prisma.session.findUnique({
        where: { id: claims.sid },
        select: { id: true, userId: true },
      });
      if (!session || session.userId !== claims.sub) throw new Error('Unknown session');
      (request as AuthenticatedRequest).auth = {
        userId: session.userId,
        sessionId: session.id,
        jwtId: claims.jti,
        authenticatedAt: claims.auth_time,
        scope: [...claims.scope],
        activeMembership: null,
      };
      return true;
    } catch {
      throw new SafeHttpException(
        HttpStatus.UNAUTHORIZED,
        'TOKEN_INVALID',
        'The access token is invalid or expired.',
      );
    }
  }
}
