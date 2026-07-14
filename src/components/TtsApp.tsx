'use client';

import { useCallback, useState } from 'react';
import { TextSourcePanel } from './TextSourcePanel';
import { VoiceSpeedControls } from './VoiceSpeedControls';
import { PlayerBar } from './PlayerBar';
import { useSpeechQueue } from '@/hooks/useSpeechQueue';
import { chunkText } from '@/lib/text/chunk';
import { DEFAULT_VOICE_ID } from '@/lib/tts/voices';

// Larger than the TTS chunk size: the cleanup LLM needs enough
// surrounding context to fix line-wraps/hyphenation sensibly.
const CLEAN_BATCH_CHARS = 4000;

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
