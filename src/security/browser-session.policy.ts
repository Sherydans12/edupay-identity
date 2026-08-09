import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Environment } from '../config/environment.js';
import { SafeHttpException } from '../common/safe-http.exception.js';

export const BROWSER_REFRESH_COOKIE_NAME = '__Host-edupay-refresh';
export const DEVELOPMENT_REFRESH_COOKIE_NAME = 'edupay-refresh';

export type SessionTransport = 'browser-cookie' | 'non-browser-token';

export function normalizeWebOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

@Injectable()
export class BrowserSessionPolicy {
  private readonly trustedOrigins: ReadonlySet<string>;
  private readonly secureCookies: boolean;
  private readonly sameSite: 'lax' | 'strict' | 'none';

  constructor(private readonly config: ConfigService<Environment, true>) {
    this.trustedOrigins = new Set(config.getOrThrow('IDENTITY_TRUSTED_WEB_ORIGINS'));
    this.secureCookies = config.getOrThrow('IDENTITY_COOKIE_SECURE');
    this.sameSite = config.getOrThrow('IDENTITY_REFRESH_COOKIE_SAMESITE');
  }

  cookieName(): string {
    return this.secureCookies ? BROWSER_REFRESH_COOKIE_NAME : DEVELOPMENT_REFRESH_COOKIE_NAME;
  }

  isTrustedOrigin(origin: string | undefined): boolean {
    return origin !== undefined && this.trustedOrigins.has(normalizeWebOrigin(origin) ?? '');
  }

  assertLoginTransport(request: Request): SessionTransport {
    const origin = request.header('origin');
    if (origin !== undefined) {
      this.assertTrustedOrigin(origin);
      return 'browser-cookie';
    }
    return 'non-browser-token';
  }

  resolveRefreshTransport(request: Request): { transport: SessionTransport; refreshToken?: string } {
    const cookie = this.readRefreshCookie(request);
    const origin = request.header('origin');

    if (cookie !== undefined || origin !== undefined) {
      this.assertTrustedBrowserRequest(request);
      return cookie === undefined
        ? { transport: 'browser-cookie' }
        : { transport: 'browser-cookie', refreshToken: cookie };
    }

    return { transport: 'non-browser-token' };
  }

  assertSensitiveTransport(request: Request): SessionTransport {
    const origin = request.header('origin');
    const cookie = this.readRefreshCookie(request);
    if (origin !== undefined || cookie !== undefined) {
      this.assertTrustedBrowserRequest(request);
      return 'browser-cookie';
    }
    return 'non-browser-token';
  }

  setRefreshCookie(response: Response, refreshToken: string, expiresAt: Date): void {
    response.cookie(this.cookieName(), refreshToken, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: this.sameSite,
      path: '/',
      expires: expiresAt,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
    response.setHeader('Cache-Control', 'no-store');
  }

  clearRefreshCookie(response: Response): void {
    response.clearCookie(this.cookieName(), {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: this.sameSite,
      path: '/',
    });
    response.setHeader('Cache-Control', 'no-store');
  }

  private assertTrustedBrowserRequest(request: Request): void {
    const origin = request.header('origin');
    if (!origin || !this.isTrustedOrigin(origin)) {
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'ORIGIN_NOT_ALLOWED',
        'The browser origin is not trusted.',
      );
    }

    // Fetch Metadata is defense in depth. Trusted origins remain supported even when
    // the frontend is cross-site, so Origin remains the authoritative allowlist. A
    // top-level/navigation-style request is not a valid cookie session operation.
    const fetchSite = request.header('sec-fetch-site');
    if (fetchSite === 'none') {
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'ORIGIN_NOT_ALLOWED',
        'The browser origin is not trusted.',
      );
    }
  }

  private assertTrustedOrigin(origin: string): void {
    if (!this.isTrustedOrigin(origin)) {
      throw new SafeHttpException(
        HttpStatus.FORBIDDEN,
        'ORIGIN_NOT_ALLOWED',
        'The browser origin is not trusted.',
      );
    }
  }

  private readRefreshCookie(request: Request): string | undefined {
    const cookieHeader = request.header('cookie');
    if (!cookieHeader) return undefined;

    const matches = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${this.cookieName()}=`));
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      throw new SafeHttpException(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', 'The refresh token is invalid or expired.');
    }

    const value = matches[0]!.slice(this.cookieName().length + 1);
    if (!value || value.length > 2_048 || value.includes(';')) {
      throw new SafeHttpException(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', 'The refresh token is invalid or expired.');
    }
    return value;
  }
}
