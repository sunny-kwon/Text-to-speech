'use client';

import type { RefObject } from 'react';
import type { SpeechQueueState } from '@/hooks/useSpeechQueue';
import { EngineBadge } from './EngineBadge';
import { TranscriptView } from './TranscriptView';

interface Props {
  state: SpeechQueueState;
  audioElRef: RefObject<HTMLAudioElement | null>;
  disabled: boolean;
  onGenerate: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDownload: () => void;
  isDownloading: boolean;
}

export function PlayerBar({
  state,
  audioElRef,
  disabled,
  onGenerate,
  onPause,
  onResume,
  onStop,
  onDownload,
  isDownloading,
}: Props) {
  const isPlaying = state.status === 'playing';
  const isPaused = state.status === 'paused';
  const isBusy = state.status === 'loading';
  const isBrowserEngine = state.engine === 'browser';
  const canDownload = state.engine !== null && !isBrowserEngine && state.status !== 'error';
  // Non-empty exactly once a chunk's audio has actually loaded (set right
  // before audio.src is assigned in playChunk) — a more precise signal
  // than playback status for "is there something for the native player
  // to show," since it correctly stays hidden if the very first chunk
  // fails before anything ever loaded, but stays visible through an
  // error on a later chunk (e.g. autoplay blocked) so the native play
  // button — which the error message tells the user to press — is
  // actually there to press.
  const hasLoadedAudio = !isBrowserEngine && state.currentChunkText !== '';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <EngineBadge engine={state.engine} />
          {state.totalChunks > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Segment {Math.min(state.currentChunk + 1, state.totalChunks)} of {state.totalChunks}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isPlaying && !isPaused && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || isBusy}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isBusy ? 'Loading…' : '▶ Generate & Play'}
            </button>
          )}

          {/* Browser-voice fallback has no media element to attach native
              controls to, so it keeps the custom pause/resume/stop. */}
          {isBrowserEngine && isPlaying && (
            <button
              type="button"
              onClick={onPause}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              ⏸ Pause
            </button>
          )}
          {isBrowserEngine && isPaused && (
            <button
              type="button"
              onClick={onResume}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              ▶ Resume
            </button>
          )}
          {(isPlaying || isPaused) && (
            <button
              type="button"
              onClick={onStop}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              ■ Stop
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            disabled={!canDownload || isDownloading}
            title={isBrowserEngine ? "Download isn't available while using the browser voice fallback" : undefined}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {isDownloading ? 'Preparing…' : '⬇ Download MP3'}
          </button>
        </div>
      </div>

      {/* Always mounted so the ref is attached before playback can start;
          hidden (not unmounted) while there's nothing playable yet, or
          while in the browser-voice fallback which has no media source. */}
      <audio ref={audioElRef} controls className={hasLoadedAudio ? 'w-full' : 'hidden'} />

      <TranscriptView text={state.currentChunkText} activeWordIndex={state.activeWordIndex} />

      {state.status === 'error' && state.errorMessage && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.errorMessage}
        </p>
      )}
      {isBrowserEngine && state.status !== 'error' && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Server voices are temporarily unavailable — reading with your browser&apos;s built-in voice instead. Download
          isn&apos;t available in this mode.
        </p>
      )}
    </div>
  );
}
