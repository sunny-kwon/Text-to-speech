import { EdgeTTS, Constants } from '@andresaya/edge-tts';
import { withTimeout } from '../withTimeout';

const TIMEOUT_MS = 7000;

/** Tier 1: Microsoft Edge neural voices (unofficial, free, no API key). */
export async function synthesizeWithEdgeTts(text: string, voice: string): Promise<Buffer> {
  const tts = new EdgeTTS();
  await withTimeout(
    tts.synthesize(text, voice, {
      outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    }),
    TIMEOUT_MS,
    'edge-tts',
  );
  return tts.toBuffer();
}
