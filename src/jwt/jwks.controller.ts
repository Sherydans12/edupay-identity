import type { Response } from 'express';
import { Controller, Get, Header, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Environment } from '../config/environment.js';
import { JwksService } from './jwks.service.js';

@ApiExcludeController()
@Controller({ path: '.well-known/jwks.json', version: VERSION_NEUTRAL })
export class JwksController {
  constructor(
    private readonly jwks: JwksService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Get()
  @Header('Content-Type', 'application/json; charset=utf-8')
  async getKeys(@Res({ passthrough: true }) response: Response): Promise<unknown> {
    const maxAge = this.config.getOrThrow('JWKS_CACHE_MAX_AGE_SECONDS');
    response.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    return this.jwks.getPublicJwks();
  }
}
