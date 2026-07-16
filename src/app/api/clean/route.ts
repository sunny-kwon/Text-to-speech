import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cleanText } from '@/lib/text/clean';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { parseJsonBody } from '@/lib/api/parseRequest';
import { requireAccess } from '@/lib/access';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Above the client's CLEAN_BATCH_CHARS (4000, in components/TtsApp.tsx),
// so a slightly oversized batch still succeeds instead of hard-failing.
const MAX_TEXT_LENGTH = 6000;

const requestSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(MAX_TEXT_LENGTH, 'text is too long for a single cleanup request'),
});

const cleanRateLimiter = createRateLimiter({ prefix: 'clean', max: 15, windowSeconds: 60 });

export async function POST(request: NextRequest) {
  const unauthorized = requireAccess(request);
  if (unauthorized) return unauthorized;

  const parsed = await parseJsonBody(request, requestSchema);
  if (!parsed.ok) return parsed.response;

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
