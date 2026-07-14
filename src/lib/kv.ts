import { Redis } from '@upstash/redis';

/**
 * Single shared Upstash Redis client, constructed once at module scope
 * (null if not configured — this app must run at full capability with
 * zero environment variables set). Both the circuit-breaker KVStore
 * below and lib/rateLimit.ts's Ratelimit import this rather than each
 * independently re-deriving the same "is Redis configured" check and
 * constructing their own client instance.
 */
export const redisClient: Redis | null = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
})();

/**
 * Minimal key-value abstraction used for the TTS provider circuit breaker.
 * Backed by Upstash Redis (shared across all serverless instances) when
 * configured, otherwise falls back to an in-memory store so the app still
 * works with zero external services in local dev or a minimal deploy.
 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

class RedisKVStore implements KVStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    const value = await this.redis.get<string>(key);
    return value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }
}

class MemoryKVStore implements KVStore {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

// Module-level singleton: reused across warm serverless invocations.
export const kv: KVStore = redisClient ? new RedisKVStore(redisClient) : new MemoryKVStore();

export const isRedisConfigured = redisClient !== null;
