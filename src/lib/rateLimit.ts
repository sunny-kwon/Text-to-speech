import { Ratelimit } from '@upstash/ratelimit';
import { redisClient } from './kv';

export interface RateLimiter {
  check(identifier: string): Promise<boolean>;
}

interface RateLimiterOptions {
  /** Namespaces keys so /api/tts and /api/clean don't share a bucket. */
  prefix: string;
  max: number;
  windowSeconds: number;
}

/**
 * Per-IP rate limiter protecting the shared, unofficial free TTS/LLM
 * endpoints from abuse once this app is hosted for multiple users.
 * Uses Upstash's sliding-window limiter (shared across instances) when
 * Redis is configured, otherwise degrades to a simple in-memory window
 * scoped to a single warm serverless instance.
 */
export function createRateLimiter({ prefix, max, windowSeconds }: RateLimiterOptions): RateLimiter {
  if (redisClient) {
    const ratelimit = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      analytics: false,
      prefix: `ratelimit:${prefix}`,
    });
    return {
      async check(identifier) {
        const { success } = await ratelimit.limit(identifier);
        return success;
      },
    };
  }

  const windowMs = windowSeconds * 1000;
  const hits = new Map<string, number[]>();
  return {
    async check(identifier) {
      const now = Date.now();
      const recent = (hits.get(identifier) ?? []).filter((t) => now - t < windowMs);
      recent.push(now);
      hits.set(identifier, recent);
      return recent.length <= max;
    },
  };
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
