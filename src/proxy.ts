import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAccess } from '@/lib/access';

// Note: `runtime` cannot be configured here — Proxy always runs on the
// Node.js runtime in this Next.js version (setting it throws).
export function proxy(request: NextRequest) {
  // API routes get a plain 401 (a redirect would return HTML to a fetch()
  // call expecting JSON/audio, which the client can't do anything useful
  // with). /api/tts and /api/clean also re-check the cookie themselves via
  // this same helper — Proxy coverage can silently gap on a future
  // matcher/route change, so the expensive routes don't rely on this
  // layer alone.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return requireAccess(request) ?? NextResponse.next();
  }

  const unauthorized = requireAccess(request);
  if (!unauthorized) return NextResponse.next();

  const url = new URL('/enter', request.url);
  url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except the unlock page itself, the code-check endpoint
    // (both would otherwise redirect-loop or become unreachable), and
    // Next's own static/image assets and favicon (excluding these avoids
    // accidentally blocking the CSS/JS the unlock page itself needs).
    '/((?!enter|api/access|_next/static|_next/image|favicon.ico).*)',
  ],
};
