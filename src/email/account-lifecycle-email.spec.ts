import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import {
  createPasswordRecoveryEmail,
  escapeHtml,
  formatPasswordResetExpiration,
} from './account-lifecycle-email.js';

function mockConfig(overrides: Partial<Record<keyof Environment, unknown>> = {}): ConfigService<Environment, true> {
  const env: Record<string, unknown> = {
    IDENTITY_EMAIL_FROM: 'EduPay Identity <identity@edupay.baselogic.cl>',
    IDENTITY_PUBLIC_BASE_URL: 'https://academico.edupay.baselogic.cl',
    IDENTITY_PASSWORD_RESET_TTL_SECONDS: 3_600,
    ...overrides,
  };

  return {
    get(key: string) {
      return env[key];
    },
    getOrThrow(key: string) {
      const value = env[key];
      if (value === undefined) throw new Error(`Missing ${key}`);
      return value;
    },
  } as unknown as ConfigService<Environment, true>;
}

describe('password recovery email', () => {
  it('formats the configured expiration without changing the token semantics', () => {
    expect(formatPasswordResetExpiration(3_600)).toBe('1 hora');
    expect(formatPasswordResetExpiration(7_200)).toBe('2 horas');
    expect(formatPasswordResetExpiration(90)).toBe('90 segundos');
  });

  it('escapes dynamic content for HTML output', () => {
    expect(escapeHtml('<script>alert("xss") & \'test\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;) &amp; &#39;test&#39;&lt;/script&gt;',
    );
  });

  it('renders a Spanish, responsive HTML email and a matching text alternative', () => {
    const email = createPasswordRecoveryEmail(mockConfig(), 'teacher@example.test', 'synthetic-reset-token');
    const link = 'https://academico.edupay.baselogic.cl/reset-password?token=synthetic-reset-token';

    expect(email.to).toBe('teacher@example.test');
    expect(email.from).toBe('EduPay Identity <identity@edupay.baselogic.cl>');
    expect(email.subject).toBe('Recupera tu contraseña de EduPay');

    expect(email.text).toContain('Recibimos una solicitud para restablecer la contraseña');
    expect(email.text).toContain(`Restablecer contraseña:\n${link}`);
    expect(email.text).toContain('Este enlace expirará en 1 hora y sólo puede usarse una vez.');
    expect(email.text).toContain('Si no solicitaste este correo, ignóralo. Tu contraseña no cambiará.');
    expect(email.text).not.toContain('<');

    expect(email.html).toContain('<html lang="es">');
    expect(email.html).toContain('<table role="presentation"');
    expect(email.html).toContain('href="https://academico.edupay.baselogic.cl/reset-password?token=synthetic-reset-token"');
    expect(email.html).toContain('Restablecer contraseña');
    expect(email.html).toContain('Este enlace expirará en 1 hora y sólo puede usarse una vez.');
    expect(email.html).toContain('Si no solicitaste este correo, ignóralo. Tu contraseña no cambiará.');
    expect(email.html).toContain('@media screen and (max-width: 600px)');
    expect(email.html).not.toContain('<script');
    expect(email.html).not.toContain('javascript:');
  });

  it('uses the configured public origin and rendered expiration', () => {
    const email = createPasswordRecoveryEmail(
      mockConfig({
        IDENTITY_PUBLIC_BASE_URL: 'https://accounts.example.test/',
        IDENTITY_PASSWORD_RESET_TTL_SECONDS: 86_400,
      }),
      'teacher@example.test',
      'synthetic-reset-token',
    );

    expect(email.text).toContain('https://accounts.example.test/reset-password?token=synthetic-reset-token');
    expect(email.html).toContain('Este enlace expirará en 1 día y sólo puede usarse una vez.');
    expect(email.html).not.toContain('academico.edupay.baselogic.cl/reset-password');
  });
});
