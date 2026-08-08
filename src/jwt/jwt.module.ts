import { Module } from '@nestjs/common';
import { JwksController } from './jwks.controller.js';
import { JwksService } from './jwks.service.js';
import { JwtSigningService } from './jwt-signing.service.js';

@Module({
  controllers: [JwksController],
  providers: [JwksService, JwtSigningService],
  exports: [JwksService, JwtSigningService],
})
export class JwtModule {}
