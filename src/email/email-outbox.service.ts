import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client.js';
import { OutboxStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { Environment } from '../config/environment.js';
import { EmailDeliveryAdapter, EmailDeliveryError } from './email.types.js';
import type { EmailMessage } from './email.types.js';

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EmailIntent {
  deliveryKey: string;
  eventType: string;
  aggregateId: string;
  message: EmailMessage;
}

class EmailPayloadProtector {
  private readonly key: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    const configured = config.get('IDENTITY_OUTBOX_ENCRYPTION_KEY');
    if (configured) {
      const decoded = Buffer.from(configured, 'base64');
      if (decoded.length !== 32) throw new Error('IDENTITY_OUTBOX_ENCRYPTION_KEY must decode to 32 bytes');
      this.key = decoded;
      return;
    }

    if (config.getOrThrow('NODE_ENV') === 'production') {
      throw new Error('IDENTITY_OUTBOX_ENCRYPTION_KEY is required in production');
    }
    this.key = createHash('sha256').update('edupay-identity-development-outbox-key').digest();
  }

  encrypt(message: EmailMessage): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
    return {
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  }

  decrypt(value: unknown): EmailMessage {
    if (!value || typeof value !== 'object') throw new Error('invalid email payload');
    const payload = value as Partial<EncryptedPayload>;
    if (
      payload.version !== 1 ||
      typeof payload.iv !== 'string' ||
      typeof payload.tag !== 'string' ||
      typeof payload.ciphertext !== 'string'
    ) {
      throw new Error('invalid email payload');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(payload.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const message = JSON.parse(plaintext) as Partial<EmailMessage>;
    if (
      typeof message.to !== 'string' ||
      typeof message.from !== 'string' ||
      typeof message.subject !== 'string' ||
      typeof message.text !== 'string' ||
      typeof message.html !== 'string'
    ) {
      throw new Error('invalid email message');
    }
    return message as EmailMessage;
  }
}

@Injectable()
export class EmailOutboxService {
  private readonly protector: EmailPayloadProtector;
  private readonly maxAttempts: number;
  private readonly baseBackoffSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: EmailDeliveryAdapter,
    config: ConfigService<Environment, true>,
  ) {
    this.protector = new EmailPayloadProtector(config);
    this.maxAttempts = config.getOrThrow('OUTBOX_MAX_ATTEMPTS');
    this.baseBackoffSeconds = config.getOrThrow('OUTBOX_BASE_BACKOFF_SECONDS');
  }

  createIntent(
    client: Prisma.TransactionClient,
    intent: EmailIntent,
  ): Promise<unknown> {
    return client.outboxEvent.create({
      data: {
        eventType: intent.eventType,
        aggregateType: 'IdentityEmail',
        aggregateId: intent.aggregateId,
        deliveryKey: intent.deliveryKey,
        maxAttempts: this.maxAttempts,
        payload: {
          version: 1,
          encryptedMessage: this.protector.encrypt(intent.message),
        } as unknown as Prisma.InputJsonObject,
      },
    });
  }

  async deliverPending(limit = 20): Promise<{ published: number; failed: number }> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: { startsWith: 'identity.email.' },
        status: OutboxStatus.PENDING,
        availableAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    let published = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const payload = event.payload as { encryptedMessage?: unknown };
        const message = this.protector.decrypt(payload.encryptedMessage);
        const result = await this.adapter.send(message, event.deliveryKey ?? event.id);
        await this.prisma.outboxEvent.updateMany({
          where: { id: event.id, status: OutboxStatus.PENDING },
          data: {
            status: OutboxStatus.PUBLISHED,
            publishedAt: new Date(),
            providerResponseId: result.providerResponseId,
            lastError: null,
          },
        });
        published += 1;
      } catch (error) {
        const attemptCount = event.attemptCount + 1;
        const retryable = !(error instanceof EmailDeliveryError) || error.retryable;
        const terminal = !retryable || attemptCount >= event.maxAttempts;
        const delaySeconds = this.baseBackoffSeconds * 2 ** Math.min(attemptCount - 1, 8);
        const safeError = error instanceof EmailDeliveryError ? error.safeCode : 'EMAIL_DELIVERY_FAILED';
        await this.prisma.outboxEvent.updateMany({
          where: { id: event.id, status: OutboxStatus.PENDING },
          data: {
            attemptCount,
            lastError: safeError,
            ...(terminal
              ? { status: OutboxStatus.FAILED }
              : { availableAt: new Date(Date.now() + delaySeconds * 1_000) }),
          },
        });
        failed += 1;
      }
    }

    return { published, failed };
  }
}
