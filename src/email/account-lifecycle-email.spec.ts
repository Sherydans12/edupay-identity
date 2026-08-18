import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  createInvitationEmail,
  createPasswordRecoveryEmail,
  escapeHtml,
  getAccountUiBaseUrl,
} from './account-lifecycle-email.js';
import type { Environment } from '../config/environment.js';

function mockConfig(overrides: Partial<Record<keyof Environment, unknown>> = {}): ConfigService<Environment, true> {
  const env: Record<string, unknown> = {
    IDENTITY_EMAIL_FROM: 'EduPay Identity <identity@edupay.baselogic.cl>',
    IDENTITY_PUBLIC_BASE_URL: 'https://identity.edupay.baselogic.cl',
    IDENTITY_ACCOUNT_UI_BASE_URL: 'https://academico.edupay.baselogic.cl',
    ...overrides,
  };
  return {
    get(key: string) {
      return env[key];
    },
    getOrThrow(key: string) {
      const val = env[key];
      if (val === undefined) throw new Error("Missing " + key);
      return val;
    },
  } as unknown as ConfigService<Environment, true>;
}

describe('account lifecycle emails', () => {
  describe('escapeHtml', () => {
    it('escapes dangerous HTML characters', () => {
      expect(escapeHtml('<script>alert("xss") & \'test\'</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;) &amp; &#39;test&#39;&lt;/script&gt;',
      );
    });
  });

  describe('getAccountUiBaseUrl', () => {
    it('prefers IDENTITY_ACCOUNT_UI_BASE_URL when present', () => {
      const config = mockConfig({
        IDENTITY_ACCOUNT_UI_BASE_URL: 'https://academico.edupay.baselogic.cl/',
        IDENTITY_PUBLIC_BASE_URL: 'https://identity.edupay.baselogic.cl',
      });
      expect(getAccountUiBaseUrl(config)).toBe('https://academico.edupay.baselogic.cl');
    });

    it('falls back to IDENTITY_PUBLIC_BASE_URL when IDENTITY_ACCOUNT_UI_BASE_URL is not set', () => {
      const config = mockConfig({
        IDENTITY_ACCOUNT_UI_BASE_URL: undefined,
        IDENTITY_PUBLIC_BASE_URL: 'https://identity.edupay.baselogic.cl/',
      });
      expect(getAccountUiBaseUrl(config)).toBe('https://identity.edupay.baselogic.cl');
    });
  });

  describe('createInvitationEmail', () => {
    it('creates a professional Spanish invitation email with the correct account UI link and escaped username', () => {
      const config = mockConfig();
      const email = createInvitationEmail(config, 'student@example.test', 'inv_token_123', '<script>user.name</script>');

      expect(email.to).toBe('student@example.test');
      expect(email.from).toBe('EduPay Identity <identity@edupay.baselogic.cl>');
      expect(email.subject).toBe('Activa tu acceso a EduPay Académico');

      // Link points to academic web account UI
      expect(email.html).toContain('https://academico.edupay.baselogic.cl/activate?token=inv_token_123');
      expect(email.text).toContain('https://academico.edupay.baselogic.cl/activate?token=inv_token_123');

      // Username is HTML escaped
      expect(email.html).toContain('&lt;script&gt;user.name&lt;/script&gt;');
      expect(email.html).not.toContain('<script>');

      // Key copy requirements
      expect(email.html).toContain('EduPay Académico');
      expect(email.html).toContain('Tu acceso está listo');
      expect(email.html).toContain('Activar mi cuenta');
      expect(email.html).toContain('El administrador nunca conocerá tu contraseña');
      expect(email.html).toContain('Si el botón no funciona, copia y pega este enlace en tu navegador');
      expect(email.text).toContain('Aviso de seguridad:');
    });
  });

  describe('createPasswordRecoveryEmail', () => {
    it('creates a professional Spanish password reset email with the correct account UI link', () => {
      const config = mockConfig();
      const email = createPasswordRecoveryEmail(config, 'user@example.test', 'rst_token_456');

      expect(email.to).toBe('user@example.test');
      expect(email.from).toBe('EduPay Identity <identity@edupay.baselogic.cl>');
      expect(email.subject).toBe('Recupera tu contraseña de EduPay Académico');

      // Link points to academic web account UI
      expect(email.html).toContain('https://academico.edupay.baselogic.cl/reset-password?token=rst_token_456');
      expect(email.text).toContain('https://academico.edupay.baselogic.cl/reset-password?token=rst_token_456');

      // Key copy requirements
      expect(email.html).toContain('Crea una nueva contraseña');
      expect(email.html).toContain('Crear nueva contraseña');
      expect(email.html).toContain('Si no solicitaste este cambio, puedes ignorar este correo');
      expect(email.html).toContain('Si el botón no funciona, copia y pega este enlace en tu navegador');
      expect(email.text).toContain('Aviso de seguridad:');
    });
  });
});
