'use client';

/**
 * Extracts text from a PDF entirely in the browser (pdf.js). Nothing is
 * uploaded to a server: this keeps documents private and avoids Vercel
 * serverless function costs/limits for potentially large files.
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (pagesDone: number, totalPages: number) => void,
): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pageTexts.push(pageText);
    onProgress?.(pageNumber, pdf.numPages);
    page.cleanup();
  }

  await loadingTask.destroy();
  return pageTexts.filter(Boolean).join('\n\n');
}
