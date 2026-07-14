/** Shared types, safe to import from both client and server code. */

export type TtsProviderId = 'edge-tts' | 'google-tts';

export interface VoiceProfile {
  id: string;
  label: string;
  language: string;
  /** Microsoft Edge neural voice short name (tier 1). */
  edgeVoice: string;
  /** Google Translate TTS language code (tier 2). */
  googleLang: string;
  gender: 'Female' | 'Male';
}

/**
 * One spoken word's timing within a chunk's audio, in seconds. Word
 * index in the array is expected to line up with the index-th
 * whitespace-delimited token in that chunk's text (see
 * lib/text/tokenize.ts) — only edge-tts provides this; other tiers
 * return an empty array.
 */
export interface WordTiming {
  startSec: number;
  endSec: number;
}

/**
 * Wire format for WordTiming sent in the X-TTS-Word-Boundaries header:
 * a bare [startSec, endSec] tuple (2 decimal places) rather than a full
 * JSON object, to keep the header small. Shared between the encoder
 * (app/api/tts/route.ts) and decoder (hooks/useSpeechQueue.ts) so a
 * future change to the tuple shape has to update both call sites'
 * shared type, not two independently-typed `[number, number]` literals.
 */
export type CompactWordTiming = [startSec: number, endSec: number];
