/** Conversão de células lidas em campos do documento. */
import type { Field } from '../../types/callSheet';
import { combinedConfidence, type OcrWord } from '../ocrEngine';
import type { LayoutCell } from './geometry';
import { isPlainNumber } from './text';

/** Uma leitura deduzida do contexto (e não lida diretamente) fica sempre para confirmar. */
export const INFERRED_CONFIDENCE = 0.89;

export function cellField(cell: LayoutCell): Field {
  return { value: cell.text, confidence: cell.source.confidence, bbox: cell.source.bbox };
}

/** Campo a partir de algumas palavras de uma célula (ex.: o valor em "PF 26.1042"). */
export function wordsField(words: OcrWord[]): Field {
  return {
    value: words.map((word) => word.text).join(' '),
    confidence: combinedConfidence(words),
    bbox: {
      x0: Math.min(...words.map((word) => word.bbox.x0)),
      y0: Math.min(...words.map((word) => word.bbox.y0)),
      x1: Math.max(...words.map((word) => word.bbox.x1)),
      y1: Math.max(...words.map((word) => word.bbox.y1)),
    },
  };
}

/** Letras que o OCR devolve no lugar de um algarismo isolado numa célula. */
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2',
  S: '5', s: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
};

/**
 * Leitura numérica de uma célula curta. Um "0" sozinho é quase sempre lido como "O":
 * num campo que só pode ser um número, a letra é trocada pelo algarismo parecido e o
 * valor fica para confirmar.
 */
export function numericField(cell: LayoutCell): Field | null {
  if (isPlainNumber(cell.text)) return cellField(cell);
  if (cell.text.length > 2) return null;
  let digits = '';
  for (const character of cell.text) {
    const digit = /\d/.test(character) ? character : DIGIT_LOOKALIKES[character];
    if (digit === undefined) return null;
    digits += digit;
  }
  return { value: digits, confidence: Math.min(cell.source.confidence, INFERRED_CONFIDENCE), bbox: cell.source.bbox };
}
