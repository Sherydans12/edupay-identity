import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SafeHttpException } from '../common/safe-http.exception.js';
import type { Environment } from '../config/environment.js';

const MAX_INTERNAL_BODY_BYTES = 16 * 1_024;
const FIXED_NON_MATCHING_DIGEST = Buffer.alloc(32, 0);

@Injectable()
export class InternalServiceAuthenticator {
  private readonly currentDigest: Buffer;
  private readonly previousDigest: Buffer;
  private readonly previousExpiresAt: number;
  private readonly hasCurrent: boolean;
  private readonly hasPrevious: boolean;

  constructor(config: ConfigService<Environment, true>) {
    const current = config.getOrThrow('IDENTITY_ACADEMICO_SERVICE_TOKEN');
    const previous = config.getOrThrow('IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS');
    const previousExpiresAt = config.getOrThrow(
      'IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT',
    );

    this.hasCurrent = current !== '';
    this.hasPrevious = previous !== '';
    this.currentDigest = this.hasCurrent ? this.digest(current) : FIXED_NON_MATCHING_DIGEST;
    this.previousDigest = this.hasPrevious ? this.digest(previous) : FIXED_NON_MATCHING_DIGEST;
    this.previousExpiresAt = previousExpiresAt === '' ? 0 : Date.parse(previousExpiresAt);
  }

  authenticate(candidate: string): boolean {
    const candidateDigest = this.digest(candidate);
    const currentMatches = timingSafeEqual(candidateDigest, this.currentDigest);
    const previousMatches = timingSafeEqual(candidateDigest, this.previousDigest);
    const previousIsActive = this.hasPrevious && Date.now() < this.previousExpiresAt;

    return this.hasCurrent && (currentMatches || (previousIsActive && previousMatches));
  }

  private digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
  }
}

@Injectable()
export class InternalServiceAuthGuard implements CanActivate {
  constructor(private readonly authenticator: InternalServiceAuthenticator) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.header('origin') !== undefined) {
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'INTERNAL_BROWSER_REQUEST_DENIED',
        'The requested action is not permitted.',
      );
    }

    this.assertBoundedBody(request);
    const authorization = request.header('authorization') ?? '';
    const match = authorization.match(/^Bearer ([^\s,]{1,1024})$/i);
    const candidate = match?.[1] ?? '';
    if (!this.authenticator.authenticate(candidate)) {
      throw new SafeHttpException(
        HttpStatus.UNAUTHORIZED,
        'SERVICE_AUTHENTICATION_FAILED',
        'The service credentials could not be verified.',
      );
    }
    return true;
  }

  private assertBoundedBody(request: Request): void {
    const declaredLength = request.header('content-length');
    const parsedLength = request.body === undefined
      ? 0
      : Buffer.byteLength(JSON.stringify(request.body), 'utf8');
    if (
      (declaredLength !== undefined && Number(declaredLength) > MAX_INTERNAL_BODY_BYTES) ||
      parsedLength > MAX_INTERNAL_BODY_BYTES
    ) {
      throw new SafeHttpException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'REQUEST_TOO_LARGE',
        'The request body is too large.',
      );
    }
  }
}
