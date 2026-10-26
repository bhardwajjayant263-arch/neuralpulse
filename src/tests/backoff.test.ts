import { describe, it, expect, vi } from 'vitest';
import {
  calculateJitterDelay,
  defaultRetryPredicate,
  withExponentialBackoff,
} from '../utils/backoff.js';

describe('Exponential Backoff & Jitter', () => {
  it('calculates full jitter delay within exponential boundaries', () => {
    const base = 500;
    const max = 8000;

    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = calculateJitterDelay(attempt, base, max);
      const upperBound = Math.min(max, base * Math.pow(2, attempt));

      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(upperBound);
    }
  });

  it('correctly identifies retryable HTTP and Meta error codes', () => {
    // 429 Rate Limit
    expect(defaultRetryPredicate({ status: 429 })).toBe(true);

    // 503 Service Unavailable
    expect(defaultRetryPredicate({ status: 503 })).toBe(true);

    // Meta Rate Limit Codes (4, 17, 32, 613)
    expect(defaultRetryPredicate({ response: { data: { error: { code: 613 } } } })).toBe(true);
    expect(defaultRetryPredicate({ code: 4 })).toBe(true);

    // Non-retryable 400 Bad Request
    expect(defaultRetryPredicate({ status: 400 })).toBe(false);

    // Non-retryable 404
    expect(defaultRetryPredicate({ status: 404 })).toBe(false);
  });

  it('retries until success within max retries', async () => {
    let callCount = 0;
    const mockFn = vi.fn(async () => {
      callCount++;
      if (callCount < 3) {
        const err: any = new Error('Rate limit exceeded');
        err.status = 429;
        throw err;
      }
      return 'success_payload';
    });

    const result = await withExponentialBackoff(mockFn, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
    });

    expect(result).toBe('success_payload');
    expect(callCount).toBe(3);
  });
});
