import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentifierNormalizationService } from './identifier-normalization.service.js';
import { JwtModule } from '../jwt/jwt.module.js';
import { LogoutTokenGuard } from './logout-token.guard.js';
import { AccountLifecycleService } from './account-lifecycle.service.js';
import { MembershipController } from './membership.controller.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { EmailModule } from '../email/email.module.js';
import { TenantAdminBootstrapService } from '../bootstrap/tenant-admin-bootstrap.js';

@Module({
  imports: [JwtModule, EmailModule],
  controllers: [AuthController, MembershipController],
  providers: [
    AuthService,
    AccountLifecycleService,
    PasswordPolicyService,
    AccessTokenGuard,
    LogoutTokenGuard,
    IdentifierNormalizationService,
    TenantAdminBootstrapService,
  ],
  exports: [TenantAdminBootstrapService],
})
export class AuthModule {}
