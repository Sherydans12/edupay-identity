import { Module } from '@nestjs/common';
import { JwksController } from './jwks.controller.js';
import { JwksService } from './jwks.service.js';
import { JwtSigningService } from './jwt-signing.service.js';
import { JwtVerificationService } from './jwt-verification.service.js';

@Module({
  controllers: [JwksController],
  providers: [JwksService, JwtSigningService, JwtVerificationService],
  exports: [JwksService, JwtSigningService, JwtVerificationService],
})
export class JwtModule {}
