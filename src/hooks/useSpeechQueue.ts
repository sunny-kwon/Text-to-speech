'use client';

import { useEffect, useRef, useState } from 'react';
import { chunkText } from '@/lib/text/chunk';
import { tokenizeWords, wordIndexAtCharOffsetFromTokens } from '@/lib/text/tokenize';
import type { CompactWordTiming, TtsProviderId, WordTiming } from '@/lib/tts/types';

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
    const pairs = JSON.parse(new TextDecoder().decode(bytes)) as CompactWordTiming[];
    return pairs.map(([startSec, endSec]) => ({ startSec, endSec }));
  } catch {
    return [];
  }
}

/** Thrown by fetchChunkAudio on a non-OK response, carrying the server's
 * error code (e.g. 'ALL_PROVIDERS_DOWN', 'RATE_LIMITED') so callers can
 * distinguish "both TTS providers are genuinely down" — the only case
 * that should trigger a permanent downgrade to the browser voice — from
 * a transient/retryable failure like a rate limit or network blip. */
class TtsRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'TtsRequestError';
  }
}

function cancelBrowserSpeech(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

function getMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  return navigator.mediaSession;
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
  // Bumped on every speak() call. In-flight requests from a previous
  // session (e.g. a prefetch that was still pending when the user
  // edited the text and regenerated) check this before writing into the
  // new session's caches, so a stale response can't silently overwrite
  // fresh chunk data with audio for text that's no longer current.
  const sessionIdRef = useRef(0);

  // "Latest" ref: pause/resume/stop/playChunk are plain functions
  // redefined every render (see note below), so the Media Session action
  // handlers — registered exactly once — call through this ref instead
  // of closing over stale versions from the render that registered them.
  // Updated in a deps-less effect (runs after every render) rather than
  // during render itself, per React's rule against mutating refs while
  // rendering.
  const latestRef = useRef({ pause, resume, stop, playChunk, currentChunk: state.currentChunk });
  useEffect(() => {
    latestRef.current = { pause, resume, stop, playChunk, currentChunk: state.currentChunk };
  });

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
      cancelBrowserSpeech();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Lock-screen / notification / background-tab media controls. Handlers
  // are registered once and call through latestRef so they always reach
  // current behavior; nulled out on unmount so a stale session doesn't
  // linger. next/previous track only make sense for the discrete chunks
  // of server-generated audio — the browser-voice fallback reads the
  // rest of the document as a single utterance with no chunk boundaries.
  useEffect(() => {
    const session = getMediaSession();
    if (!session) return;
    session.setActionHandler('play', () => latestRef.current.resume());
    session.setActionHandler('pause', () => latestRef.current.pause());
    session.setActionHandler('stop', () => latestRef.current.stop());
    session.setActionHandler('nexttrack', () => {
      if (browserModeRef.current) return;
      stopRequestedRef.current = false;
      void latestRef.current.playChunk(latestRef.current.currentChunk + 1);
    });
    session.setActionHandler('previoustrack', () => {
      if (browserModeRef.current) return;
      stopRequestedRef.current = false;
      void latestRef.current.playChunk(Math.max(0, latestRef.current.currentChunk - 1));
    });
    return () => {
      session.setActionHandler('play', null);
      session.setActionHandler('pause', null);
      session.setActionHandler('stop', null);
      session.setActionHandler('nexttrack', null);
      session.setActionHandler('previoustrack', null);
    };
  }, []);

  // Keeps the OS media UI (lock screen, notification shade) in sync with
  // actual playback state and shows a snippet of the current chunk as
  // the title, so background/locked playback is identifiable and
  // controllable without switching back to the tab.
  useEffect(() => {
    const session = getMediaSession();
    if (!session) return;
    session.playbackState = state.status === 'playing' ? 'playing' : state.status === 'paused' ? 'paused' : 'none';
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = state.currentChunkText
        ? new MediaMetadata({ title: state.currentChunkText.slice(0, 100), artist: 'Text to Speech' })
        : null;
    }
  }, [state.status, state.currentChunkText]);

  // The functions below are intentionally plain (not useCallback): they
  // only ever run from user-triggered events (button clicks, audio
  // `onended`), never as a hook/effect dependency, so memoizing them
  // buys nothing but adds self-referential-recursion complexity.

  async function fetchChunkAudio(index: number): Promise<Blob> {
    const sessionId = sessionIdRef.current;
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
      throw new TtsRequestError(payload?.message ?? `Speech request failed (${response.status})`, payload?.error);
    }

    // A new speak() call landed while this request was in flight (e.g.
    // the user edited the text and regenerated before a prefetch
    // resolved) — don't let a stale response for the old text write
    // into the new session's chunk caches.
    if (sessionId !== sessionIdRef.current) {
      throw new TtsRequestError('Stale request from a previous session.', 'STALE_SESSION');
    }

    const provider = response.headers.get('X-TTS-Provider') as TtsProviderId | null;
    // First-write-wins: once a provider is chosen for this document (its
    // first successfully-fetched chunk), later chunks keep requesting it
    // so the voice stays consistent even if the provider recovers/flaps
    // mid-document. Without this guard, out-of-order responses from
    // concurrent prefetch/download requests could otherwise clobber the
    // committed choice with whichever happened to resolve last.
    if (provider && forcedProviderRef.current === undefined) forcedProviderRef.current = provider;

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
    // Tokenized once up front rather than inside onboundary: that handler
    // fires once per spoken word over the whole rest of the document, and
    // re-running the tokenizing regex over the full remaining text on
    // every single event is wasted work that scales with document length.
    const remainingTokens = tokenizeWords(remainingText);
    const utterance = new SpeechSynthesisUtterance(remainingText);
    utterance.rate = rateRef.current;
    // Word-highlighting in this fallback tier depends on the browser
    // actually firing word boundaries (reliable in Chrome, inconsistent
    // elsewhere) — where it doesn't fire, activeWordIndex just stays
    // null and the transcript renders without a highlight.
    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      const idx = wordIndexAtCharOffsetFromTokens(remainingTokens, event.charIndex);
      setState((s) => (s.activeWordIndex === idx ? s : { ...s, activeWordIndex: idx }));
    };
    // stop() sets stopRequestedRef before cancelling synthesis, so these
    // guards tell an explicit user-requested stop apart from the
    // utterance naturally finishing or erroring — without them, cancel()
    // asynchronously firing onerror ('canceled') would overwrite the
    // 'idle' status stop() just set with a spurious error message.
    utterance.onend = () => {
      if (stopRequestedRef.current) return;
      setState((s) => ({ ...s, status: 'done', activeWordIndex: null }));
    };
    utterance.onerror = () => {
      if (stopRequestedRef.current) return;
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Browser speech playback failed.' }));
    };

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
      } catch (err) {
        if (stopRequestedRef.current) return;
        // Only a genuine "both server-side providers are down" response
        // permanently drops the rest of the document to the browser's
        // built-in voice. Anything else — a rate limit, a stale-session
        // guard, a network blip — is transient/retryable and shouldn't
        // silently and irreversibly downgrade quality for the rest of
        // playback; surface it as a normal error instead so the user can
        // decide to retry rather than being auto-switched to a lower tier.
        if (err instanceof TtsRequestError && err.code === 'ALL_PROVIDERS_DOWN') {
          speakWithBrowser(index);
        } else {
          setState((s) => ({
            ...s,
            status: 'error',
            errorMessage: err instanceof Error ? err.message : 'Speech request failed.',
          }));
        }
        return;
      }
    }
    if (stopRequestedRef.current) return;

    const audio = audioRef.current;
    if (!audio) {
      setState((s) => ({ ...s, status: 'error', errorMessage: 'Audio player is not ready yet — try again.' }));
      return;
    }

    // A previous play of this same chunk (e.g. the user stepped back via
    // the lock-screen "previous track" control and is now replaying it)
    // already minted an object URL for this slot — revoke it before
    // overwriting, or it leaks for the rest of the tab's lifetime.
    const previousUrl = objectUrlsRef.current[index];
    if (previousUrl) URL.revokeObjectURL(previousUrl);

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
      // forcedProviderRef is always populated by now (fetchChunkAudio
      // just succeeded above), so `s.engine` only matters as a defensive
      // fallback — no need to hardcode an assumption about which tier is
      // "the" default, since that's the orchestrator's decision, not
      // this hook's.
      engine: forcedProviderRef.current ?? s.engine,
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
    sessionIdRef.current += 1;
    stopRequestedRef.current = false;
    browserModeRef.current = false;
    forcedProviderRef.current = undefined;
    voiceIdRef.current = voiceId;
    rateRef.current = rate;
    // If a previous browser-fallback utterance is still talking (e.g.
    // the user edited the text and hit Generate again without pressing
    // Stop first), cancel it — otherwise the old utterance keeps reading
    // while the newly generated server audio starts playing on top of it.
    cancelBrowserSpeech();
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
    cancelBrowserSpeech();
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
   * is unavailable while in the browser-voice fallback mode. Fetches
   * missing chunks in small concurrent batches rather than strictly
   * sequentially — real speedup for long documents, while a modest
   * concurrency cap (rather than firing all requests at once) keeps this
   * a reasonable citizen of the shared, unofficial free TTS endpoints. */
  async function download(): Promise<Blob | null> {
    if (browserModeRef.current || !chunksRef.current.length) return null;

    const DOWNLOAD_CONCURRENCY = 3;
    const missing = chunksRef.current.map((_, i) => i).filter((i) => !blobsRef.current[i]);
    for (let start = 0; start < missing.length; start += DOWNLOAD_CONCURRENCY) {
      const batch = missing.slice(start, start + DOWNLOAD_CONCURRENCY);
      const blobs = await Promise.all(batch.map((i) => fetchChunkAudio(i)));
      batch.forEach((i, j) => {
        blobsRef.current[i] = blobs[j];
      });
    }

    return new Blob(blobsRef.current as Blob[], { type: 'audio/mpeg' });
  }

  return { state, speak, stop, pause, resume, setRate, download, audioElRef: audioRef };
}
