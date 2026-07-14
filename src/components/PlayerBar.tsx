'use client';

import type { SpeechQueueState } from '@/hooks/useSpeechQueue';
import { EngineBadge } from './EngineBadge';

interface Props {
  state: SpeechQueueState;
  disabled: boolean;
  onGenerate: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDownload: () => void;
  isDownloading: boolean;
}

export function PlayerBar({ state, disabled, onGenerate, onPause, onResume, onStop, onDownload, isDownloading }: Props) {
  const isPlaying = state.status === 'playing';
  const isPaused = state.status === 'paused';
  const isBusy = state.status === 'loading';
  const canDownload = state.engine !== null && state.engine !== 'browser' && state.status !== 'error';

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
          {isPlaying && (
            <button
              type="button"
              onClick={onPause}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              ⏸ Pause
            </button>
          )}
          {isPaused && (
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
            title={state.engine === 'browser' ? "Download isn't available while using the browser voice fallback" : undefined}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {isDownloading ? 'Preparing…' : '⬇ Download MP3'}
          </button>
        </div>
      </div>

      {state.status === 'error' && state.errorMessage && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.errorMessage}
        </p>
      )}
      {state.engine === 'browser' && state.status !== 'error' && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Server voices are temporarily unavailable — reading with your browser&apos;s built-in voice instead. Download
          isn&apos;t available in this mode.
        </p>
      )}
    </div>
  );
}
