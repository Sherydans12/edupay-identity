import { inspect } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { Argon2Service } from './argon2.service.js';

export type OpaqueTokenPrefix = 'rft' | 'inv' | 'act' | 'rst';

export class IssuedOpaqueToken {
  readonly id: string;
  readonly tokenHash: string;
  #plaintext: string | undefined;

  constructor(id: string, plaintext: string, tokenHash: string) {
    this.id = id;
    this.#plaintext = plaintext;
    this.tokenHash = tokenHash;
  }

  revealOnce(): string {
    if (!this.#plaintext) throw new Error('Opaque token plaintext is no longer available');
    const plaintext = this.#plaintext;
    this.#plaintext = undefined;
    return plaintext;
  }

  toJSON(): { id: string; plaintext: '[REDACTED]'; tokenHash: '[REDACTED]' } {
    return { id: this.id, plaintext: '[REDACTED]', tokenHash: '[REDACTED]' };
  }

  [inspect.custom](): string {
    return `IssuedOpaqueToken(${this.id}, [REDACTED])`;
  }
}

export interface ParsedOpaqueToken {
  id: string;
  secret: string;
}

@Injectable()
export class OpaqueTokenService {
  private readonly tokenBytes: number;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly argon2: Argon2Service,
  ) {
    this.tokenBytes = config.getOrThrow('OPAQUE_TOKEN_BYTES');
  }

  async issue(prefix: OpaqueTokenPrefix): Promise<IssuedOpaqueToken> {
    const id = randomUUID();
    const secret = randomBytes(this.tokenBytes).toString('base64url');
    const plaintext = `${prefix}_${id}.${secret}`;
    const tokenHash = await this.argon2.hashSecret(secret);

    return new IssuedOpaqueToken(id, plaintext, tokenHash);
  }

  parse(token: string, expectedPrefix: OpaqueTokenPrefix): ParsedOpaqueToken | null {
    const separator = token.indexOf('.');
    if (separator < 1) return null;

    const idPart = token.slice(0, separator);
    const secret = token.slice(separator + 1);
    const expectedStart = `${expectedPrefix}_`;
    const id = idPart.startsWith(expectedStart) ? idPart.slice(expectedStart.length) : '';

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return null;
    }
    if (secret.length < 43) return null;
    return { id, secret };
  }

  verify(tokenHash: string, parsed: ParsedOpaqueToken): Promise<boolean> {
    return this.argon2.verifySecret(tokenHash, parsed.secret);
  }
}
