import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

export interface RateLimitRequest {
  bucket: 'login' | 'refresh' | 'activation' | 'recovery' | 'management';
  keys: ReadonlyArray<string>;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason?: 'configured-policy-required' | 'limit-exceeded' | 'capacity-exceeded';
}

export abstract class RateLimitPolicy {
  abstract consume(request: RateLimitRequest): Promise<RateLimitDecision>;
}

/**
 * Authentication endpoints must not be enabled until a durable, topology-aware
 * rate-limit adapter replaces this fail-closed bootstrap provider.
 */
export class FailClosedRateLimitPolicy extends RateLimitPolicy {
  consume(request: RateLimitRequest): Promise<RateLimitDecision> {
    void request;
    return Promise.resolve({ allowed: false, reason: 'configured-policy-required' });
  }
}

interface RateLimitEntry {
  count: number;
  resetsAt: number;
}

/**
 * A bounded, configurable adapter for a single Identity process. The abstract
 * policy remains the seam for a shared production store; capacity or internal
 * failures deny authentication requests instead of bypassing throttling.
 */
@Injectable()
export class ConfiguredRateLimitPolicy extends RateLimitPolicy {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly windowMilliseconds: number;
  private readonly limits: Record<RateLimitRequest['bucket'], number>;
  private static readonly MAX_TRACKED_KEYS = 50_000;

  constructor(config: ConfigService<Environment, true>) {
    super();
    this.windowMilliseconds = config.getOrThrow('RATE_LIMIT_WINDOW_SECONDS') * 1_000;
    this.limits = {
      login: config.getOrThrow('RATE_LIMIT_LOGIN_MAX'),
      refresh: config.getOrThrow('RATE_LIMIT_REFRESH_MAX'),
      activation: config.getOrThrow('RATE_LIMIT_LOGIN_MAX'),
      recovery: config.getOrThrow('RATE_LIMIT_LOGIN_MAX'),
      management: config.getOrThrow('RATE_LIMIT_REFRESH_MAX'),
    };
  }

  consume(request: RateLimitRequest): Promise<RateLimitDecision> {
    try {
      const now = Date.now();
      this.prune(now);
      const keys = [...new Set(request.keys.filter((key) => key.length > 0))];
      if (keys.length === 0) return Promise.resolve({ allowed: false, reason: 'capacity-exceeded' });

      const bucketKeys = keys.map((key) => this.hashKey(request.bucket, key));
      for (const key of bucketKeys) {
        const entry = this.entries.get(key);
        if (entry && entry.resetsAt > now && entry.count >= this.limits[request.bucket]) {
          return Promise.resolve({ allowed: false, reason: 'limit-exceeded' });
        }
      }

      if (this.entries.size + bucketKeys.length > ConfiguredRateLimitPolicy.MAX_TRACKED_KEYS) {
        return Promise.resolve({ allowed: false, reason: 'capacity-exceeded' });
      }

      for (const key of bucketKeys) {
        const current = this.entries.get(key);
        if (!current || current.resetsAt <= now) {
          this.entries.set(key, { count: 1, resetsAt: now + this.windowMilliseconds });
        } else {
          current.count += 1;
        }
      }
      return Promise.resolve({ allowed: true });
    } catch {
      return Promise.resolve({ allowed: false, reason: 'capacity-exceeded' });
    }
  }

  private hashKey(bucket: string, key: string): string {
    return createHash('sha256').update(`${bucket}\0${key}`).digest('base64url');
  }

  private prune(now: number): void {
    if (this.entries.size < 10_000) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetsAt <= now) this.entries.delete(key);
    }
  }
}
