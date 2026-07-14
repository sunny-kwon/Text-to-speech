'use client';

import { VOICE_PROFILES } from '@/lib/tts/voices';

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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Voice</span>
        <select
          value={voiceId}
          onChange={(event) => onVoiceChange(event.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        >
          {VOICE_PROFILES.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label}
            </option>
          ))}
        </select>
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
