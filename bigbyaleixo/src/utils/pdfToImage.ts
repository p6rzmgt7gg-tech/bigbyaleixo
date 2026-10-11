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

export async function pdfFirstPageToPng(file: File, options: { trim?: boolean } = {}): Promise<File> {
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
    const output = options.trim ? trimWhite(canvas) : canvas;
    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'));
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


/** Corta as margens brancas à volta do conteúdo (ex.: o mapa de câmaras numa página A4). */
function trimWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const context = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return canvas;
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width, x1 + pad);
  y1 = Math.min(height, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
