'use client';

import { useEffect, useRef } from 'react';
import { tokenizeWords } from '@/lib/text/tokenize';

interface Props {
  text: string;
  activeWordIndex: number | null;
}

export function TranscriptView({ text, activeWordIndex }: Props) {
  const activeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeWordIndex]);

  if (!text) return null;

  const tokens = tokenizeWords(text);
  let wordIndex = -1;

  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      {tokens.map((token, i) => {
        if (token.isWord) wordIndex++;
        const isActive = token.isWord && wordIndex === activeWordIndex;
        return (
          <span
            key={i}
            ref={isActive ? activeRef : undefined}
            className={
              isActive
                ? 'rounded bg-amber-200 text-zinc-900 dark:bg-amber-400/30 dark:text-zinc-50'
                : undefined
            }
          >
            {token.text}
          </span>
        );
      })}
    </div>
  );
}
