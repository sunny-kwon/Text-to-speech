import { getAllAudioBase64 } from '@sefinek/google-tts-api';
import { withTimeout } from '../withTimeout';
import type { WordTiming } from '../types';

const TIMEOUT_MS = 7000;

export interface GoogleTtsResult {
  audio: Buffer;
  wordBoundaries: WordTiming[];
}

/**
 * Tier 2: Google Translate TTS (unofficial, free, no API key). Different
 * vendor/origin than edge-tts, so it stays up during a Microsoft-side
 * outage. Google's endpoint caps requests at ~200 characters, so
 * getAllAudioBase64 internally splits and returns multiple pieces, which
 * we concatenate into a single MP3 buffer (raw MP3 frame concatenation
 * plays back fine). This endpoint has no word-timing metadata, so
 * word-highlight-as-you-read is only available on tier 1.
 */
export async function synthesizeWithGoogleTts(text: string, lang: string): Promise<GoogleTtsResult> {
  const parts = await withTimeout(
    getAllAudioBase64(text, { lang, timeout: TIMEOUT_MS }),
    TIMEOUT_MS + 1000,
    'google-tts',
  );
  if (!parts.length) throw new Error('google-tts returned no audio parts');
  const audio = Buffer.concat(parts.map((part) => Buffer.from(part.base64, 'base64')));
  return { audio, wordBoundaries: [] };
}
