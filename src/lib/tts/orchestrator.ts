import { isProviderDown, markProviderDown } from './circuitBreaker';
import { synthesizeWithEdgeTts } from './providers/edgeTts';
import { synthesizeWithGoogleTts } from './providers/googleTts';
import type { TtsProviderId, VoiceProfile } from './types';

const PROVIDER_ORDER: TtsProviderId[] = ['edge-tts', 'google-tts'];
const RETRY_BACKOFF_MS = 300;

export interface SynthesizeResult {
  audio: Buffer;
  provider: TtsProviderId;
}

export class AllProvidersDownError extends Error {
  constructor(details: string[]) {
    super(`All TTS providers unavailable: ${details.join(' | ')}`);
    this.name = 'AllProvidersDownError';
  }
}

async function callProvider(id: TtsProviderId, text: string, voice: VoiceProfile): Promise<Buffer> {
  if (id === 'edge-tts') return synthesizeWithEdgeTts(text, voice.edgeVoice);
  return synthesizeWithGoogleTts(text, voice.googleLang);
}

/** One retry with a short backoff before a provider is considered down —
 * absorbs transient network blips without tripping the circuit breaker. */
async function attemptWithRetry(id: TtsProviderId, text: string, voice: VoiceProfile): Promise<Buffer> {
  try {
    return await callProvider(id, text, voice);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    return callProvider(id, text, voice);
  }
}

/**
 * Tries providers in order (tier 1 -> tier 2), skipping any currently
 * flagged down by the circuit breaker. `forcedProvider` (the provider a
 * client already committed to for earlier chunks in the same document)
 * is tried first so voice/quality stays consistent across a document,
 * but the cascade still runs if it fails, guaranteeing a chunk is never
 * simply dropped as long as one provider is healthy.
 */
export async function synthesizeSpeech(
  text: string,
  voice: VoiceProfile,
  forcedProvider?: TtsProviderId,
): Promise<SynthesizeResult> {
  const order = forcedProvider
    ? [forcedProvider, ...PROVIDER_ORDER.filter((id) => id !== forcedProvider)]
    : PROVIDER_ORDER;

  const failures: string[] = [];

  for (const providerId of order) {
    if (await isProviderDown(providerId)) {
      failures.push(`${providerId}: circuit open`);
      continue;
    }
    try {
      const audio = await attemptWithRetry(providerId, text, voice);
      if (!audio || audio.length === 0) throw new Error('empty audio buffer');
      return { audio, provider: providerId };
    } catch (err) {
      failures.push(`${providerId}: ${err instanceof Error ? err.message : String(err)}`);
      await markProviderDown(providerId);
    }
  }

  throw new AllProvidersDownError(failures);
}
