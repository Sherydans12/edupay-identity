import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment.js';
import { ResendEmailAdapter } from './resend.email.adapter.js';
import type { EmailMessage } from './email.types.js';

function config(): ConfigService<Environment, true> {
  return {
    getOrThrow(key: string) {
      if (key === 'RESEND_API_KEY') return 'synthetic-resend-key';
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService<Environment, true>;
}

const message: EmailMessage = {
  to: 'synthetic@example.invalid',
  from: 'EduPay <no-reply@edupay.baselogic.cl>',
  subject: 'Synthetic recovery',
  text: 'Synthetic recovery body',
  html: '<p>Synthetic recovery body</p>',
};

describe('ResendEmailAdapter diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retains only an allowlisted provider code and scrubbed message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        name: 'invalid_api_key',
        message: 'API key is invalid for user@example.com; see https://provider.invalid/details?token=secret',
      }), { status: 400, headers: { 'content-type': 'application/json' } }),
    );

    const error = await new ResendEmailAdapter(config())
      .send(message, 'password-reset:synthetic')
      .catch((value) => value as Error);

    expect(error).toMatchObject({
      safeCode: 'RESEND_PROVIDER_REJECTED',
      retryable: false,
      providerDiagnostic: { code: 'invalid_api_key' },
    });
    expect(error).toHaveProperty('providerDiagnostic.message', expect.stringContaining('API key is invalid'));
    expect(error).toHaveProperty('providerDiagnostic.message', expect.not.stringContaining('user@example.com'));
    expect(error).toHaveProperty('providerDiagnostic.message', expect.not.stringContaining('https://'));
    expect(error).toHaveProperty('providerDiagnostic.message', expect.not.stringContaining('token=secret'));
  });
});
