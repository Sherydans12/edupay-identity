export interface RateLimitRequest {
  bucket: 'login' | 'refresh' | 'activation' | 'recovery' | 'management';
  keys: ReadonlyArray<string>;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason: 'configured-policy-required';
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
