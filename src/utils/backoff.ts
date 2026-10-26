import { Logger } from './logger.js';

const logger = new Logger('BackoffRetry');

export interface BackoffOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculates exponential delay with full jitter:
 * delay = Math.random() * Math.min(maxDelay, baseDelay * 2^attempt)
 */
export function calculateJitterDelay(
  attempt: number,
  baseDelayMs: number = 500,
  maxDelayMs: number = 8000
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  return Math.floor(Math.random() * cappedDelay);
}

/**
 * Executes an async operation with exponential backoff and full jitter.
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;

  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;

      const isRetryable = options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : defaultRetryPredicate(error);

      if (attempt > maxRetries || !isRetryable) {
        logger.error(`Operation failed permanently after ${attempt} attempt(s)`, { attempt }, error);
        throw error;
      }

      const delay = calculateJitterDelay(attempt - 1, baseDelayMs, maxDelayMs);

      if (options.onRetry) {
        options.onRetry(error, attempt, delay);
      } else {
        logger.warn(`Retryable error caught. Backing off for ${delay}ms (attempt ${attempt}/${maxRetries})`, {
          attempt,
          delayMs: delay,
          message: error?.message,
        });
      }

      await sleep(delay);
    }
  }
}

/**
 * Default predicate identifying transient network/API issues.
 */
export function defaultRetryPredicate(error: any): boolean {
  if (!error) return false;

  // HTTP status codes: 429 (Rate Limit), 500, 502, 503, 504
  const status = error.status || error.statusCode || error.response?.status;
  if (status) {
    if (status === 429 || (status >= 500 && status <= 504)) {
      return true;
    }
  }

  // Meta Graph API error codes: 4 (Too Many Calls), 17 (User request limit reached), 32 (Page request limit reached), 613 (Calls to this api have exceeded rate limit)
  const metaCode = error.response?.data?.error?.code || error.code;
  if ([4, 17, 32, 613].includes(metaCode)) {
    return true;
  }

  // Network connection resets, aborts, timeouts
  const code = error.code || error.cause?.code;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  return false;
}
