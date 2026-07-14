/**
 * Isomorphic (client + server) text chunker. Splits arbitrary text into
 * sentence-aware chunks close to `targetChars`, without ever cutting a
 * word in half. Reused both for TTS request sizing and for batching text
 * sent to the optional AI cleanup endpoint.
 */

const PARAGRAPH_SPLIT = /\n{2,}/;
// Split after sentence-ending punctuation followed by whitespace and a
// capital/quote/number, or on any remaining single newline.
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'(‘“])|\n+/;

function splitIntoSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(SENTENCE_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [trimmed];
}

/** Force-splits a segment with no usable punctuation on word boundaries. */
function splitLongSegment(segment: string, maxChars: number): string[] {
  if (segment.length <= maxChars) return [segment];

  const words = segment.split(/\s+/);
  const pieces: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkText(rawText: string, targetChars = 600): string[] {
  const hardMax = Math.round(targetChars * 1.4);
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(PARAGRAPH_SPLIT);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    const sentences = splitIntoSentences(paragraph).flatMap((sentence) =>
      splitLongSegment(sentence, hardMax),
    );

    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > targetChars && current) {
        flush();
        current = sentence;
      } else {
        current = candidate;
      }
    }
  }
  flush();

  return chunks;
}
