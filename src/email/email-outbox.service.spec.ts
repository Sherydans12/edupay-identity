import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment.js';
import type { EmailDeliveryAdapter } from './email.types.js';
import { EmailOutboxService } from './email-outbox.service.js';

function config(): ConfigService<Environment, true> {
  return {
    get(key: string) {
      if (key === 'IDENTITY_OUTBOX_ENCRYPTION_KEY') return undefined;
      return undefined;
    },
    getOrThrow(key: string) {
      const values: Record<string, unknown> = {
        NODE_ENV: 'test',
        OUTBOX_MAX_ATTEMPTS: 5,
        OUTBOX_BASE_BACKOFF_SECONDS: 30,
      };
      return values[key];
    },
  } as unknown as ConfigService<Environment, true>;
}

describe('EmailOutboxService delivery lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains at startup and keeps retrying pending intents on a bounded timer', async () => {
    vi.useFakeTimers();
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { outboxEvent: { findMany } };
    const adapter = {} as EmailDeliveryAdapter;
    const service = new EmailOutboxService(prisma as never, adapter, config());

    await service.onApplicationBootstrap();
    expect(findMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(findMany).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
