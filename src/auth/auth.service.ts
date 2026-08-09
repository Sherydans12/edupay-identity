import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  AuditOutcome,
  IdentityUserStatus,
  LoginIdentifierKind,
  MembershipStatus,
  TenantRealmStatus,
} from '../generated/prisma/enums.js';
import { JwtSigningService } from '../jwt/jwt-signing.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { OpaqueTokenService } from '../security/opaque-token.service.js';
import { PasswordHashService } from '../security/argon2.service.js';
import { RateLimitPolicy } from '../security/rate-limit.policy.js';
import type { LoginDto } from './auth.dto.js';
import { IdentifierNormalizationService } from './identifier-normalization.service.js';
import type {
  ActiveMembershipContext,
  AuthPrincipal,
  IssuedTokenResponse,
  TokenResponse,
} from './auth.types.js';

const AUTHENTICATION_FAILED_MESSAGE = 'The credentials could not be verified.';
const TOKEN_INVALID_MESSAGE = 'The refresh token is invalid or expired.';

interface MembershipRecord {
  id: string;
  tenantRealmId: string;
  status: MembershipStatus;
  tenantRealm: { handle: string; status: TenantRealmStatus };
  roles: Array<{ role: { code: string } }>;
}

interface SessionForToken {
  id: string;
  userId: string;
  createdAt: Date;
  activeMembership: MembershipRecord | null;
}

