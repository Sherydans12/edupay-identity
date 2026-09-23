import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  AuditOutcome,
  IdentityUserStatus,
  MembershipStatus,
  RoleCode,
  TenantRealmStatus,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { AuditService } from '../security/audit.service.js';
import { RateLimitPolicy } from '../security/rate-limit.policy.js';
import type {
  ExpectedAcademicRole,
  InternalActorDto,
  ResolveIdentityUserDto,
  ResolveEligiblePersonnelDto,
  VerifyTenantMembershipDto,
} from './internal-academic.dto.js';

type LinkableMembershipStatus = typeof MembershipStatus.ACTIVE | typeof MembershipStatus.PENDING_ACTIVATION;

interface RevalidatedActor {
  identityUserId: string;
  sessionId: string;
  membershipId: string;
  tenantId: string;
}

export interface InternalSessionStatus {
  active: boolean;
  identityUserId: string;
  membershipActive: boolean;
  membershipId: string;
  sessionActive: boolean;
  sessionId: string;
  tenantId: string;
}

export interface ResolvedIdentityUser {
  verified: true;
  identityUserId: string;
  membershipId: string;
  tenantId: string;
  membershipStatus: LinkableMembershipStatus;
  roles: ExpectedAcademicRole[];
}

export interface VerifiedTenantMembership {
  verified: true;
  identityUserId: string;
  membershipId: string;
  tenantId: string;
  membershipStatus: typeof MembershipStatus.ACTIVE;
  roles: RoleCode[];
}

export interface ResolvedEligiblePersonnel extends VerifiedTenantMembership {
  institutionalUsername: string;
}

