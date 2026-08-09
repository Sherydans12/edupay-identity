import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { EmailDeliveryAdapter, EmailDeliveryError } from './email.types.js';
import type { EmailDeliveryResult, EmailMessage } from './email.types.js';

@Injectable()
export class ResendEmailAdapter extends EmailDeliveryAdapter {
  constructor(private readonly config: ConfigService<Environment, true>) {
    super();
  }

  async send(message: EmailMessage, deliveryKey: string): Promise<EmailDeliveryResult> {
    const apiKey = this.config.getOrThrow('RESEND_API_KEY');
    if (!apiKey) throw new EmailDeliveryError('RESEND_NOT_CONFIGURED', false);

    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': deliveryKey,
        },
        body: JSON.stringify(message),
      });
    } catch {
      throw new EmailDeliveryError('RESEND_NETWORK_ERROR');
    }

    if (!response.ok) {
      throw new EmailDeliveryError(
        response.status >= 400 && response.status < 500 && response.status !== 429
          ? 'RESEND_PROVIDER_REJECTED'
          : 'RESEND_PROVIDER_UNAVAILABLE',
        response.status >= 500 || response.status === 429,
      );
    }

    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== 'string' || body.id.length === 0 || body.id.length > 256) {
        throw new Error('missing provider id');
      }
      return { providerResponseId: body.id };
    } catch {
      throw new EmailDeliveryError('RESEND_INVALID_RESPONSE');
    }
  }
}
