import { Global, Module } from '@nestjs/common';
import { Argon2Service, PasswordHashService } from './argon2.service.js';
import { AuditService } from './audit.service.js';
import { OpaqueTokenService } from './opaque-token.service.js';
import { ConfiguredRateLimitPolicy, RateLimitPolicy } from './rate-limit.policy.js';
import { TrustedTenantContextService } from './trusted-tenant-context.service.js';
import { BrowserSessionPolicy } from './browser-session.policy.js';

@Global()
@Module({
  providers: [
    Argon2Service,
    PasswordHashService,
    OpaqueTokenService,
    AuditService,
    TrustedTenantContextService,
    BrowserSessionPolicy,
    { provide: RateLimitPolicy, useClass: ConfiguredRateLimitPolicy },
  ],
  exports: [
    PasswordHashService,
    OpaqueTokenService,
    AuditService,
    TrustedTenantContextService,
    RateLimitPolicy,
    BrowserSessionPolicy,
  ],
})
export class SecurityModule {}
