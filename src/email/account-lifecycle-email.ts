import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import type { EmailMessage } from './email.types.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatPasswordResetExpiration(seconds: number): string {
  const units = [
    { size: 86_400, singular: 'día', plural: 'días' },
    { size: 3_600, singular: 'hora', plural: 'horas' },
    { size: 60, singular: 'minuto', plural: 'minutos' },
  ];

  for (const unit of units) {
    if (seconds % unit.size === 0) {
      const amount = seconds / unit.size;
      return `${amount} ${amount === 1 ? unit.singular : unit.plural}`;
    }
  }

  return `${seconds} segundos`;
}

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
  const accountUiBase = config.getOrThrow('IDENTITY_PUBLIC_BASE_URL').trim().replace(/\/$/, '');
  const link = `${accountUiBase}/reset-password?token=${encodeURIComponent(token)}`;
  const expiration = formatPasswordResetExpiration(config.getOrThrow('IDENTITY_PASSWORD_RESET_TTL_SECONDS'));
  const safeLink = escapeHtml(link);

  const subject = 'Recupera tu contraseña de EduPay';
  const title = 'Recupera tu contraseña';
  const lead = 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de EduPay.';
  const actionText = 'Restablecer contraseña';
  const supportingText = `Este enlace expirará en ${expiration} y sólo puede usarse una vez.`;
  const securityNotice = 'Si no solicitaste este correo, ignóralo. Tu contraseña no cambiará.';

  const text = [
    'EduPay',
    'Identidad y acceso',
    '',
    title,
    '',
    lead,
    '',
    `${actionText}:`,
    link,
    '',
    supportingText,
    '',
    securityNotice,
    '',
    'Si el botón no funciona, copia y pega el enlace anterior en tu navegador.',
    '',
    'Mensaje automático de EduPay. No respondas a este correo.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    @media screen and (max-width: 600px) {
      .email-shell { width: 100% !important; }
      .email-content { padding: 28px 20px !important; }
      .email-header, .email-footer { padding-left: 20px !important; padding-right: 20px !important; }
      .email-title { font-size: 24px !important; }
      .cta-cell, .cta-link { width: 100% !important; }
      .cta-link { box-sizing: border-box !important; display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#f5f6f4; color:#243b53; font-family:Arial, Helvetica, sans-serif; -webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background-color:#f5f6f4;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border:1px solid #d5dce1;">
          <tr>
            <td class="email-header" style="padding:24px 32px 20px; background-color:#334e68; border-bottom:4px solid #d5a021;">
              <p style="margin:0; color:#ffffff; font-size:20px; line-height:1.3; font-weight:bold;">EduPay</p>
              <p style="margin:4px 0 0; color:#ffffff; font-size:13px; line-height:1.4;">Identidad y acceso</p>
            </td>
          </tr>
          <tr>
            <td class="email-content" style="padding:36px 32px;">
              <h1 class="email-title" style="margin:0 0 18px; color:#243b53; font-size:26px; line-height:1.25; font-weight:bold;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 22px; color:#526777; font-size:16px; line-height:1.6;">${escapeHtml(lead)}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;">
                <tr>
                  <td class="cta-cell" style="background-color:#334e68;">
                    <a class="cta-link" href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:14px 24px; background-color:#334e68; color:#ffffff; font-size:16px; line-height:1.2; font-weight:bold; text-decoration:none;">${escapeHtml(actionText)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 22px; padding:16px; border-left:4px solid #d5a021; background-color:#f5f6f4; color:#243b53; font-size:15px; line-height:1.55;">${escapeHtml(supportingText)}</p>
              <p style="margin:0 0 24px; color:#526777; font-size:14px; line-height:1.55;">${escapeHtml(securityNotice)}</p>
              <div style="padding-top:20px; border-top:1px solid #d5dce1; color:#526777; font-size:13px; line-height:1.55; word-break:break-all;">
                <p style="margin:0 0 8px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                <a href="${safeLink}" style="color:#334e68; text-decoration:underline;">${safeLink}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td class="email-footer" style="padding:20px 32px; background-color:#eef1f3; border-top:1px solid #d5dce1; color:#526777; text-align:center; font-size:12px; line-height:1.5;">
              <p style="margin:0;">Mensaje automático de EduPay. No respondas a este correo.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    to,
    from: config.getOrThrow('IDENTITY_EMAIL_FROM'),
    subject,
    text,
    html,
  };
}
