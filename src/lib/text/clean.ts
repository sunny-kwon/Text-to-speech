import Groq from 'groq-sdk';
import { withTimeout } from '@/lib/tts/withTimeout';

const TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You clean up raw text extracted from PDFs so it can be read aloud by a text-to-speech engine.
Rules:
- Fix broken line wraps, hyphenation, and stray line breaks so sentences read naturally.
- Remove page numbers, running headers/footers, and repeated boilerplate.
- Do not summarize, translate, or change the wording or meaning of the content.
- Do not add commentary, titles, or notes. Return only the cleaned text, nothing else.`;

export type CleanedBy = 'groq' | 'gemini' | null;

async function cleanWithGroq(text: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const groq = new Groq({ apiKey });
  const completion = await withTimeout(
    groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
    TIMEOUT_MS,
    'groq',
  );

  const cleaned = completion.choices[0]?.message?.content?.trim();
  if (!cleaned) throw new Error('Groq returned an empty response');
  return cleaned;
}

async function cleanWithGemini(text: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const response = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }),
    TIMEOUT_MS,
    'gemini',
  );

  if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}`);

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const cleaned = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!cleaned) throw new Error('Gemini returned an empty response');
  return cleaned;
}

/**
 * Best-effort text cleanup: Groq (free tier) -> Gemini (free tier) ->
 * pass the original text through untouched. Never throws — a broken or
 * unconfigured LLM must never block the core TTS flow.
 */
export async function cleanText(text: string): Promise<{ text: string; cleanedBy: CleanedBy }> {
  const providers: Array<[Exclude<CleanedBy, null>, () => Promise<string>]> = [
    ['groq', () => cleanWithGroq(text)],
    ['gemini', () => cleanWithGemini(text)],
  ];

  for (const [name, run] of providers) {
    try {
      const cleaned = await run();
      return { text: cleaned, cleanedBy: name };
    } catch (err) {
      // Visible in Vercel's (free) function logs. Cleanup is optional and
      // must never throw to the caller, but silently swallowing every
      // failure would make a misconfigured/expired key invisible.
      console.error(`[clean] ${name} cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { text, cleanedBy: null };
}
