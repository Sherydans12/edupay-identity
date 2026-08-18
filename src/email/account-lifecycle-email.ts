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

export function getAccountUiBaseUrl(config: ConfigService<Environment, true>): string {
  const configured = config.get('IDENTITY_ACCOUNT_UI_BASE_URL');
  if (configured && configured.trim().length > 0) {
    return configured.trim().replace(/\/$/, '');
  }
  return config.getOrThrow('IDENTITY_PUBLIC_BASE_URL').trim().replace(/\/$/, '');
}

interface EmailLayoutOptions {
  brandName?: string | undefined;
  title: string;
  lead: string;
  detailsHtml?: string | undefined;
  actionText: string;
  actionUrl: string;
  supportingText: string;
  securityNotice: string;
  footerText: string;
}

interface PlainTextOptions {
  brandName?: string | undefined;
  title: string;
  lead: string;
  detailText?: string | undefined;
  actionText: string;
  actionUrl: string;
  supportingText: string;
  securityNotice: string;
  footerText: string;
}

function renderEmailLayout(options: EmailLayoutOptions): string {
  const brand = escapeHtml(options.brandName ?? 'EduPay Académico');
  const title = escapeHtml(options.title);
  const lead = escapeHtml(options.lead);
  const actionText = escapeHtml(options.actionText);
  const actionUrl = encodeURI(options.actionUrl);
  const rawUrlEscaped = escapeHtml(options.actionUrl);
  const supportingText = escapeHtml(options.supportingText);
  const securityNotice = escapeHtml(options.securityNotice);
  const footerText = escapeHtml(options.footerText);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-text-size-adjust: 100%; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f1f5f9; width: 100% !important; margin: 0; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; width: 100%; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; background-color: #0f172a; border-bottom: 2px solid #3b82f6;">
              <span style="font-size: 18px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em; display: inline-block;">${brand}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.3;">${title}</h1>
              <p style="margin: 0 0 20px 0; font-size: 15px; color: #334155; line-height: 1.6;">${lead}</p>
              
              ${options.detailsHtml ? `<div style="margin: 0 0 24px 0; padding: 14px 18px; background-color: #f8fafc; border-radius: 8px; border-left: 4px solid #3b82f6; font-size: 14px; color: #334155;">${options.detailsHtml}</div>` : ''}

              <!-- Button CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #2563eb;">
                    <a href="${actionUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px; background-color: #2563eb; letter-spacing: -0.01em;">${actionText}</a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 12px 0; font-size: 14px; color: #475569; line-height: 1.5;">${supportingText}</p>
              <p style="margin: 0 0 24px 0; font-size: 13px; color: #64748b; line-height: 1.5;"><strong>Aviso de seguridad:</strong> ${securityNotice}</p>

              <!-- Raw fallback URL -->
              <div style="padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; word-break: break-all;">
                <p style="margin: 0 0 6px 0;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                <a href="${actionUrl}" style="color: #2563eb; text-decoration: underline;">${rawUrlEscaped}</a>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b;">${footerText}</p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">Mensaje automático enviado por EduPay Académico.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderPlainText(options: PlainTextOptions): string {
  const brand = options.brandName ?? 'EduPay Académico';
  return [
    brand,
    '='.repeat(brand.length),
    '',
    options.title,
    '',
    options.lead,
    ...(options.detailText ? ['', options.detailText] : []),
    '',
    `${options.actionText}:`,
    options.actionUrl,
    '',
    options.supportingText,
    '',
    `Aviso de seguridad: ${options.securityNotice}`,
    '',
    '---',
    options.footerText,
    'Mensaje automático enviado por EduPay Académico.',
  ].join('\n');
}

export function createInvitationEmail(
  config: ConfigService<Environment, true>,
  to: string,
  token: string,
  institutionalUsername?: string,
): EmailMessage {
  const accountUiBase = getAccountUiBaseUrl(config);
  const link = `${accountUiBase}/activate?token=${encodeURIComponent(token)}`;
  const usernameEscaped = institutionalUsername ? escapeHtml(institutionalUsername) : null;
  const usernameDetailHtml = usernameEscaped ? `Usuario institucional: <strong>${usernameEscaped}</strong>` : undefined;
  const usernameDetailText = institutionalUsername ? `Usuario institucional: ${institutionalUsername}` : undefined;

  const subject = 'Activa tu acceso a EduPay Académico';
  const title = 'Tu acceso está listo';
  const lead = 'Se creó un acceso para que puedas ingresar a la plataforma académica.';
  const actionText = 'Activar mi cuenta';
  const supportingText = 'Al abrir el enlace podrás crear tu contraseña personal. El administrador nunca conocerá tu contraseña.';
  const securityNotice = 'Este enlace es personal, vence en un plazo determinado y puede utilizarse una sola vez.';
  const footerText = 'Si no esperabas esta invitación, puedes ignorar este correo de forma segura.';

  return {
    to,
    from: config.getOrThrow('IDENTITY_EMAIL_FROM'),
    subject,
    text: renderPlainText({
      title,
      lead,
      detailText: usernameDetailText,
      actionText,
      actionUrl: link,
      supportingText,
      securityNotice,
      footerText,
    }),
    html: renderEmailLayout({
      title,
      lead,
      detailsHtml: usernameDetailHtml,
      actionText,
      actionUrl: link,
      supportingText,
      securityNotice,
      footerText,
    }),
  };
}

export function createPasswordRecoveryEmail(
  config: ConfigService<Environment, true>,
  to: string,
  token: string,
): EmailMessage {
  const accountUiBase = getAccountUiBaseUrl(config);
  const link = `${accountUiBase}/reset-password?token=${encodeURIComponent(token)}`;

  const subject = 'Recupera tu contraseña de EduPay Académico';
  const title = 'Crea una nueva contraseña';
  const lead = 'Recibimos una solicitud para recuperar el acceso a tu cuenta.';
  const actionText = 'Crear nueva contraseña';
  const supportingText = 'Al ingresar podrás definir una nueva contraseña personal. Por seguridad, tus sesiones anteriores podrían ser revocadas.';
  const securityNotice = 'Este enlace es personal, de uso único y expirará por motivos de seguridad.';
  const footerText = 'Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña actual permanecerá segura.';

  return {
    to,
    from: config.getOrThrow('IDENTITY_EMAIL_FROM'),
    subject,
    text: renderPlainText({
      title,
      lead,
      actionText,
      actionUrl: link,
      supportingText,
      securityNotice,
      footerText,
    }),
    html: renderEmailLayout({
      title,
      lead,
      actionText,
      actionUrl: link,
      supportingText,
      securityNotice,
      footerText,
    }),
  };
}
