import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AllProvidersDownError, synthesizeSpeech } from '@/lib/tts/orchestrator';
import { getVoiceProfile } from '@/lib/tts/voices';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import type { TtsProviderId } from '@/lib/tts/types';

// Needs the Node.js runtime (edge-tts uses a WebSocket connection under
// the hood, which isn't available in the Edge runtime).
export const runtime = 'nodejs';
// Comfortable headroom over each provider's ~7s internal timeout + one
// retry, while staying inside Vercel Hobby's 60s configurable ceiling.
export const maxDuration = 30;

// A little above the client's ~600-char chunk target, so a slightly
// oversized chunk still succeeds instead of hard-failing at the edge.
const MAX_TEXT_LENGTH = 1200;

const requestSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(MAX_TEXT_LENGTH, 'text is too long for a single request'),
  voiceId: z.string().max(64).optional(),
  provider: z.enum(['edge-tts', 'google-tts']).optional(),
});

const ttsRateLimiter = createRateLimiter({ prefix: 'tts', max: 30, windowSeconds: 60 });

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

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
    const { audio, provider: usedProvider } = await synthesizeSpeech(text, voice, provider as TtsProviderId | undefined);
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-TTS-Provider': usedProvider,
      },
    });
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
