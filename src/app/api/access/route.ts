import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS_COOKIE_NAME, computeAccessToken, isCodeCorrect, isGateEnabled } from '@/lib/access';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';
import { parseJsonBody } from '@/lib/api/parseRequest';

export const runtime = 'nodejs';

const requestSchema = z.object({
  code: z.string().min(1).max(200),
});

// This endpoint exists specifically to be guessed against, so the limit
// here is deliberately tighter than the TTS/clean routes — a handful of
// attempts every few minutes is enough for a real person who mistyped,
// but turns brute-forcing even a common word into impractical.
const accessRateLimiter = createRateLimiter({ prefix: 'access', max: 10, windowSeconds: 300 });

export async function POST(request: NextRequest) {
  if (!isGateEnabled()) {
    return NextResponse.json({ error: 'GATE_DISABLED', message: 'No access code is configured.' }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, requestSchema);
  if (!parsed.ok) return parsed.response;

  const allowed = await accessRateLimiter.check(getClientIp(request.headers));
  if (!allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
      { status: 429 },
    );
  }

  if (!isCodeCorrect(parsed.data.code)) {
    return NextResponse.json({ error: 'INCORRECT_CODE', message: 'Incorrect code.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE_NAME, computeAccessToken(), {
    httpOnly: true,
    // Plain HTTP locally (no TLS), so a Secure-flagged cookie would
    // never actually get sent back — only require it in production.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}
