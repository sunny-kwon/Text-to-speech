import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional shared-password gate for the whole app. Opt-in via
 * SITE_ACCESS_CODE — unset (the default) means no gate at all, so local
 * dev and any deploy that hasn't configured it keep working exactly as
 * before. This protects API quota from casual/opportunistic public
 * traffic, not a real authorization system — there's one shared code for
 * everyone, not per-user accounts.
 */
export const ACCESS_COOKIE_NAME = 'tts_access';

const TOKEN_MESSAGE = 'granted';

export function isGateEnabled(): boolean {
  return Boolean(process.env.SITE_ACCESS_CODE);
}

/** Equal-length constant-time compare — cheap to do properly, so there's
 * no reason not to, even though the real defense here is the rate limit
 * on the endpoint that calls this, not comparison timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isCodeCorrect(submitted: string): boolean {
  const secret = process.env.SITE_ACCESS_CODE;
  if (!secret) return false;
  return safeEqual(submitted, secret);
}

/**
 * The cookie stores an HMAC of a fixed message keyed by the secret code,
 * not the code itself — so inspecting the cookie in devtools never
 * reveals the actual password, and it can't be forged without knowing
 * the secret. Stateless by design (no session store), matching the rest
 * of this app.
 */
export function computeAccessToken(): string {
  const secret = process.env.SITE_ACCESS_CODE ?? '';
  return createHmac('sha256', secret).update(TOKEN_MESSAGE).digest('hex');
}

export function hasValidAccessCookie(cookieValue: string | undefined): boolean {
  if (!isGateEnabled() || !cookieValue) return false;
  return safeEqual(cookieValue, computeAccessToken());
}

/**
 * Defense-in-depth for routes that cost real money/quota (TTS, AI
 * cleanup): re-checks the cookie directly rather than trusting proxy.ts
 * alone. Per Next's own proxy docs, a future matcher or route change can
 * silently remove Proxy coverage, so the expensive routes verify for
 * themselves too. Returns a 401 response to short-circuit with, or null
 * if the request is authorized (or the gate isn't enabled at all).
 */
export function requireAccess(request: NextRequest): NextResponse | null {
  if (!isGateEnabled()) return null;
  const cookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (hasValidAccessCookie(cookie)) return null;
  return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Enter the access code first.' }, { status: 401 });
}
