import { kv } from '@/lib/kv';
import type { TtsProviderId } from './types';

/**
 * Short-lived "down" flags shared (via Redis when configured) across all
 * concurrent requests/instances. Once a provider fails, every other
 * in-flight request skips straight past it instead of separately waiting
 * out its own timeout. The flag self-heals via TTL expiry, so a recovered
 * provider is naturally retried after DOWN_TTL_SECONDS.
 */
const DOWN_TTL_SECONDS = 60;

function key(provider: TtsProviderId): string {
  return `tts:down:${provider}`;
}

export async function isProviderDown(provider: TtsProviderId): Promise<boolean> {
  try {
    return (await kv.get(key(provider))) === '1';
  } catch {
    // If the breaker store itself is unreachable, fail open rather than
    // refusing to even attempt synthesis.
    return false;
  }
}

export async function markProviderDown(provider: TtsProviderId): Promise<void> {
  try {
    await kv.set(key(provider), '1', DOWN_TTL_SECONDS);
  } catch {
    // Non-fatal: worst case we just retry this provider again next time.
  }
}