type RotationOutcome =
  | { kind: 'success'; session: SessionForToken; refreshToken: string; refreshExpiresAt: Date }
  | { kind: 'reuse' }
  | { kind: 'invalid' };

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHashService,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly jwt: JwtSigningService,
    private readonly normalization: IdentifierNormalizationService,
    private readonly rateLimits: RateLimitPolicy,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async login(input: LoginDto, requestId: string, sourceAddress: string): Promise<IssuedTokenResponse> {
    const isEmail = this.normalization.isEmail(input.identifier);
    const normalizedIdentifier = isEmail
      ? this.normalization.normalizeEmail(input.identifier)
      : this.normalization.normalizeUsername(input.identifier);
    const normalizedHandle = input.tenantHandle
      ? this.normalization.normalizeTenantHandle(input.tenantHandle)
      : undefined;

    await this.assertRateLimit('login', [sourceAddress, normalizedIdentifier, normalizedHandle ?? 'no-realm']);

    const tenantRealm = normalizedHandle
      ? await this.prisma.tenantRealm.findUnique({ where: { handle: normalizedHandle } })
      : null;
    const identifiers = await this.prisma.loginIdentifier.findMany({
      where: {
        kind: isEmail ? LoginIdentifierKind.EMAIL : LoginIdentifierKind.USERNAME,
        normalizedValue: normalizedIdentifier,
        ...(isEmail ? { verifiedAt: { not: null } } : {}),
        ...(tenantRealm ? { ...(isEmail ? {} : { tenantRealmId: tenantRealm.id }) } : {}),
        ...(normalizedHandle && !tenantRealm ? { id: '__unresolvable__' } : {}),
        ...(isEmail && tenantRealm
          ? { user: { memberships: { some: { tenantRealmId: tenantRealm.id } } } }
          : {}),
      },
      include: { user: { include: { passwordCredential: true } } },
      take: 3,
    });

    if (identifiers.length !== 1) {
      await this.passwords.verifyPassword(await this.getDummyHash(), input.password);
      await this.recordLoginFailure(requestId);
      this.authenticationFailed();
    }

    const identifier = identifiers[0]!;
    const user = identifier.user;
    const credential = user.passwordCredential;
    const hash = credential?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await this.safeVerify(hash, input.password);
    const isLocked = credential?.lockedUntil ? credential.lockedUntil > new Date() : false;
    if (
      !credential ||
      !passwordMatches ||
      isLocked ||
      user.status !== IdentityUserStatus.ACTIVE ||
      (tenantRealm !== null && tenantRealm.status !== TenantRealmStatus.ACTIVE)
    ) {
      if (credential && user.status === IdentityUserStatus.ACTIVE) {
        await this.recordCredentialFailure(user.id, credential.failedAttemptCount);
      }
      await this.recordLoginFailure(requestId, user.id, tenantRealm?.id);
      this.authenticationFailed();
    }

    let memberships: MembershipRecord[];
    if (!isEmail) {
      memberships = await this.prisma.tenantMembership.findMany({
        where: {
          userId: user.id,
          tenantRealmId: identifier.tenantRealmId!,
          status: MembershipStatus.ACTIVE,
          tenantRealm: { status: TenantRealmStatus.ACTIVE },
        },
        include: { tenantRealm: true, roles: { include: { role: true } } },
      });
    } else {
      memberships = await this.prisma.tenantMembership.findMany({
        where: {
          userId: user.id,
          status: MembershipStatus.ACTIVE,
          tenantRealm: { status: TenantRealmStatus.ACTIVE },
          ...(tenantRealm ? { tenantRealmId: tenantRealm.id } : {}),
        },
        include: { tenantRealm: true, roles: { include: { role: true } } },
        orderBy: { createdAt: 'asc' },
        take: 21,
      });
    }

    if (memberships.length === 0) {
      await this.recordLoginFailure(requestId, user.id, tenantRealm?.id ?? identifier.tenantRealmId ?? undefined);
      this.authenticationFailed();
    }
    if (!tenantRealm && isEmail && memberships.length > 1) {
      const bounded = memberships.slice(0, 20).map((membership) => this.toMembershipContext(membership));
      throw new SafeHttpException(
        HttpStatus.CONFLICT,
        'MEMBERSHIP_SELECTION_REQUIRED',
        'An active membership must be selected before signing in.',
        bounded,
      );
    }

    const activeMembership = memberships[0]!;
    if (this.passwords.requiresRehash(credential.passwordHash)) {
      const replacementHash = await this.passwords.hashPassword(input.password);
      await this.prisma.passwordCredential.updateMany({
        where: { userId: user.id, passwordHash: credential.passwordHash },
        data: { passwordHash: replacementHash },
      });
    }

    await this.prisma.passwordCredential.update({
      where: { userId: user.id },
      data: { failedAttemptCount: 0, lockedUntil: null },
    });
    return this.createSession(
      user.id,
      activeMembership,
      input.device?.label,
      requestId,
    );
  }

  async refresh(
    refreshToken: string | undefined,
    requestId: string,
    sourceAddress: string,
  ): Promise<IssuedTokenResponse> {
    const parsed = this.opaqueTokens.parse(refreshToken ?? '', 'rft');
    await this.assertRateLimit('refresh', [sourceAddress, parsed?.id ?? 'malformed']);
    if (!parsed) this.refreshInvalid();

    const stored = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } });
    if (!stored || !(await this.safeVerifyToken(stored.tokenHash, parsed))) this.refreshInvalid();

    const replacement = await this.opaqueTokens.issue('rft');
    const replacementPlaintext = replacement.revealOnce();
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (transaction): Promise<RotationOutcome> => {
      const current = await transaction.refreshToken.findUnique({
        where: { id: parsed.id },
        include: {
          session: {
            include: {
              user: true,
              activeMembership: {
                include: { tenantRealm: true, roles: { include: { role: true } } },
              },
            },
          },
        },
      });
      if (!current) return { kind: 'invalid' };

      if (current.usedAt) {
        await this.revokeFamily(transaction, current.sessionId, current.familyId, now, 'REFRESH_TOKEN_REUSE');
        await transaction.authAuditEvent.create({
          data: {
            eventType: 'REFRESH_TOKEN_REUSE',
            outcome: AuditOutcome.DENIED,
            actorUserId: current.session.userId,
            sessionId: current.sessionId,
            requestId,
          },
        });
        return { kind: 'reuse' };
      }

      const invalidReason = this.sessionInvalidReason(current.session, current, now);
      if (invalidReason) {
        await this.revokeFamily(transaction, current.sessionId, current.familyId, now, invalidReason);
        return { kind: 'invalid' };
      }

      const consumed = await transaction.refreshToken.updateMany({
        where: { id: current.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        await this.revokeFamily(transaction, current.sessionId, current.familyId, now, 'REFRESH_TOKEN_REUSE');
        await transaction.authAuditEvent.create({
          data: {
            eventType: 'REFRESH_TOKEN_REUSE',
            outcome: AuditOutcome.DENIED,
            actorUserId: current.session.userId,
            sessionId: current.sessionId,
            requestId,
          },
        });
        return { kind: 'reuse' };
      }

      const idleExpiresAt = this.minimumDate(
        new Date(now.getTime() + this.config.getOrThrow('REFRESH_IDLE_TTL_SECONDS') * 1_000),
        current.session.absoluteExpiresAt,
      );
      await transaction.refreshToken.create({
        data: {
          id: replacement.id,
          sessionId: current.sessionId,
          familyId: current.familyId,
          tokenHash: replacement.tokenHash,
          rotatedFromId: current.id,
          expiresAt: idleExpiresAt,
        },
      });
      await transaction.session.update({
        where: { id: current.sessionId },
        data: { lastSeenAt: now, idleExpiresAt },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'REFRESH_TOKEN_ROTATED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: current.session.userId,
          sessionId: current.sessionId,
          requestId,
        },
      });
      return {
        kind: 'success',
        session: {
          id: current.session.id,
          userId: current.session.userId,
          createdAt: current.session.createdAt,
          activeMembership: current.session.activeMembership,
        },
        refreshToken: replacementPlaintext,
        refreshExpiresAt: idleExpiresAt,
      };
    });

    if (outcome.kind === 'reuse') {
      throw new SafeHttpException(
        HttpStatus.UNAUTHORIZED,
        'REFRESH_REUSE_DETECTED',
        'Refresh token reuse was detected. Sign in again.',
      );
    }
    if (outcome.kind === 'invalid') this.refreshInvalid();
    return this.buildTokenResponse(outcome.session, outcome.refreshToken, outcome.refreshExpiresAt);
  }

  async logout(principal: AuthPrincipal, requestId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        where: { id: principal.sessionId, userId: principal.userId, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'USER_LOGOUT' },
      });
      await transaction.refreshToken.updateMany({
        where: { sessionId: principal.sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'LOGOUT',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: principal.userId,
          sessionId: principal.sessionId,
          requestId,
        },
      });
    });
  }

  async logoutAll(principal: AuthPrincipal, requestId: string): Promise<number> {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (nowSeconds - principal.authenticatedAt > this.config.getOrThrow('LOGOUT_ALL_REAUTH_MAX_AGE_SECONDS')) {
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'REAUTHENTICATION_REQUIRED',
        'Recent authentication is required for this action.',
      );
    }

    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const sessions = await transaction.session.findMany({
        where: { userId: principal.userId, revokedAt: null },
        select: { id: true },
      });
      const ids = sessions.map(({ id }) => id);
      if (ids.length > 0) {
        await transaction.refreshToken.updateMany({
          where: { sessionId: { in: ids }, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.session.updateMany({
          where: { id: { in: ids }, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'USER_LOGOUT_ALL' },
        });
      }
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'LOGOUT_ALL',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: principal.userId,
          requestId,
          metadata: { revokedSessionCount: ids.length },
        },
      });
      return ids.length;
    });
  }

  async me(principal: AuthPrincipal): Promise<Record<string, unknown>> {
    const platformRoles = await this.prisma.userRole.findMany({
      where: { userId: principal.userId },
      include: { role: true },
    });
    return {
      userId: principal.userId,
      status: 'ACTIVE',
      platformRoles: platformRoles.map(({ role }) => role.code).sort(),
      session: {
        id: principal.sessionId,
        authenticatedAt: new Date(principal.authenticatedAt * 1_000).toISOString(),
        activeMembership: principal.activeMembership,
      },
    };
  }

  async memberships(principal: AuthPrincipal): Promise<ActiveMembershipContext[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        userId: principal.userId,
        status: MembershipStatus.ACTIVE,
        tenantRealm: { status: TenantRealmStatus.ACTIVE },
      },
      include: { tenantRealm: true, roles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return memberships.map((membership) => this.toMembershipContext(membership));
  }

  async switchContext(
    principal: AuthPrincipal,
    membershipId: string,
    requestId: string,
  ): Promise<Omit<TokenResponse, 'refreshToken'>> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        id: membershipId,
        userId: principal.userId,
        status: MembershipStatus.ACTIVE,
        tenantRealm: { status: TenantRealmStatus.ACTIVE },
      },
      include: { tenantRealm: true, roles: { include: { role: true } } },
    });
    if (!membership) {
      throw new SafeHttpException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.session.updateMany({
        where: {
          id: principal.sessionId,
          userId: principal.userId,
          revokedAt: null,
          idleExpiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        data: { activeMembershipId: membership.id, lastSeenAt: now },
      });
      if (result.count !== 1) return false;
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'SESSION_CONTEXT_CHANGED',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: principal.userId,
          tenantRealmId: membership.tenantRealmId,
          sessionId: principal.sessionId,
          requestId,
          metadata: { membershipId: membership.id },
        },
      });
      return true;
    });
    if (!updated) {
      throw new SafeHttpException(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', 'The access token is invalid or expired.');
    }

    const accessToken = await this.signAccessToken({
      id: principal.sessionId,
      userId: principal.userId,
      createdAt: new Date(principal.authenticatedAt * 1_000),
      activeMembership: membership,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow('JWT_ACCESS_TTL_SECONDS'),
      sessionId: principal.sessionId,
      activeMembership: this.toMembershipContext(membership),
    };
  }

  private async createSession(
    userId: string,
    activeMembership: MembershipRecord,
    deviceLabel: string | undefined,
    requestId: string,
  ): Promise<IssuedTokenResponse> {
    const refresh = await this.opaqueTokens.issue('rft');
    const plaintextRefresh = refresh.revealOnce();
    const now = new Date();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.getOrThrow('SESSION_ABSOLUTE_TTL_SECONDS') * 1_000,
    );
    const idleExpiresAt = this.minimumDate(
      new Date(now.getTime() + this.config.getOrThrow('REFRESH_IDLE_TTL_SECONDS') * 1_000),
      absoluteExpiresAt,
    );
    const session = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.session.create({
        data: {
          userId,
          activeMembershipId: activeMembership.id,
          idleExpiresAt,
          absoluteExpiresAt,
          ...(deviceLabel ? { deviceLabel } : {}),
        },
      });
      await transaction.refreshToken.create({
        data: {
          id: refresh.id,
          sessionId: created.id,
          familyId: created.refreshTokenFamilyId,
          tokenHash: refresh.tokenHash,
          expiresAt: idleExpiresAt,
        },
      });
      await transaction.authAuditEvent.create({
        data: {
          eventType: 'LOGIN',
          outcome: AuditOutcome.SUCCESS,
          actorUserId: userId,
          tenantRealmId: activeMembership.tenantRealmId,
          sessionId: created.id,
          requestId,
          ...(deviceLabel ? { metadata: { deviceLabel } } : {}),
        },
      });
      return created;
    });

    try {
      return await this.buildTokenResponse(
        { id: session.id, userId, createdAt: session.createdAt, activeMembership },
        plaintextRefresh,
        session.idleExpiresAt,
      );
    } catch (error) {
      const revokedAt = new Date();
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt, revocationReason: 'ACCESS_TOKEN_ISSUANCE_FAILED' },
      });
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: session.id },
        data: { revokedAt },
      });
      throw error;
    }
  }

  private async buildTokenResponse(
    session: SessionForToken,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<IssuedTokenResponse> {
    return {
      response: {
        accessToken: await this.signAccessToken(session),
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: this.config.getOrThrow('JWT_ACCESS_TTL_SECONDS'),
        sessionId: session.id,
        activeMembership: session.activeMembership
          ? this.toMembershipContext(session.activeMembership)
          : null,
      },
      refreshExpiresAt,
    };
  }

  private signAccessToken(session: SessionForToken): Promise<string> {
    return this.jwt.signAccessToken({
      userId: session.userId,
      sessionId: session.id,
      jwtId: randomUUID(),
      scope: session.activeMembership ? ['academic:use'] : [],
      authenticationMethods: ['password'],
      authenticatedAt: Math.floor(session.createdAt.getTime() / 1_000),
      ...(session.activeMembership
        ? {
            tenantContext: {
              tenantId: session.activeMembership.tenantRealmId,
              membershipId: session.activeMembership.id,
              roles: this.roleCodes(session.activeMembership),
            },
          }
        : {}),
    });
  }

  private toMembershipContext(membership: MembershipRecord): ActiveMembershipContext {
    return {
      membershipId: membership.id,
      tenantId: membership.tenantRealmId,
      tenantHandle: membership.tenantRealm.handle,
      status: 'ACTIVE',
      roles: this.roleCodes(membership),
    };
  }

  private roleCodes(membership: MembershipRecord): string[] {
    return membership.roles.map(({ role }) => role.code).sort();
  }

  private sessionInvalidReason(
    session: {
      revokedAt: Date | null;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      user: { status: IdentityUserStatus };
      activeMembership: MembershipRecord | null;
    },
    token: { revokedAt: Date | null; expiresAt: Date },
    now: Date,
  ): string | null {
    if (session.revokedAt || token.revokedAt) return 'SESSION_REVOKED';
    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now || token.expiresAt <= now) {
      return 'SESSION_EXPIRED';
    }
    if (session.user.status !== IdentityUserStatus.ACTIVE) return 'USER_DISABLED';
    if (
      session.activeMembership &&
      (session.activeMembership.status !== MembershipStatus.ACTIVE ||
        session.activeMembership.tenantRealm.status !== TenantRealmStatus.ACTIVE)
    ) {
      return 'MEMBERSHIP_INACTIVE';
    }
    return null;
  }

  private async revokeFamily(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    sessionId: string,
    familyId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<void> {
    await transaction.refreshToken.updateMany({
      where: { sessionId, familyId, revokedAt: null },
      data: { revokedAt },
    });
    await transaction.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt, revocationReason: reason },
    });
  }

  private async recordCredentialFailure(userId: string, priorFailures: number): Promise<void> {
    const nextFailures = priorFailures + 1;
    const threshold = this.config.getOrThrow('PASSWORD_LOCK_THRESHOLD');
    await this.prisma.passwordCredential.update({
      where: { userId },
      data: {
        failedAttemptCount: { increment: 1 },
        ...(nextFailures >= threshold
          ? { lockedUntil: new Date(Date.now() + this.config.getOrThrow('PASSWORD_LOCK_SECONDS') * 1_000) }
          : {}),
      },
    });
  }

  private async recordLoginFailure(
    requestId: string,
    actorUserId?: string,
    tenantRealmId?: string,
  ): Promise<void> {
    await this.prisma.authAuditEvent.create({
      data: {
        eventType: 'LOGIN',
        outcome: AuditOutcome.FAILURE,
        requestId,
        ...(actorUserId ? { actorUserId } : {}),
        ...(tenantRealmId ? { tenantRealmId } : {}),
        metadata: { category: 'credentials' },
      },
    });
  }

  private async assertRateLimit(
    bucket: 'login' | 'refresh',
    keys: ReadonlyArray<string>,
  ): Promise<void> {
    const decision = await this.rateLimits.consume({ bucket, keys });
    if (!decision.allowed) {
      throw new SafeHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many requests were received.',
      );
    }
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hashPassword('constant-time-dummy-password');
    return this.dummyHash;
  }

  private async safeVerify(hash: string, candidate: string): Promise<boolean> {
    try {
      return await this.passwords.verifyPassword(hash, candidate);
    } catch {
      return false;
    }
  }

  private async safeVerifyToken(
    hash: string,
    parsed: { id: string; secret: string },
  ): Promise<boolean> {
    try {
      return await this.opaqueTokens.verify(hash, parsed);
    } catch {
      return false;
    }
  }

  private minimumDate(left: Date, right: Date): Date {
    return left <= right ? left : right;
  }

  private authenticationFailed(): never {
    throw new SafeHttpException(
      HttpStatus.UNAUTHORIZED,
      'AUTHENTICATION_FAILED',
      AUTHENTICATION_FAILED_MESSAGE,
    );
  }

  private refreshInvalid(): never {
    throw new SafeHttpException(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', TOKEN_INVALID_MESSAGE);
  }
}