@Injectable()
export class InternalAcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimits: RateLimitPolicy,
    private readonly audit: AuditService,
  ) {}

  async sessionStatus(sessionId: string, requestId: string, sourceAddress: string): Promise<InternalSessionStatus> {
    await this.assertRateLimit([`status:source:${sourceAddress}`, `status:session:${sessionId}`]);
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
        activeMembership: { include: { tenantRealm: true } },
      },
    });
    if (!session?.activeMembership) this.notFound();

    const now = new Date();
    const sessionActive =
      session.revokedAt === null &&
      session.idleExpiresAt > now &&
      session.absoluteExpiresAt > now &&
      session.user.status === IdentityUserStatus.ACTIVE;
    const membership = session.activeMembership;
    const membershipActive =
      membership.userId === session.userId &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.tenantRealm.status === TenantRealmStatus.ACTIVE;

    return {
      active: sessionActive && membershipActive,
      identityUserId: session.userId,
      membershipActive,
      membershipId: membership.id,
      sessionActive,
      sessionId: session.id,
      tenantId: membership.tenantRealmId,
    };
  }

  async resolveIdentityUser(
    input: ResolveIdentityUserDto,
    requestId: string,
    sourceAddress: string,
  ): Promise<ResolvedIdentityUser> {
    await this.assertRateLimit([
      `resolve:source:${sourceAddress}`,
      `resolve:actor-session:${input.actor.sessionId}`,
      `resolve:target:${input.targetIdentityUserId}`,
    ]);
    const actor = await this.revalidateActor(input.actor, requestId);
    const target = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: input.targetIdentityUserId,
        tenantRealmId: actor.tenantId,
      },
      include: {
        user: true,
        tenantRealm: true,
        roles: { include: { role: true } },
      },
    });

    const targetRoleCodes = target?.roles.map(({ role }) => role.code) ?? [];
    const targetIsVerified =
      target !== null &&
      target.user.status === IdentityUserStatus.ACTIVE &&
      target.tenantRealm.status === TenantRealmStatus.ACTIVE &&
      (target.status === MembershipStatus.PENDING_ACTIVATION || target.status === MembershipStatus.ACTIVE) &&
      targetRoleCodes.includes(input.expectedRole);

    if (!targetIsVerified) {
      await this.audit.record({
        eventType: 'INTERNAL_IDENTITY_RESOLVE_DENIED',
        outcome: AuditOutcome.DENIED,
        actorUserId: actor.identityUserId,
        tenantRealmId: actor.tenantId,
        sessionId: actor.sessionId,
        requestId,
        metadata: {
          category: 'target-verification',
          expectedRole: input.expectedRole,
        },
      });
      this.linkNotVerified();
    }

    await this.audit.record({
      eventType: 'INTERNAL_IDENTITY_LINK_VERIFIED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.identityUserId,
      tenantRealmId: actor.tenantId,
      sessionId: actor.sessionId,
      requestId,
      metadata: {
        targetIdentityUserId: target.userId,
        targetMembershipId: target.id,
        expectedRole: input.expectedRole,
        membershipStatus: target.status,
      },
    });

    return {
      verified: true,
      identityUserId: target.userId,
      membershipId: target.id,
      tenantId: target.tenantRealmId,
      membershipStatus:
        target.status === MembershipStatus.ACTIVE ? MembershipStatus.ACTIVE : MembershipStatus.PENDING_ACTIVATION,
      roles: [input.expectedRole],
    };
  }

  async verifyTenantMembership(
    input: VerifyTenantMembershipDto,
    requestId: string,
    sourceAddress: string,
  ): Promise<VerifiedTenantMembership> {
    await this.assertRateLimit([
      `verify-membership:source:${sourceAddress}`,
      `verify-membership:actor-session:${input.actor.sessionId}`,
      `verify-membership:target:${input.targetIdentityUserId}`,
    ]);
    const actor = await this.revalidateActor(input.actor, requestId, false);
    const target = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: input.targetIdentityUserId,
        tenantRealmId: actor.tenantId,
      },
      include: {
        user: true,
        tenantRealm: true,
        roles: { include: { role: true } },
      },
    });
    const verified =
      target !== null &&
      target.user.status === IdentityUserStatus.ACTIVE &&
      target.tenantRealm.status === TenantRealmStatus.ACTIVE &&
      target.status === MembershipStatus.ACTIVE;
    if (!verified || !target) {
      await this.audit.record({
        eventType: 'INTERNAL_TENANT_MEMBERSHIP_VERIFY_DENIED',
        outcome: AuditOutcome.DENIED,
        actorUserId: actor.identityUserId,
        tenantRealmId: actor.tenantId,
        sessionId: actor.sessionId,
        requestId,
        metadata: { category: 'target-verification' },
      });
      this.linkNotVerified();
    }
    const roles = target.roles.map(({ role }) => role.code).sort();
    await this.audit.record({
      eventType: 'INTERNAL_TENANT_MEMBERSHIP_VERIFIED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.identityUserId,
      tenantRealmId: actor.tenantId,
      sessionId: actor.sessionId,
      requestId,
      metadata: {
        targetIdentityUserId: target.userId,
        targetMembershipId: target.id,
        roleCount: roles.length,
      },
    });
    return {
      verified: true,
      identityUserId: target.userId,
      membershipId: target.id,
      tenantId: target.tenantRealmId,
      membershipStatus: MembershipStatus.ACTIVE,
      roles,
    };
  }

  async resolveEligiblePersonnel(
    input: ResolveEligiblePersonnelDto,
    requestId: string,
    sourceAddress: string,
  ): Promise<ResolvedEligiblePersonnel> {
    const username = input.institutionalUsername.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const targetKey = createHash('sha256').update(username).digest('base64url');
    await this.assertRateLimit([
      `resolve-personnel:source:${sourceAddress}`,
      `resolve-personnel:actor-session:${input.actor.sessionId}`,
      `resolve-personnel:target:${targetKey}`,
    ]);
    const actor = await this.revalidateActor(input.actor, requestId, false);
    const identifier = await this.prisma.loginIdentifier.findFirst({
      where: {
        tenantRealmId: actor.tenantId,
        kind: 'USERNAME',
        normalizedValue: username,
      },
      include: {
        user: {
          include: {
            memberships: {
              where: { tenantRealmId: actor.tenantId },
              include: {
                tenantRealm: true,
                roles: { include: { role: true } },
              },
            },
          },
        },
      },
    });
    const target = identifier?.user.memberships[0];
    const roles = target?.roles.map(({ role }) => role.code).sort() ?? [];
    const eligibleRole = roles.some((role) =>
      role === RoleCode.STAFF || role === RoleCode.TEACHER || role === RoleCode.TENANT_ADMIN,
    );
    const excludedRole = roles.some((role) => role === RoleCode.STUDENT || role === RoleCode.GUARDIAN);
    const verified =
      identifier != null &&
      identifier.user.status === IdentityUserStatus.ACTIVE &&
      target != null &&
      target.status === MembershipStatus.ACTIVE &&
      target.tenantRealm.status === TenantRealmStatus.ACTIVE &&
      eligibleRole &&
      !excludedRole;
    if (!verified || !identifier || !target) {
      await this.audit.record({
        eventType: 'INTERNAL_ELIGIBLE_PERSONNEL_RESOLVE_DENIED',
        outcome: AuditOutcome.DENIED,
        actorUserId: actor.identityUserId,
        tenantRealmId: actor.tenantId,
        sessionId: actor.sessionId,
        requestId,
        metadata: { category: 'target-verification' },
      });
      this.linkNotVerified();
    }
    await this.audit.record({
      eventType: 'INTERNAL_ELIGIBLE_PERSONNEL_RESOLVED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.identityUserId,
      tenantRealmId: actor.tenantId,
      sessionId: actor.sessionId,
      requestId,
      metadata: {
        targetIdentityUserId: target.userId,
        targetMembershipId: target.id,
        roleCount: roles.length,
      },
    });
    return {
      verified: true,
      identityUserId: target.userId,
      membershipId: target.id,
      tenantId: target.tenantRealmId,
      membershipStatus: MembershipStatus.ACTIVE,
      institutionalUsername: username,
      roles,
    };
  }

  private async revalidateActor(
    actor: InternalActorDto,
    requestId: string,
    requireTenantAdmin = true,
  ): Promise<RevalidatedActor> {
    const session = await this.prisma.session.findUnique({
      where: { id: actor.sessionId },
      include: {
        user: true,
        activeMembership: {
          include: { tenantRealm: true, roles: { include: { role: true } } },
        },
      },
    });
    const now = new Date();
    const membership = session?.activeMembership;
    const actorIsAuthorized =
      session !== null &&
      session.userId === actor.identityUserId &&
      session.user.status === IdentityUserStatus.ACTIVE &&
      session.revokedAt === null &&
      session.idleExpiresAt > now &&
      session.absoluteExpiresAt > now &&
      membership != null &&
      membership.id === actor.membershipId &&
      membership.userId === actor.identityUserId &&
      membership.tenantRealmId === actor.tenantId &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.tenantRealm.status === TenantRealmStatus.ACTIVE &&
      (!requireTenantAdmin || membership.roles.some(({ role }) => role.code === RoleCode.TENANT_ADMIN));

    if (!actorIsAuthorized || !session || !membership) {
      await this.audit.record({
        eventType: 'INTERNAL_IDENTITY_RESOLVE_DENIED',
        outcome: AuditOutcome.DENIED,
        requestId,
        metadata: { category: 'actor-context' },
      });
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'ACTOR_CONTEXT_NOT_AUTHORIZED',
        'The actor context is not authorized.',
      );
    }

    return {
      identityUserId: session.userId,
      sessionId: session.id,
      membershipId: membership.id,
      tenantId: membership.tenantRealmId,
    };
  }

  private async assertRateLimit(keys: ReadonlyArray<string>): Promise<void> {
    const decision = await this.rateLimits.consume({
      bucket: 'internal',
      keys,
    });
    if (!decision.allowed) {
      throw new SafeHttpException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests were received.');
    }
  }

  private notFound(): never {
    throw new SafeHttpException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The requested resource was not found.');
  }

  private linkNotVerified(): never {
    throw new SafeHttpException(
      HttpStatus.NOT_FOUND,
      'IDENTITY_LINK_NOT_VERIFIED',
      'The requested identity link could not be verified.',
    );
  }
}
