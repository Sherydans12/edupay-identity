import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment.js';
import {
  BROWSER_REFRESH_COOKIE_NAME,
  BrowserSessionPolicy,
  DEVELOPMENT_REFRESH_COOKIE_NAME,
} from './browser-session.policy.js';

function createPolicy(overrides: Partial<Environment> = {}): BrowserSessionPolicy {
  return new BrowserSessionPolicy(
    new ConfigService<Environment, true>({
      IDENTITY_TRUSTED_WEB_ORIGINS: ['https://academico.example.test'],
      IDENTITY_COOKIE_SECURE: true,
      IDENTITY_REFRESH_COOKIE_SAMESITE: 'lax',
      ...overrides,
    } as Environment),
  );
}

function createRequest(headers: Record<string, string> = {}): Request {
  return {
    header(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as Request;
}

describe('browser session policy', () => {
  it('requires an allowlisted Origin for browser login and cookie refresh', () => {
    const policy = createPolicy();

    expect(policy.assertLoginTransport(createRequest({ origin: 'https://academico.example.test' }))).toBe(
      'browser-cookie',
    );
    expect(
      policy.resolveRefreshTransport(
        createRequest({
          origin: 'https://academico.example.test',
          cookie: `${BROWSER_REFRESH_COOKIE_NAME}=rft_id.secret`,
        }),
      ),
    ).toEqual({ transport: 'browser-cookie', refreshToken: 'rft_id.secret' });
    expect(() =>
      policy.resolveRefreshTransport(
        createRequest({ cookie: `${BROWSER_REFRESH_COOKIE_NAME}=rft_id.secret` }),
      ),
    ).toThrow('browser origin');
    expect(() =>
      policy.resolveRefreshTransport(
        createRequest({
          origin: 'https://evil.example.test',
          cookie: `${BROWSER_REFRESH_COOKIE_NAME}=rft_id.secret`,
        }),
      ),
    ).toThrow('browser origin');
    expect(() =>
      policy.resolveRefreshTransport(
        createRequest({ origin: 'https://academico.example.test', 'sec-fetch-site': 'none' }),
      ),
    ).toThrow('browser origin');
  });

  it('keeps requests without browser origin/cookies on the non-browser token transport', () => {
    const policy = createPolicy();

    expect(policy.assertLoginTransport(createRequest())).toBe('non-browser-token');
    expect(policy.resolveRefreshTransport(createRequest())).toEqual({ transport: 'non-browser-token' });
  });

  it('writes and clears a secure host-only cookie without exposing a domain', () => {
    const policy = createPolicy();
    const response = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as Response;
    const expiresAt = new Date(Date.now() + 60_000);

    policy.setRefreshCookie(response, 'rft_id.secret', expiresAt);
    expect(response.cookie).toHaveBeenCalledWith(
      BROWSER_REFRESH_COOKIE_NAME,
      'rft_id.secret',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      }),
    );
    expect(response.cookie).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ domain: expect.anything() }),
    );

    policy.clearRefreshCookie(response);
    expect(response.clearCookie).toHaveBeenCalledWith(
      BROWSER_REFRESH_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('uses a non-prefixed development cookie only when Secure is explicitly disabled', () => {
    expect(createPolicy({ IDENTITY_COOKIE_SECURE: false }).cookieName()).toBe(DEVELOPMENT_REFRESH_COOKIE_NAME);
  });
});
