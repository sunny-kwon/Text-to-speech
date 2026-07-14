# Text to Speech

Paste text or drop a PDF, pick a voice, and listen. Free to run and free to host — no paid APIs, no accounts required for the core flow.

## How it stays free and resilient

Speech is generated through a **3-tier fallback chain**, so one provider going down doesn't take the app down:

1. **`edge-tts`** — Microsoft Edge's neural voices (unofficial, free, no API key). High quality; the default.
2. **`google-tts`** — Google Translate's TTS endpoint (unofficial, free, no API key). Different vendor/origin than tier 1, so a Microsoft-side outage doesn't affect it too.
3. **Browser `SpeechSynthesis`** — the user's own browser voice. Zero network dependency, so it always works even if both server-side providers are unreachable. (Downloadable MP3 isn't available in this mode, since there's no audio file to hand back.)

A short-lived "circuit breaker" flag (shared via Upstash Redis when configured, otherwise scoped to a single warm serverless instance) means once a provider fails, every other concurrent request skips straight past it instead of separately waiting out a timeout — and a document keeps using whichever provider handled its first chunk, so the voice doesn't change mid-playback.

An **optional** "clean up text with AI" toggle fixes PDF-extraction artifacts (broken line wraps, hyphenation, stray headers/footers) before narration, via its own free-tier fallback chain: **Groq → Gemini → skip cleanup and use the original text**. This never blocks speech generation — if both are unset or fail, the app just narrates the original extracted text.

PDF text extraction runs entirely **client-side** (pdf.js) — files are never uploaded to a server.

## Word-highlight-as-you-read

`edge-tts` exposes per-word timing metadata from the underlying Azure service, which the app uses to highlight the word currently being spoken in a live transcript view. Word boundaries are sent from `/api/tts` as a compact, size-capped header alongside the audio (never inline in a JSON body, so a missing/oversized boundary payload can never break audio delivery), decoded client-side, and matched to playback time via the `<audio>` element's `timeupdate` event. Availability by tier:
- **edge-tts**: full support (real timing data).
- **google-tts**: no timing metadata exists for this endpoint — transcript shows with no highlight.
- **Browser fallback**: uses `SpeechSynthesisUtterance.onboundary`, which Chrome supports reliably but other browsers implement inconsistently — highlight may not appear there, transcript still does.

## Other UX features

- **Remembers your place** — text, voice, speed, and the AI-cleanup toggle persist to `localStorage` (debounced, so pasting a large document doesn't hammer it), restored on your next visit.
- **Lock-screen / background controls** — wired to the Media Session API, so play/pause/stop/next-segment/previous-segment work from the OS media UI and playback continues in a backgrounded tab. Falls back gracefully (no-op) on browsers without support.
- **Voice preview** — a 🔊 button next to the voice picker plays a short sample before you commit to generating the whole document.

## Environment variables

Every variable is optional. See [`.env.example`](./.env.example). With none of them set, the app runs at full capability except:
- the circuit breaker/rate limiter fall back to per-instance in-memory state instead of a shared one, and
- the AI cleanup toggle has nothing to call and simply passes text through unchanged.

| Variable | Purpose | Free tier |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared circuit breaker + per-IP rate limiting | [upstash.com](https://upstash.com) — 500K commands/mo |
| `GROQ_API_KEY` (+ optional `GROQ_MODEL`) | Primary AI text cleanup | [console.groq.com](https://console.groq.com) — no credit card |
| `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`) | Secondary AI text cleanup | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful checks (also what CI runs on every push/PR — see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)):

```bash
npm run typecheck   # tsc --noEmit
npm run lint          # eslint
npm test               # unit tests (Node's built-in test runner, no extra deps)
npm run build           # production build
```

Unit tests cover the pure-logic modules — the sentence-aware chunker (`lib/text/chunk.ts`) and the word-index tokenizer (`lib/text/tokenize.ts`) — since those are cheap to test and easy to quietly break. The provider/orchestrator/fallback-chain code is deliberately left to integration-level verification (real network calls to unofficial third-party TTS endpoints aren't practical to unit test meaningfully).

## Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. (Optional) add the environment variables above in the Vercel project settings.
3. Deploy — Hobby (free) plan is sufficient. `/api/tts` and `/api/clean` run as Node.js serverless functions with `maxDuration: 30`, comfortably inside Hobby's configurable ceiling.

No database, no auth, and no persistent storage are required — the app is fully stateless.

## Project structure

```
src/
  app/
    api/tts/route.ts      # POST text -> MP3, runs the provider fallback chain
    api/clean/route.ts    # POST text -> AI-cleaned text (or passthrough)
    page.tsx               # renders <TtsApp />
  components/              # UI: text input, voice/speed controls, player bar,
                            # transcript/highlight view
  hooks/useSpeechQueue.ts   # client-side chunk queue, prefetching, provider
                            # tracking, word-highlight sync, and the
                            # browser-voice last resort
  lib/
    tts/
      orchestrator.ts       # tier 1 -> tier 2 cascade + circuit breaker
      providers/             # edge-tts (+ word timings) / google-tts wrappers
      circuitBreaker.ts, voices.ts, types.ts
    text/
      chunk.ts               # sentence-aware chunker (shared client+server)
      clean.ts                # Groq -> Gemini -> passthrough
      tokenize.ts             # word-index tokenizer shared by the
                              # highlighter and the browser-fallback boundary
                              # mapping
    pdf/extract.ts           # client-side PDF text extraction (pdf.js)
    kv.ts, rateLimit.ts       # Upstash-backed, with in-memory fallback
```

## Known limitations

- `edge-tts` and the Google Translate TTS endpoint are **unofficial, reverse-engineered APIs**, not sanctioned by Microsoft/Google. They're stable and widely used, but could break or get rate-limited if the underlying service changes — that's exactly what the fallback chain is designed to absorb.
- PDF extraction only pulls selectable text; scanned/image-only PDFs won't produce any text (no OCR).
- Downloading an MP3 is unavailable while the app has fallen back to the browser's built-in voice, since that mode produces no audio file.
