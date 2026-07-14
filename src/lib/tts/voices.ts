import type { VoiceProfile } from './types';

/**
 * Curated voice list. Each profile maps to both a tier-1 (edge-tts neural
 * voice) and tier-2 (google-tts language) option so a mid-document
 * fallback still speaks the right language, even though Google's engine
 * has no per-voice selection of its own.
 */
export const VOICE_PROFILES: VoiceProfile[] = [
  { id: 'en-us-aria', label: 'Aria — English (US)', language: 'en-US', edgeVoice: 'en-US-AriaNeural', googleLang: 'en', gender: 'Female' },
  { id: 'en-us-guy', label: 'Guy — English (US)', language: 'en-US', edgeVoice: 'en-US-GuyNeural', googleLang: 'en', gender: 'Male' },
  { id: 'en-gb-sonia', label: 'Sonia — English (UK)', language: 'en-GB', edgeVoice: 'en-GB-SoniaNeural', googleLang: 'en', gender: 'Female' },
  { id: 'en-au-natasha', label: 'Natasha — English (AU)', language: 'en-AU', edgeVoice: 'en-AU-NatashaNeural', googleLang: 'en', gender: 'Female' },
  { id: 'es-es-alvaro', label: 'Álvaro — Spanish (Spain)', language: 'es-ES', edgeVoice: 'es-ES-AlvaroNeural', googleLang: 'es', gender: 'Male' },
  { id: 'fr-fr-denise', label: 'Denise — French', language: 'fr-FR', edgeVoice: 'fr-FR-DeniseNeural', googleLang: 'fr', gender: 'Female' },
  { id: 'de-de-katja', label: 'Katja — German', language: 'de-DE', edgeVoice: 'de-DE-KatjaNeural', googleLang: 'de', gender: 'Female' },
  { id: 'hi-in-swara', label: 'Swara — Hindi', language: 'hi-IN', edgeVoice: 'hi-IN-SwaraNeural', googleLang: 'hi', gender: 'Female' },
  { id: 'ja-jp-nanami', label: 'Nanami — Japanese', language: 'ja-JP', edgeVoice: 'ja-JP-NanamiNeural', googleLang: 'ja', gender: 'Female' },
  { id: 'pt-br-francisca', label: 'Francisca — Portuguese (BR)', language: 'pt-BR', edgeVoice: 'pt-BR-FranciscaNeural', googleLang: 'pt', gender: 'Female' },
];

export const DEFAULT_VOICE_ID = VOICE_PROFILES[0].id;

export function getVoiceProfile(id: string | undefined | null): VoiceProfile {
  return VOICE_PROFILES.find((voice) => voice.id === id) ?? VOICE_PROFILES[0];
}
