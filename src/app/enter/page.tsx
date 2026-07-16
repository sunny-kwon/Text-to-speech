import type { Metadata } from 'next';
import { EnterForm } from './EnterForm';

export const metadata: Metadata = {
  title: 'Enter access code — Text to Speech',
};

export default function EnterPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Enter access code</h1>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        This app is shared with a small group. Enter the code you were given.
      </p>
      <EnterForm />
    </div>
  );
}
