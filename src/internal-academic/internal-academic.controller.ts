import type { Request } from 'express';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ResolveIdentityUserDto } from './internal-academic.dto.js';
import {
  InternalAcademicService,
  type InternalSessionStatus,
  type ResolvedIdentityUser,
} from './internal-academic.service.js';
import { InternalServiceAuthGuard } from './internal-service-auth.guard.js';

@ApiExcludeController()
@Controller({ path: 'internal/v1', version: VERSION_NEUTRAL })
@UseGuards(InternalServiceAuthGuard)
export class InternalAcademicController {
  constructor(private readonly integration: InternalAcademicService) {}

  @Get('sessions/:sessionId/status')
  @Header('Cache-Control', 'no-store')
  sessionStatus(
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @Req() request: Request,
  ): Promise<InternalSessionStatus> {
    return this.integration.sessionStatus(
      sessionId,
      request.requestId,
      this.sourceAddress(request),
    );
  }

  @Post('identity-users/resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resolveIdentityUser(
    @Body() input: ResolveIdentityUserDto,
    @Req() request: Request,
  ): Promise<ResolvedIdentityUser> {
    return this.integration.resolveIdentityUser(
      input,
      request.requestId,
      this.sourceAddress(request),
    );
  }

  private sourceAddress(request: Request): string {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
