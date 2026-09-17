import { createCipheriv, createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment.js';
import { EmailDeliveryError } from './email.types.js';
import type { EmailDeliveryAdapter, EmailMessage } from './email.types.js';
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

function encryptedMessage(message: EmailMessage) {
  const key = createHash('sha256').update('edupay-identity-development-outbox-key').digest();
  const iv = Buffer.alloc(12, 0);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

function pendingEvent() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    attemptCount: 0,
    maxAttempts: 5,
    deliveryKey: 'password-reset:00000000-0000-4000-8000-000000000002',
    payload: {
      encryptedMessage: encryptedMessage({
        to: 'synthetic@example.invalid',
        from: 'EduPay <no-reply@edupay.baselogic.cl>',
        subject: 'Synthetic recovery',
        text: 'Synthetic recovery body',
        html: '<p>Synthetic recovery body</p>',
      }),
    },
  };
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

  it('does not concurrently drain one outbox batch twice', async () => {
    const findMany = vi.fn().mockResolvedValue([pendingEvent()]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const send = vi.fn().mockResolvedValue({ providerResponseId: 'synthetic-provider-id' });
    const prisma = { outboxEvent: { findMany, updateMany } };
    const service = new EmailOutboxService(prisma as never, { send } as EmailDeliveryAdapter, config());

    await Promise.all([service.deliverPending(), service.deliverPending()]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('marks a permanent provider rejection and does not retry it', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([pendingEvent()]).mockResolvedValueOnce([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const send = vi.fn().mockRejectedValue(
      new EmailDeliveryError('RESEND_PROVIDER_REJECTED', false, {
        code: 'invalid_api_key',
        message: 'API key is invalid',
      }),
    );
    const prisma = { outboxEvent: { findMany, updateMany } };
    const service = new EmailOutboxService(prisma as never, { send } as EmailDeliveryAdapter, config());

    await service.deliverPending();
    await service.deliverPending();

    expect(send).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        lastError: 'RESEND_PROVIDER_REJECTED[invalid_api_key: API key is invalid]',
      }),
    }));
  });
});
