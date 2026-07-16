'use client';

import { useState, type FormEvent } from 'react';

export function EnterForm() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'rate-limited'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    try {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setStatus(response.status === 429 ? 'rate-limited' : 'error');
        return;
      }
      // Full navigation (not the client router) so the freshly-set cookie
      // is guaranteed to be picked up by the very next request.
      const next = new URLSearchParams(window.location.search).get('next') || '/';
      window.location.href = next;
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <input
        type="password"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoFocus
        placeholder="Access code"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      <button
        type="submit"
        disabled={status === 'loading' || !code}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {status === 'loading' ? 'Checking…' : 'Continue'}
      </button>
      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Incorrect code — try again.
        </p>
      )}
      {status === 'rate-limited' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Too many attempts. Try again in a few minutes.
        </p>
      )}
    </form>
  );
}
