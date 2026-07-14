import { getAllAudioBase64 } from '@sefinek/google-tts-api';
import { withTimeout } from '../withTimeout';

const TIMEOUT_MS = 7000;

/**
 * Tier 2: Google Translate TTS (unofficial, free, no API key). Different
 * vendor/origin than edge-tts, so it stays up during a Microsoft-side
 * outage. Google's endpoint caps requests at ~200 characters, so
 * getAllAudioBase64 internally splits and returns multiple pieces, which
 * we concatenate into a single MP3 buffer (raw MP3 frame concatenation
 * plays back fine).
 */
export async function synthesizeWithGoogleTts(text: string, lang: string): Promise<Buffer> {
  const parts = await withTimeout(
    getAllAudioBase64(text, { lang, timeout: TIMEOUT_MS }),
    TIMEOUT_MS + 1000,
    'google-tts',
  );
  if (!parts.length) throw new Error('google-tts returned no audio parts');
  return Buffer.concat(parts.map((part) => Buffer.from(part.base64, 'base64')));
}
