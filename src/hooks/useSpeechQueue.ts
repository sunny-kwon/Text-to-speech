'use client';

import { useEffect, useRef, useState } from 'react';
import { chunkText } from '@/lib/text/chunk';
import type { TtsProviderId } from '@/lib/tts/types';

export type Engine = TtsProviderId | 'browser';
export type QueueStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'done';

export interface SpeechQueueState {
  status: QueueStatus;
  engine: Engine | null;
  currentChunk: number;
  totalChunks: number;
  errorMessage: string | null;
}

const CHUNK_TARGET_CHARS = 600;
const PREFETCH_AHEAD = 1;

const initialState: SpeechQueueState = {
  status: 'idle',
  engine: null,
  currentChunk: 0,
  totalChunks: 0,
  errorMessage: null,
};

export function useSpeechQueue() {
  const [state, setState] = useState<SpeechQueueState>(initialState);

  // Attached to a real <audio controls> element rendered by the
  // consumer (not created via `new Audio()`), so the browser's native
  // scrubber/volume/time UI drives the same element our chunk-queue
  // logic controls. The element is always mounted (just hidden while
  // unused), so this ref is populated before any playback can start.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<string[]>([]);
  const blobsRef = useRef<(Blob | null)[]>([]);
  const objectUrlsRef = useRef<string[]>([]);
  const forcedProviderRef = useRef<TtsProviderId | undefined>(undefined);
  const voiceIdRef = useRef('en-us-aria');
  const rateRef = useRef(1);
  const stopRequestedRef = useRef(false);
  const browserModeRef = useRef(false);

  // Keeps `state.status` in sync when the user drives playback directly
  // via the native <audio> controls (e.g. clicking its own pause button)
  // instead of through our pause()/resume() functions.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setState((s) => (s.status === 'error' ? s : { ...s, status: 'playing' }));
    const onPause = () => setState((s) => (s.status === 'idle' || s.status === 'error' ? s : { ...s, status: 'paused' }));
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  // Unmount cleanup only ever touches refs, so it's the sole thing kept
  // inside an actual effect.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      stopRequestedRef.current = true;
      audio?.pause();
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // The functions below are intentionally plain (not useCallback): they
  // only ever run from user-triggered events (button clicks, audio
  // `onended`), never as a hook/effect dependency, so memoizing them
  // buys nothing but adds self-referential-recursion complexity.

  async function fetchChunkAudio(index: number): Promise<Blob> {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: chunksRef.current[index],
        voiceId: voiceIdRef.current,
        provider: forcedProviderRef.current,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message ?? `Speech request failed (${response.status})`);
    }

    const provider = response.headers.get('X-TTS-Provider') as TtsProviderId | null;
    if (provider) forcedProviderRef.current = provider;
    return response.blob();
  }

  function speakWithBrowser(fromIndex: number) {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Speech is unavailable in this browser.' }));
      return;
    }
    browserModeRef.current = true;
    const remainingText = chunksRef.current.slice(fromIndex).join(' ');
    const utterance = new SpeechSynthesisUtterance(remainingText);
    utterance.rate = rateRef.current;
    utterance.onend = () => setState((s) => ({ ...s, status: 'done' }));
    utterance.onerror = () =>
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Browser speech playback failed.' }));

    window.speechSynthesis.cancel();
    setState((s) => ({ ...s, engine: 'browser', status: 'playing' }));
    window.speechSynthesis.speak(utterance);
  }

  async function playChunk(index: number) {
    if (stopRequestedRef.current) return;
    if (index >= chunksRef.current.length) {
      setState((s) => ({ ...s, status: 'done' }));
      return;
    }

    setState((s) => ({ ...s, currentChunk: index, status: 'loading' }));

    let blob = blobsRef.current[index];
    if (!blob) {
      try {
        blob = await fetchChunkAudio(index);
        blobsRef.current[index] = blob;
      } catch {
        // Both server-side providers are down (or unreachable) for this
        // chunk: drop to the browser's built-in voice for the rest of
        // the document rather than stalling or erroring out.
        speakWithBrowser(index);
        return;
      }
    }
    if (stopRequestedRef.current) return;

    const audio = audioRef.current;
    if (!audio) {
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Audio player is not ready yet — try again.' }));
      return;
    }

    const url = URL.createObjectURL(blob);
    objectUrlsRef.current[index] = url;
    audio.src = url;
    audio.playbackRate = rateRef.current;
    audio.onended = () => {
      if (!stopRequestedRef.current) void playChunk(index + 1);
    };

    setState((s) => ({ ...s, status: 'playing', engine: forcedProviderRef.current ?? s.engine ?? 'edge-tts' }));

    // Prefetch the next chunk while the current one plays, so playback
    // doesn't stall waiting on the network between chunks.
    for (let i = index + 1; i <= index + PREFETCH_AHEAD && i < chunksRef.current.length; i++) {
      if (!blobsRef.current[i]) {
        fetchChunkAudio(i)
          .then((b) => {
            blobsRef.current[i] = b;
          })
          .catch(() => {
            /* swallowed: playChunk retries/falls back when it reaches this index */
          });
      }
    }

    try {
      await audio.play();
    } catch {
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Playback was blocked — press play again.' }));
    }
  }

  function speak(text: string, voiceId: string, rate = 1) {
    stopRequestedRef.current = false;
    browserModeRef.current = false;
    forcedProviderRef.current = undefined;
    voiceIdRef.current = voiceId;
    rateRef.current = rate;
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    blobsRef.current = [];

    const chunks = chunkText(text, CHUNK_TARGET_CHARS);
    chunksRef.current = chunks;

    if (!chunks.length) {
      setState({ ...initialState, status: 'error', errorMessage: 'No text to read.' });
      return;
    }

    setState({ status: 'loading', engine: null, currentChunk: 0, totalChunks: chunks.length, errorMessage: null });
    void playChunk(0);
  }

  function stop() {
    stopRequestedRef.current = true;
    audioRef.current?.pause();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setState((s) => ({ ...s, status: 'idle' }));
  }

  function pause() {
    if (browserModeRef.current) window.speechSynthesis?.pause();
    else audioRef.current?.pause();
    setState((s) => ({ ...s, status: 'paused' }));
  }

  function resume() {
    stopRequestedRef.current = false;
    if (browserModeRef.current) window.speechSynthesis?.resume();
    else void audioRef.current?.play();
    setState((s) => ({ ...s, status: 'playing' }));
  }

  function setRate(rate: number) {
    rateRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }

  /** Downloads require every chunk to be server-generated audio, so this
   * is unavailable while in the browser-voice fallback mode. */
  async function download(): Promise<Blob | null> {
    if (browserModeRef.current || !chunksRef.current.length) return null;
    for (let i = 0; i < chunksRef.current.length; i++) {
      if (!blobsRef.current[i]) {
        blobsRef.current[i] = await fetchChunkAudio(i);
      }
    }
    return new Blob(blobsRef.current as Blob[], { type: 'audio/mpeg' });
  }

  return { state, speak, stop, pause, resume, setRate, download, audioElRef: audioRef };
}
