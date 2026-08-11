import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import type { EmailMessage } from './email.types.js';

export function createInvitationEmail(
  config: ConfigService<Environment, true>,
  to: string,
  token: string,
): EmailMessage {
  const link = `${config.getOrThrow('IDENTITY_PUBLIC_BASE_URL').replace(/\/$/, '')}/activate?token=${encodeURIComponent(token)}`;
  return {
    to,
    from: config.getOrThrow('IDENTITY_EMAIL_FROM'),
    subject: 'Activate your EduPay Identity account',
    text: `Use this link to activate your EduPay Identity account: ${link}\nThis link expires soon and can be used once.`,
    html: `<p>Activate your EduPay Identity account:</p><p><a href="${link}">Continue activation</a></p><p>This link expires soon and can be used once.</p>`,
  };
}

export function createPasswordRecoveryEmail(
  config: ConfigService<Environment, true>,
  to: string,
  token: string,
): EmailMessage {
  const link = `${config.getOrThrow('IDENTITY_PUBLIC_BASE_URL').replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    from: config.getOrThrow('IDENTITY_EMAIL_FROM'),
    subject: 'Reset your EduPay Identity password',
    text: `Use this link to reset your EduPay Identity password: ${link}\nThis link expires soon and can be used once.`,
    html: `<p>Reset your EduPay Identity password:</p><p><a href="${link}">Continue password reset</a></p><p>This link expires soon and can be used once.</p>`,
  };
}
