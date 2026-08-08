import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash, needsRehash, verify } from 'argon2';
import type { HashOptions } from 'argon2';
import type { Environment } from '../config/environment.js';

@Injectable()
export class Argon2Service {
  private readonly options: HashOptions & { raw?: false };
  private readonly saltLength: number;

  constructor(config: ConfigService<Environment, true>) {
    this.saltLength = config.getOrThrow('ARGON2_SALT_LENGTH');
    this.options = {
      type: argon2id,
      memoryCost: config.getOrThrow('ARGON2_MEMORY_COST'),
      timeCost: config.getOrThrow('ARGON2_TIME_COST'),
      parallelism: config.getOrThrow('ARGON2_PARALLELISM'),
      hashLength: config.getOrThrow('ARGON2_HASH_LENGTH'),
    };
  }

  hashSecret(secret: string): Promise<string> {
    return hash(secret, { ...this.options, salt: randomBytes(this.saltLength) });
  }

  verifySecret(encodedHash: string, candidate: string): Promise<boolean> {
    return verify(encodedHash, candidate);
  }

  requiresRehash(encodedHash: string): boolean {
    return needsRehash(encodedHash, this.options);
  }
}

@Injectable()
export class PasswordHashService {
  constructor(private readonly argon2: Argon2Service) {}

  hashPassword(password: string): Promise<string> {
    return this.argon2.hashSecret(password);
  }

  verifyPassword(encodedHash: string, candidate: string): Promise<boolean> {
    return this.argon2.verifySecret(encodedHash, candidate);
  }

  requiresRehash(encodedHash: string): boolean {
    return this.argon2.requiresRehash(encodedHash);
  }
}
