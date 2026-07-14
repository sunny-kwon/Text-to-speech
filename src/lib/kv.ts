import { Redis } from '@upstash/redis';

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

function createKVStore(): KVStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return new RedisKVStore(new Redis({ url, token }));
  }
  return new MemoryKVStore();
}

// Module-level singleton: reused across warm serverless invocations.
export const kv: KVStore = createKVStore();

export const isRedisConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
