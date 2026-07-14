'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TextSourcePanel } from './TextSourcePanel';
import { VoiceSpeedControls } from './VoiceSpeedControls';
import { PlayerBar } from './PlayerBar';
import { useSpeechQueue } from '@/hooks/useSpeechQueue';
import { chunkText } from '@/lib/text/chunk';
import { DEFAULT_VOICE_ID } from '@/lib/tts/voices';

// Larger than the TTS chunk size: the cleanup LLM needs enough
// surrounding context to fix line-wraps/hyphenation sensibly.
const CLEAN_BATCH_CHARS = 4000;

// Bumped if the persisted shape ever changes incompatibly.
const STORAGE_KEY = 'tts-app-state-v1';
const PERSIST_DEBOUNCE_MS = 400;

interface PersistedState {
  text: string;
  voiceId: string;
  rate: number;
  cleanupEnabled: boolean;
}

async function cleanupText(text: string): Promise<string> {
  const batches = chunkText(text, CLEAN_BATCH_CHARS);
  const cleaned: string[] = [];

  for (const batch of batches) {
    try {
      const response = await fetch('/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: batch }),
      });
      if (!response.ok) {
        cleaned.push(batch);
        continue;
      }
      const data = (await response.json()) as { text?: string };
      cleaned.push(typeof data.text === 'string' && data.text.trim() ? data.text : batch);
    } catch {
      // AI cleanup is best-effort only — never block the core TTS flow.
      cleaned.push(batch);
    }
  }

  return cleaned.join('\n\n');
}

export function TtsApp() {
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [rate, setRateState] = useState(1);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const { state, speak, stop, pause, resume, setRate, download, audioElRef } = useSpeechQueue();

  // Restoring localStorage must happen after mount (not in a lazy
  // useState initializer), since this component is server-rendered
  // first and `window` isn't available there — doing it in an effect
  // avoids a hydration mismatch at the cost of a brief flash from
  // empty to restored content, the standard tradeoff for this pattern.
  // This is a one-time sync from an external store on mount (the
  // sanctioned use of setState-in-effect), not a derived-state update —
  // it just happens to touch four independent, otherwise-unrelated
  // pieces of UI state at once, which is what trips the lint rule.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const restored = JSON.parse(raw) as Partial<PersistedState>;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (typeof restored.text === 'string') setText(restored.text);
      if (typeof restored.voiceId === 'string') setVoiceId(restored.voiceId);
      if (typeof restored.cleanupEnabled === 'boolean') setCleanupEnabled(restored.cleanupEnabled);
      if (typeof restored.rate === 'number') {
        setRateState(restored.rate);
        setRate(restored.rate);
      }
    } catch {
      // Corrupted or unavailable (private browsing) storage — just start fresh.
    }
    // Intentionally runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced so pasting/typing a large document doesn't serialize the
  // full text to localStorage on every keystroke.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        const payload: PersistedState = { text, voiceId, rate, cleanupEnabled };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Storage full or unavailable — losing persistence is non-fatal.
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(persistTimerRef.current);
  }, [text, voiceId, rate, cleanupEnabled]);

  const handleGenerate = useCallback(async () => {
    if (!text.trim()) return;

    let finalText = text;
    if (cleanupEnabled) {
      setIsCleaning(true);
      try {
        finalText = await cleanupText(text);
      } finally {
        setIsCleaning(false);
      }
    }
    speak(finalText, voiceId, rate);
  }, [text, cleanupEnabled, voiceId, rate, speak]);

  const handleRateChange = useCallback(
    (newRate: number) => {
      setRateState(newRate);
      setRate(newRate);
    },
    [setRate],
  );

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      const blob = await download();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'speech.mp3';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }, [download]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Text to Speech</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Paste text or drop a PDF, pick a voice, and listen — free, with automatic fallback if a voice engine goes
          down.
        </p>
      </header>

      <TextSourcePanel text={text} onTextChange={setText} />

      <VoiceSpeedControls
        voiceId={voiceId}
        onVoiceChange={setVoiceId}
        rate={rate}
        onRateChange={handleRateChange}
        cleanupEnabled={cleanupEnabled}
        onCleanupEnabledChange={setCleanupEnabled}
      />

      {isCleaning && <p className="text-sm text-zinc-500 dark:text-zinc-400">Cleaning up text with AI…</p>}

      <PlayerBar
        state={state}
        audioElRef={audioElRef}
        disabled={!text.trim() || isCleaning}
        onGenerate={handleGenerate}
        onPause={pause}
        onResume={resume}
        onStop={stop}
        onDownload={handleDownload}
        isDownloading={isDownloading}
      />
    </div>
  );
}
