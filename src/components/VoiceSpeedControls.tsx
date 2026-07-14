'use client';

import { useEffect, useRef, useState } from 'react';
import { VOICE_PROFILES } from '@/lib/tts/voices';

const PREVIEW_TEXT = 'This is a preview of this voice.';

interface Props {
  voiceId: string;
  onVoiceChange: (id: string) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  cleanupEnabled: boolean;
  onCleanupEnabledChange: (enabled: boolean) => void;
}

export function VoiceSpeedControls({
  voiceId,
  onVoiceChange,
  rate,
  onRateChange,
  cleanupEnabled,
  onCleanupEnabledChange,
}: Props) {
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // Independent of the main playback queue by design — this is a
  // throwaway sample, not something that needs chunking, provider
  // fallback tracking, or word-highlight wiring. If the server-side
  // engines are down, it just fails quietly; there's no browser-voice
  // fallback here since a broken preview isn't worth the complexity for
  // what's a minor convenience, not core functionality.
  async function handlePreview() {
    setPreviewStatus('loading');
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: PREVIEW_TEXT, voiceId }),
      });
      if (!response.ok) throw new Error('preview request failed');
      const blob = await response.blob();

      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;

      const audio = previewAudioRef.current ?? new Audio();
      previewAudioRef.current = audio;
      audio.src = url;
      await audio.play();
      setPreviewStatus('idle');
    } catch {
      setPreviewStatus('error');
      setTimeout(() => setPreviewStatus('idle'), 3000);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Voice</span>
        <div className="flex gap-2">
          <select
            value={voiceId}
            onChange={(event) => onVoiceChange(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {VOICE_PROFILES.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={previewStatus === 'loading'}
            title="Hear a short sample of this voice"
            aria-label="Preview this voice"
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {previewStatus === 'loading' ? '…' : '🔊'}
          </button>
        </div>
        {previewStatus === 'error' && (
          <span className="text-xs text-red-600 dark:text-red-400">Preview unavailable right now.</span>
        )}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Speed: {rate.toFixed(2)}x</span>
        <input
          type="range"
          min={0.75}
          max={2}
          step={0.25}
          value={rate}
          onChange={(event) => onRateChange(Number(event.target.value))}
          className="accent-zinc-900 dark:accent-zinc-100"
        />
      </label>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={cleanupEnabled}
          onChange={(event) => onCleanupEnabledChange(event.target.checked)}
          className="h-4 w-4 rounded accent-zinc-900 dark:accent-zinc-100"
        />
        <span className="text-zinc-700 dark:text-zinc-300">
          Clean up text with AI before reading (fixes PDF line breaks — optional, skipped automatically if unavailable)
        </span>
      </label>
    </div>
  );
}
