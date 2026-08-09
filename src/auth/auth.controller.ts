import type { Request, Response } from 'express';
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthService } from './auth.service.js';
import {
  ActivationChallengeCompleteDto,
  CurrentContextDto,
  InvitationAcceptDto,
  LoginDto,
  PasswordRecoveryConfirmDto,
  PasswordRecoveryRequestDto,
  RefreshDto,
} from './auth.dto.js';
import { AccountLifecycleService } from './account-lifecycle.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { LogoutTokenGuard } from './logout-token.guard.js';
import { BrowserSessionPolicy } from '../security/browser-session.policy.js';
import type { IssuedTokenResponse, TokenResponse } from './auth.types.js';

type BrowserTokenResponse = Omit<TokenResponse, 'refreshToken'>;

@ApiTags('authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly browserSessions: BrowserSessionPolicy,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponse | BrowserTokenResponse> {
    const transport = this.browserSessions.assertLoginTransport(request);
    const issued = await this.auth.login(input, request.requestId, this.sourceAddress(request));
    return this.writeTokenResponse(transport, issued, response);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() input: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponse | BrowserTokenResponse> {
    const resolved = this.browserSessions.resolveRefreshTransport(request);
    try {
      const issued = await this.auth.refresh(
        resolved.transport === 'browser-cookie' ? resolved.refreshToken : input.refreshToken,
        request.requestId,
        this.sourceAddress(request),
      );
      return this.writeTokenResponse(resolved.transport, issued, response);
    } catch (error) {
      if (resolved.transport === 'browser-cookie') this.browserSessions.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(LogoutTokenGuard)
  @ApiBearerAuth()
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const transport = this.browserSessions.assertSensitiveTransport(request);
    await this.auth.logout(request.auth, request.requestId);
    if (transport === 'browser-cookie') this.browserSessions.clearRefreshCookie(response);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revokedSessions: number }> {
    const transport = this.browserSessions.assertSensitiveTransport(request);
    const revokedSessions = await this.auth.logoutAll(request.auth, request.requestId);
    if (transport === 'browser-cookie') this.browserSessions.clearRefreshCookie(response);
    return { revokedSessions };
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  me(@Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> {
    return this.auth.me(request.auth);
  }

  @Get('memberships')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  memberships(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.auth.memberships(request.auth);
  }

  @Post('sessions/current-context')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  switchContext(
    @Body() input: CurrentContextDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.auth.switchContext(request.auth, input.membershipId, request.requestId);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvitation(
    @Body() input: InvitationAcceptDto,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.acceptInvitation(input, request.requestId);
  }

  @Post('activations/complete')
  @HttpCode(200)
  completeActivation(
    @Body() input: ActivationChallengeCompleteDto,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.completeActivation(input, request.requestId, this.sourceAddress(request));
  }

  @Post('password-recovery/request')
  @HttpCode(202)
  requestPasswordRecovery(
    @Body() input: PasswordRecoveryRequestDto,
    @Req() request: Request,
  ): Promise<{ accepted: true }> {
    return this.lifecycle.requestPasswordRecovery(input, request.requestId, this.sourceAddress(request));
  }

  @Post('password-recovery/confirm')
  @HttpCode(200)
  confirmPasswordRecovery(
    @Body() input: PasswordRecoveryConfirmDto,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.confirmPasswordRecovery(input, request.requestId, this.sourceAddress(request));
  }


  private sourceAddress(request: Request): string {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private writeTokenResponse(
    transport: 'browser-cookie' | 'non-browser-token',
    issued: IssuedTokenResponse,
    response: Response,
  ): TokenResponse | BrowserTokenResponse {
    response.setHeader('Cache-Control', 'no-store');
    const { accessToken, tokenType, expiresIn, sessionId, activeMembership } = issued.response;
    if (transport === 'browser-cookie') {
      this.browserSessions.setRefreshCookie(response, issued.response.refreshToken, issued.refreshExpiresAt);
      return { accessToken, tokenType, expiresIn, sessionId, activeMembership };
    }
    return { accessToken, refreshToken: issued.response.refreshToken, tokenType, expiresIn, sessionId, activeMembership };
  }
}
