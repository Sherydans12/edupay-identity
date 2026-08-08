import type { Request } from 'express';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentContextDto, LoginDto, RefreshDto } from './auth.dto.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { LogoutTokenGuard } from './logout-token.guard.js';

@ApiTags('authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() input: LoginDto, @Req() request: Request): Promise<unknown> {
    return this.auth.login(input, request.requestId, this.sourceAddress(request));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() input: RefreshDto, @Req() request: Request): Promise<unknown> {
    return this.auth.refresh(input.refreshToken, request.requestId, this.sourceAddress(request));
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(LogoutTokenGuard)
  @ApiBearerAuth()
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.auth.logout(request.auth, request.requestId);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  async logoutAll(@Req() request: AuthenticatedRequest): Promise<{ revokedSessions: number }> {
    return { revokedSessions: await this.auth.logoutAll(request.auth, request.requestId) };
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

  private sourceAddress(request: Request): string {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
