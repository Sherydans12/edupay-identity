import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { EmailDeliveryAdapter, EmailDeliveryError } from './email.types.js';
import type { SafeProviderDiagnostic } from './email.types.js';

const SAFE_PROVIDER_CODE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

function sanitizeProviderMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/https?:\/\/[^\s]+/gi, '<redacted-url>')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '<redacted-email>')
    .replace(/\b(?:bearer|token|secret|key)\s*[:=]\s*[^\s]+/gi, '<redacted-secret>')
    .replace(/\b(?:re|rst|tok|key)_[a-z0-9_-]+\b/gi, '<redacted-opaque>')
    .replace(/\b[0-9a-f]{32,}\b/gi, '<redacted-opaque>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<redacted-opaque>')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return sanitized || undefined;
}

function safeProviderDiagnostic(body: unknown): SafeProviderDiagnostic | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidate = body as { name?: unknown; message?: unknown };
  const code = typeof candidate.name === 'string' && SAFE_PROVIDER_CODE.test(candidate.name)
    ? candidate.name
    : undefined;
  const message = sanitizeProviderMessage(candidate.message);
  if (!code && !message) return undefined;
  const diagnostic: SafeProviderDiagnostic = {};
  if (code) diagnostic.code = code;
  if (message) diagnostic.message = message;
  return diagnostic;
}
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
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      throw new EmailDeliveryError(
        response.status >= 400 && response.status < 500 && response.status !== 429
          ? 'RESEND_PROVIDER_REJECTED'
          : 'RESEND_PROVIDER_UNAVAILABLE',
        response.status >= 500 || response.status === 429,
        safeProviderDiagnostic(body),
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
