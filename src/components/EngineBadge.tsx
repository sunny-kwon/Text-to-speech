import type { Engine } from '@/hooks/useSpeechQueue';

const LABELS: Record<Engine, string> = {
  'edge-tts': 'Microsoft Neural',
  'google-tts': 'Google Voice',
  browser: 'Browser Voice',
};

export function EngineBadge({ engine }: { engine: Engine | null }) {
  if (!engine) return null;
  const isFallback = engine !== 'edge-tts';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        isFallback
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[engine]}
    </span>
  );
}
