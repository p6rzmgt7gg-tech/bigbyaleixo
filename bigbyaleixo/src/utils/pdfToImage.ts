/**
 * Um call sheet em PDF passa a imagem antes da leitura: a primeira página é desenhada
 * no browser (pdf.js) com resolução suficiente para o OCR. Nada sai do computador.
 */
import { PDFWorker, Util, getDocument } from 'pdfjs-dist';
import type { TextCell } from '../ocr/ocrEngine';
import { textItemsToCells, type PdfTextItem } from './pdfText';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Largura alvo da página desenhada, em píxeis. */
const TARGET_WIDTH = 2000;
const MAX_PIXELS = 14_000_000;

export async function pdfFirstPageToPng(file: File): Promise<File> {
  // (Os tipos do pdf.js não declaram `port` como Worker, embora seja o que aceita.)
  const worker = new PDFWorker({ port: new PdfWorker() } as unknown as ConstructorParameters<typeof PDFWorker>[0]);
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), worker, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    let scale = TARGET_WIDTH / Math.max(base.width, base.height * 0.75);
    if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PDF sem imagem');
    const image = new File([blob], file.name.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
    // Se o PDF tiver texto (exportado do Excel, por exemplo), usa-se esse texto em vez do OCR.
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = Util.transform(viewport.transform, item.transform);
      items.push({ text: item.str, x: tx[4], baseline: tx[5], height: Math.hypot(tx[2], tx[3]), width: item.width * viewport.scale });
    }
    const cells = textItemsToCells(items);
    if (cells.length >= 20) PDF_TEXT.set(image, cells);
    return image;
  } finally {
    await task.destroy().catch(() => undefined);
    worker.destroy();
  }
}

const PDF_TEXT = new WeakMap<File, TextCell[]>();

/** Texto do PDF (com posições na imagem desenhada) associado ao ficheiro de imagem gerado. */
export function pdfTextFor(file: File): TextCell[] | undefined {
  return PDF_TEXT.get(file);
}

