import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../config/environment.js';
import { InternalServiceAuthenticator } from './internal-service-auth.guard.js';

describe('Academic internal service authentication', () => {
  const current = 'A'.repeat(43);
  const previous = 'B'.repeat(43);

  it('accepts the current token and the time-bounded previous rotation token', () => {
    const authenticator = new InternalServiceAuthenticator(
      new ConfigService<Environment, true>({
        IDENTITY_ACADEMICO_SERVICE_TOKEN: current,
        IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS: previous,
        IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT: new Date(
          Date.now() + 60_000,
        ).toISOString(),
      } as Environment),
    );

    expect(authenticator.authenticate(current)).toBe(true);
    expect(authenticator.authenticate(previous)).toBe(true);
    expect(authenticator.authenticate('wrong')).toBe(false);
  });

  it('stops accepting the previous token after the configured overlap', () => {
    const authenticator = new InternalServiceAuthenticator(
      new ConfigService<Environment, true>({
        IDENTITY_ACADEMICO_SERVICE_TOKEN: current,
        IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS: previous,
        IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT: new Date(
          Date.now() - 1_000,
        ).toISOString(),
      } as Environment),
    );

    expect(authenticator.authenticate(current)).toBe(true);
    expect(authenticator.authenticate(previous)).toBe(false);
  });
});
