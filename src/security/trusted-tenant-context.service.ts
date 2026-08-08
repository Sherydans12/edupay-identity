import { Injectable, NotFoundException } from '@nestjs/common';

export interface TrustedTenantContext {
  userId: string;
  membershipId: string;
  tenantId: string;
  roles: ReadonlyArray<string>;
}

@Injectable()
export class TrustedTenantContextService {
  assertTarget(context: TrustedTenantContext | null, targetTenantId: string): TrustedTenantContext {
    if (!context || context.tenantId !== targetTenantId) {
      throw new NotFoundException();
    }

    return context;
  }
}
