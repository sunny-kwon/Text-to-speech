import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cleanText } from '@/lib/text/clean';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_TEXT_LENGTH = 6000;

const requestSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(MAX_TEXT_LENGTH, 'text is too long for a single cleanup request'),
});

const cleanRateLimiter = createRateLimiter({ prefix: 'clean', max: 15, windowSeconds: 60 });

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

  const allowed = await cleanRateLimiter.check(getClientIp(request.headers));
  if (!allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429 },
    );
  }

  // Never throws: worst case cleanedBy is null and text is passed through.
  const result = await cleanText(parsed.data.text);
  return NextResponse.json(result);
}
