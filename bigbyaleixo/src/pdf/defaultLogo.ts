/** Logótipo usado por omissão no canto superior esquerdo do PDF (Medialuso). */
import url from './medialuso-logo.png?url';
import type { PdfLogo } from './pdfGenerator';

export const DEFAULT_LOGO_URL = url;

let cached: Promise<PdfLogo | null> | null = null;

/** Nunca falha: sem o ficheiro, o PDF usa a marca BIG. */
export function loadDefaultLogo(): Promise<PdfLogo | null> {
  cached ??= fetch(url)
    .then(async (response) => (response.ok ? { bytes: new Uint8Array(await response.arrayBuffer()), type: 'png' as const } : null))
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}
