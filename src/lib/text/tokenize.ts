/**
 * Word tokenizer shared by the transcript highlighter and the browser
 * SpeechSynthesis fallback. Word-boundary data (from either edge-tts's
 * timing metadata or the browser's `onboundary` charIndex) is addressed
 * by *word index*, not by character offset into the original text — this
 * turns that index into renderable segments / converts a char offset
 * into the same index space, so both sources drive the same highlight
 * logic.
 */

export interface TextToken {
  text: string;
  isWord: boolean;
}

/** Splits text into alternating word / whitespace runs, preserving the
 * exact original text when the tokens are concatenated back together. */
export function tokenizeWords(text: string): TextToken[] {
  const segments = text.match(/\S+|\s+/g) ?? [];
  return segments.map((segment) => ({ text: segment, isWord: !/^\s/.test(segment) }));
}

/** Maps a character offset into `text` to a word index (0-based, counting
 * only word tokens) — used to translate SpeechSynthesisEvent.charIndex
 * into the same addressing scheme as edge-tts's per-word timings. */
export function wordIndexAtCharOffset(text: string, charOffset: number): number {
  let cursor = 0;
  let wordIndex = -1;
  for (const token of tokenizeWords(text)) {
    if (token.isWord) {
      wordIndex++;
      if (charOffset < cursor + token.text.length) return wordIndex;
    }
    cursor += token.text.length;
  }
  return wordIndex;
}
