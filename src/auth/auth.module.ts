import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentifierNormalizationService } from './identifier-normalization.service.js';
import { JwtModule } from '../jwt/jwt.module.js';
import { LogoutTokenGuard } from './logout-token.guard.js';

@Module({
  imports: [JwtModule],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, LogoutTokenGuard, IdentifierNormalizationService],
})
export class AuthModule {}
