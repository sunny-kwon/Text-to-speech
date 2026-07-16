import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AllProvidersDownError, synthesizeSpeech } from '@/lib/tts/orchestrator';
import { getVoiceProfile } from '@/lib/tts/voices';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { parseJsonBody } from '@/lib/api/parseRequest';
import { requireAccess } from '@/lib/access';
import type { CompactWordTiming, TtsProviderId, WordTiming } from '@/lib/tts/types';

// Needs the Node.js runtime (edge-tts uses a WebSocket connection under
// the hood, which isn't available in the Edge runtime).
export const runtime = 'nodejs';
// Comfortable headroom over each provider's ~7s internal timeout + one
// retry, while staying inside Vercel Hobby's 60s configurable ceiling.
export const maxDuration = 30;

// A little above the client's ~600-char chunk target (CHUNK_TARGET_CHARS
// in hooks/useSpeechQueue.ts, hard-capped there at 1.4x = 840), so a
// slightly oversized chunk still succeeds instead of hard-failing at the
// edge. Keep this comfortably above that hard cap if either constant
// changes — a smaller margin risks legitimate chunks getting rejected.
const MAX_TEXT_LENGTH = 1200;

const requestSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(MAX_TEXT_LENGTH, 'text is too long for a single request'),
  voiceId: z.string().max(64).optional(),
  provider: z.enum(['edge-tts', 'google-tts']).optional(),
});

const ttsRateLimiter = createRateLimiter({ prefix: 'tts', max: 30, windowSeconds: 60 });

// Defensive cap on the word-boundary header. Highlighting is a nice-to-have
// enhancement layered on top of the audio response and must never be able
// to break audio delivery, so if a pathological chunk somehow produces an
// oversized payload, we just drop the header instead of risking the
// response failing.
const MAX_BOUNDARY_HEADER_LENGTH = 6000;

/** Encodes word timings as compact [startSec, endSec] pairs (2dp) rather
 * than full JSON objects, then base64s the UTF-8 bytes for safe header
 * transport. Returns null if empty or unexpectedly large. */
function encodeWordBoundaries(wordBoundaries: WordTiming[]): string | null {
  if (!wordBoundaries.length) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const compact: CompactWordTiming[] = wordBoundaries.map((w) => [round2(w.startSec), round2(w.endSec)]);
  const encoded = Buffer.from(JSON.stringify(compact), 'utf-8').toString('base64');
  return encoded.length <= MAX_BOUNDARY_HEADER_LENGTH ? encoded : null;
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAccess(request);
  if (unauthorized) return unauthorized;

  const parsed = await parseJsonBody(request, requestSchema);
  if (!parsed.ok) return parsed.response;

  const allowed = await ttsRateLimiter.check(getClientIp(request.headers));
  if (!allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429 },
    );
  }

  const { text, voiceId, provider } = parsed.data;
  const voice = getVoiceProfile(voiceId);

  try {
    const { audio, provider: usedProvider, wordBoundaries } = await synthesizeSpeech(
      text,
      voice,
      provider as TtsProviderId | undefined,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-TTS-Provider': usedProvider,
    };
    const encodedBoundaries = encodeWordBoundaries(wordBoundaries);
    if (encodedBoundaries) headers['X-TTS-Word-Boundaries'] = encodedBoundaries;

    return new NextResponse(new Uint8Array(audio), { status: 200, headers });
  } catch (err) {
    if (err instanceof AllProvidersDownError) {
      return NextResponse.json(
        {
          error: 'ALL_PROVIDERS_DOWN',
          message: 'Server-side voice generation is temporarily unavailable.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error generating speech.' }, { status: 500 });
  }
}
