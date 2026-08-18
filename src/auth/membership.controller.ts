import type { Request } from 'express';
import { Body, Controller, Header, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from './access-token.guard.js';
import { AccountLifecycleService } from './account-lifecycle.service.js';
import { CreateMembershipDto, UpdateMembershipDto } from './auth.dto.js';
import type { AuthenticatedRequest } from './auth.types.js';

@ApiTags('membership management')
@Controller({ path: 'tenants/:tenantId/memberships', version: '1' })
@UseGuards(AccessTokenGuard)
@ApiBearerAuth()
export class MembershipController {
  constructor(private readonly lifecycle: AccountLifecycleService) {}

  @Post()
  provision(
    @Param('tenantId') tenantId: string,
    @Body() input: CreateMembershipDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
      ? request.headers['idempotency-key']
      : undefined;
    return this.lifecycle.provisionMembership(
      request.auth,
      tenantId,
      input,
      request.requestId,
      idempotencyKey,
    );
  }

  @Patch(':membershipId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Body() input: UpdateMembershipDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.updateMembership(
      request.auth,
      tenantId,
      membershipId,
      input,
      request.requestId,
    );
  }

  @Post(':membershipId/revoke')
  revoke(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.revokeMembership(request.auth, tenantId, membershipId, request.requestId);
  }

  @Post(':membershipId/invite')
  invite(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.createInvitation(request.auth, tenantId, membershipId, request.requestId);
  }

  @Post(':membershipId/activation-challenge')
  @Header('Cache-Control', 'no-store')
  activationChallenge(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.createActivationChallenge(
      request.auth,
      tenantId,
      membershipId,
      request.requestId,
      this.sourceAddress(request),
    );
  }

  private sourceAddress(request: Request): string {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
