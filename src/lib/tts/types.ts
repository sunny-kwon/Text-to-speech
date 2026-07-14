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
