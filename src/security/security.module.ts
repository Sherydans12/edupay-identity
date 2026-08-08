import { Global, Module } from '@nestjs/common';
import { Argon2Service, PasswordHashService } from './argon2.service.js';
import { AuditService } from './audit.service.js';
import { OpaqueTokenService } from './opaque-token.service.js';
import { FailClosedRateLimitPolicy, RateLimitPolicy } from './rate-limit.policy.js';
import { TrustedTenantContextService } from './trusted-tenant-context.service.js';

@Global()
@Module({
  providers: [
    Argon2Service,
    PasswordHashService,
    OpaqueTokenService,
    AuditService,
    TrustedTenantContextService,
    { provide: RateLimitPolicy, useClass: FailClosedRateLimitPolicy },
  ],
  exports: [
    PasswordHashService,
    OpaqueTokenService,
    AuditService,
    TrustedTenantContextService,
    RateLimitPolicy,
  ],
})
export class SecurityModule {}
