'use client';

import { useEffect, useRef, useState } from 'react';
import { chunkText } from '@/lib/text/chunk';
import { wordIndexAtCharOffset } from '@/lib/text/tokenize';
import type { TtsProviderId, WordTiming } from '@/lib/tts/types';

export type Engine = TtsProviderId | 'browser';
export type QueueStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'done';

export interface SpeechQueueState {
  status: QueueStatus;
  engine: Engine | null;
  currentChunk: number;
  totalChunks: number;
  errorMessage: string | null;
  /** Text of the chunk currently loaded/playing, for the transcript view. */
  currentChunkText: string;
  /** Word-token index (see lib/text/tokenize.ts) currently being spoken,
   * or null when no timing data is available for this tier/chunk. */
  activeWordIndex: number | null;
}

const CHUNK_TARGET_CHARS = 600;
const PREFETCH_AHEAD = 1;

const initialState: SpeechQueueState = {
  status: 'idle',
  engine: null,
  currentChunk: 0,
  totalChunks: 0,
  errorMessage: null,
  currentChunkText: '',
  activeWordIndex: null,
};

/** Decodes the compact base64 [startSec, endSec] pairs sent in the
 * X-TTS-Word-Boundaries header. Uses TextDecoder (not a plain string
 * built from atob's byte-per-char output) so multi-byte UTF-8 voice
 * text in the surrounding JSON doesn't get mangled. */
function decodeWordBoundaries(header: string): WordTiming[] {
  try {
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
    const pairs = JSON.parse(new TextDecoder().decode(bytes)) as [number, number][];
    return pairs.map(([startSec, endSec]) => ({ startSec, endSec }));
  } catch {
    return [];
  }
}

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
  const boundariesRef = useRef<(WordTiming[] | null)[]>([]);
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

  // Drives word-highlight-as-you-read for the edge-tts tier (the only one
  // with real timing data): on each playback tick, finds the last word
  // whose start time has passed and marks it active.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      setState((s) => {
        const boundaries = boundariesRef.current[s.currentChunk];
        if (!boundaries || !boundaries.length) return s;
        const t = audio.currentTime;
        let idx = -1;
        for (let i = 0; i < boundaries.length; i++) {
          if (boundaries[i].startSec > t) break;
          idx = i;
        }
        return idx === s.activeWordIndex ? s : { ...s, activeWordIndex: idx };
      });
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    return () => audio.removeEventListener('timeupdate', onTimeUpdate);
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

    const boundaryHeader = response.headers.get('X-TTS-Word-Boundaries');
    boundariesRef.current[index] = boundaryHeader ? decodeWordBoundaries(boundaryHeader) : [];

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
    // Word-highlighting in this fallback tier depends on the browser
    // actually firing word boundaries (reliable in Chrome, inconsistent
    // elsewhere) — where it doesn't fire, activeWordIndex just stays
    // null and the transcript renders without a highlight.
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      const idx = wordIndexAtCharOffset(remainingText, event.charIndex);
      setState((s) => (s.activeWordIndex === idx ? s : { ...s, activeWordIndex: idx }));
    };
    utterance.onend = () => setState((s) => ({ ...s, status: 'done', activeWordIndex: null }));
    utterance.onerror = () =>
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Browser speech playback failed.' }));

    window.speechSynthesis.cancel();
    setState((s) => ({
      ...s,
      engine: 'browser',
      status: 'playing',
      currentChunkText: remainingText,
      activeWordIndex: null,
    }));
    window.speechSynthesis.speak(utterance);
  }

  async function playChunk(index: number) {
    if (stopRequestedRef.current) return;
    if (index >= chunksRef.current.length) {
      setState((s) => ({ ...s, status: 'done', activeWordIndex: null }));
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

    setState((s) => ({
      ...s,
      status: 'playing',
      engine: forcedProviderRef.current ?? s.engine ?? 'edge-tts',
      currentChunkText: chunksRef.current[index] ?? '',
      activeWordIndex: null,
    }));

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
    boundariesRef.current = [];

    const chunks = chunkText(text, CHUNK_TARGET_CHARS);
    chunksRef.current = chunks;

    if (!chunks.length) {
      setState({ ...initialState, status: 'error', errorMessage: 'No text to read.' });
      return;
    }

    setState({
      status: 'loading',
      engine: null,
      currentChunk: 0,
      totalChunks: chunks.length,
      errorMessage: null,
      currentChunkText: '',
      activeWordIndex: null,
    });
    void playChunk(0);
  }

  function stop() {
    stopRequestedRef.current = true;
    audioRef.current?.pause();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setState((s) => ({ ...s, status: 'idle', activeWordIndex: null }));
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
