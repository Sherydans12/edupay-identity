import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditOutcome } from '../generated/prisma/enums.js';
import { PrismaService } from '../persistence/prisma.service.js';

const SECRET_KEY = /(authorization|cookie|password|secret|token|activation.?code|private.?key)/i;

export interface AuditRecord {
  eventType: string;
  outcome: AuditOutcome;
  actorUserId?: string;
  tenantRealmId?: string;
  sessionId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

function assertSecretFree(value: unknown, path = 'metadata'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`));
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error(`Secret-like audit metadata key rejected at ${path}.${key}`);
      assertSecretFree(nested, `${path}.${key}`);
    }
  }
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(record: AuditRecord): Promise<void> {
    assertSecretFree(record.metadata);

    await this.prisma.authAuditEvent.create({
      data: {
        eventType: record.eventType,
        outcome: record.outcome,
        ...(record.actorUserId ? { actorUserId: record.actorUserId } : {}),
        ...(record.tenantRealmId ? { tenantRealmId: record.tenantRealmId } : {}),
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
        ...(record.requestId ? { requestId: record.requestId } : {}),
        ...(record.metadata ? { metadata: record.metadata as Prisma.InputJsonObject } : {}),
      },
    });
  }
}

export { assertSecretFree };
