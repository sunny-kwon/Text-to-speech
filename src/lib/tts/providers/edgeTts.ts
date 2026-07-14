import { EdgeTTS, Constants } from '@andresaya/edge-tts';
import { withTimeout } from '../withTimeout';
import type { WordTiming } from '../types';

const TIMEOUT_MS = 7000;
// Azure's word-boundary metadata reports Offset/Duration in 100-nanosecond
// ticks (the standard Windows FILETIME unit) — not milliseconds.
const TICKS_PER_SECOND = 10_000_000;

export interface EdgeTtsResult {
  audio: Buffer;
  wordBoundaries: WordTiming[];
}

/** Tier 1: Microsoft Edge neural voices (unofficial, free, no API key). */
export async function synthesizeWithEdgeTts(text: string, voice: string): Promise<EdgeTtsResult> {
  const tts = new EdgeTTS();
  await withTimeout(
    tts.synthesize(text, voice, {
      outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    }),
    TIMEOUT_MS,
    'edge-tts',
  );

  const wordBoundaries: WordTiming[] = tts.getWordBoundaries().map((boundary) => ({
    startSec: boundary.offset / TICKS_PER_SECOND,
    endSec: (boundary.offset + boundary.duration) / TICKS_PER_SECOND,
  }));

  return { audio: tts.toBuffer(), wordBoundaries };
}
