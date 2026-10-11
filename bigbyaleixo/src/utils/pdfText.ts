/** Texto de um PDF (pedaços com posição) convertido em células, como as do OCR. */
import type { TextCell } from '../ocr/ocrEngine';

export interface PdfTextItem {
  text: string;
  /** Início do texto, em píxeis da imagem desenhada. */
  x: number;
  /** Linha de base. */
  baseline: number;
  height: number;
  width: number;
}

/** Junta os pedaços de texto do PDF em células (texto contíguo na mesma linha), como as do OCR. */
export function textItemsToCells(items: PdfTextItem[]): TextCell[] {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const groups: PdfTextItem[][] = [];
  for (const item of sorted) {
    const group = groups.find((candidate) => {
      const last = candidate[candidate.length - 1];
      const h = Math.max(last.height, item.height);
      return Math.abs(last.baseline - item.baseline) < h * 0.3 && item.x - (last.x + last.width) < h * 0.6 && item.x >= last.x;
    });
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const h = Math.max(...group.map((item) => item.height));
    const top = Math.min(...group.map((item) => item.baseline)) - h * 0.78;
    const bottom = Math.max(...group.map((item) => item.baseline)) + h * 0.22;
    const words = group.flatMap((item) => {
      const parts = item.text.split(/(\s+)/);
      const perChar = item.width / Math.max(1, item.text.length);
      let offset = 0;
      const out: TextCell['words'] = [];
      for (const part of parts) {
        if (part.trim()) out.push({ text: part, confidence: 0.99, bbox: { x0: item.x + offset * perChar, y0: top, x1: item.x + (offset + part.length) * perChar, y1: bottom } });
        offset += part.length;
      }
      return out;
    });
    const x0 = Math.min(...group.map((item) => item.x));
    const x1 = Math.max(...group.map((item) => item.x + item.width));
    return {
      text: words.map((word) => word.text).join(' '),
      confidence: 0.99,
      bbox: { x0: Math.floor(x0), y0: Math.floor(top), x1: Math.ceil(x1), y1: Math.ceil(bottom) },
      words: words.map((word) => ({ ...word, bbox: { x0: Math.floor(word.bbox.x0), y0: Math.floor(word.bbox.y0), x1: Math.ceil(word.bbox.x1), y1: Math.ceil(word.bbox.y1) } })),
    };
  });
}
