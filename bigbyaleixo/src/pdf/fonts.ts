/** Fontes do PDF (Barlow Condensed, licença OFL), servidas pela própria aplicação. */
import bold from './fonts/BarlowCondensed-700.ttf?url';
import medium from './fonts/BarlowCondensed-500.ttf?url';
import regular from './fonts/BarlowCondensed-400.ttf?url';
import semibold from './fonts/BarlowCondensed-600.ttf?url';
import type { PdfFonts } from './pdfGenerator';

let cached: Promise<PdfFonts> | null = null;

async function load(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fonte indisponível: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

export function loadPdfFonts(): Promise<PdfFonts> {
  cached ??= Promise.all([load(regular), load(medium), load(semibold), load(bold)])
    .then(([r, m, s, b]) => ({ regular: r, medium: m, semibold: s, bold: b }))
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached;
}
