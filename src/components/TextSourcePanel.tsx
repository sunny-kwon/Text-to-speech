'use client';

import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { extractTextFromPdf } from '@/lib/pdf/extract';

type Tab = 'paste' | 'pdf' | 'txt';

interface Props {
  text: string;
  onTextChange: (text: string) => void;
}

export function TextSourcePanel({ text, onTextChange }: Props) {
  const [tab, setTab] = useState<Tab>('paste');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePdfFile = useCallback(
    async (file: File) => {
      setFileError(null);
      setIsExtracting(true);
      setExtractProgress({ done: 0, total: 0 });
      try {
        const extracted = await extractTextFromPdf(file, (done, total) => {
          // Throttled: a large PDF fires this once per page, and setState
          // on every single one forces a full re-render per page. Always
          // show the first and last page so feedback starts immediately
          // and the counter doesn't stall short of the true total.
          if (done === 1 || done === total || done % 3 === 0) {
            setExtractProgress({ done, total });
          }
        });
        if (!extracted.trim()) {
          setFileError('No selectable text found in this PDF (it may be scanned/image-only).');
        } else {
          onTextChange(extracted);
        }
      } catch {
        setFileError('Could not read this PDF. Try a different file.');
      } finally {
        setIsExtracting(false);
        setExtractProgress(null);
      }
    },
    [onTextChange],
  );

  const handleTxtFile = useCallback(
    async (file: File) => {
      setFileError(null);
      try {
        onTextChange(await file.text());
      } catch {
        setFileError('Could not read this file.');
      }
    },
    [onTextChange],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        void handlePdfFile(file);
      } else {
        void handleTxtFile(file);
      }
    },
    [handlePdfFile, handleTxtFile],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDropzoneKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900" role="tablist">
        {(['paste', 'pdf', 'txt'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {t === 'paste' ? 'Paste text' : t === 'pdf' ? 'Drop PDF' : 'Upload .txt'}
          </button>
        ))}
      </div>

      {tab === 'paste' && (
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste any text here…"
          rows={10}
          className="w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        />
      )}

      {tab !== 'paste' && (
        <div
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={onDropzoneKeyDown}
          role="button"
          tabIndex={0}
          aria-label={`Choose a ${tab === 'pdf' ? 'PDF' : 'text'} file, or drag and drop one here`}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-10 text-center text-sm text-zinc-500 outline-offset-2 transition-colors hover:border-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={tab === 'pdf' ? '.pdf,application/pdf' : '.txt,text/plain'}
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
          {isExtracting ? (
            <span>
              Extracting text{extractProgress?.total ? ` — page ${extractProgress.done}/${extractProgress.total}` : '…'}
            </span>
          ) : (
            <span>Drag &amp; drop a {tab === 'pdf' ? 'PDF' : '.txt file'} here, or click to browse.</span>
          )}
        </div>
      )}

      {fileError && <p className="text-sm text-red-600 dark:text-red-400">{fileError}</p>}

      {tab !== 'paste' && text && (
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          rows={8}
          className="w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        />
      )}

      <p className="text-right text-xs text-zinc-400">{text.length.toLocaleString()} characters</p>
    </div>
  );
}
