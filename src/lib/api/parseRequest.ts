import { NextResponse, type NextRequest } from 'next/server';
import type { ZodType } from 'zod';

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Shared JSON-body parse + schema validation for API routes: reads the
 * body, returns a 400 INVALID_JSON response if it isn't valid JSON, then
 * validates against `schema` and returns a 400 INVALID_INPUT response
 * (using the first Zod issue's message) if that fails. On success,
 * returns the parsed, typed data. Used by every route so error shape and
 * status codes stay consistent by construction instead of by convention.
 */
export async function parseJsonBody<T>(request: NextRequest, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid request.' },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
