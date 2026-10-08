import type { ColumnKey, ConfidenceLevel, Field, SheetRow } from '../types/callSheet';

export const HIGH_CONFIDENCE = 0.9;
export const CHECK_CONFIDENCE = 0.7;

export function emptyField(): Field {
  return { value: '', confidence: null };
}

/** Campo escrito ou confirmado pelo utilizador. */
export function editedField(value: string, previous?: Field): Field {
  return { value, confidence: previous?.confidence ?? null, edited: true, bbox: previous?.bbox };
}

let rowCounter = 0;

export function createRowId(): string {
  rowCounter += 1;
  return `row-${Date.now().toString(36)}-${rowCounter}`;
}

/**
 * Nível de confiança de um campo:
 *  ≥ 0,90 alta · 0,70–0,89 confirmar · < 0,70 não reconhecido.
 * Um campo editado pelo utilizador conta como confirmado; um campo vazio não tem nível.
 */
export function confidenceLevel(field: Field | undefined): ConfidenceLevel {
  if (!field) return 'empty';
  if (field.edited) return 'edited';
  if (field.value === '' || field.confidence === null) return 'empty';
  if (field.confidence >= HIGH_CONFIDENCE) return 'high';
  if (field.confidence >= CHECK_CONFIDENCE) return 'check';
  return 'low';
}

export const LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: 'Alta confiança',
  check: 'Confirmar',
  low: 'Não reconhecido',
  edited: 'Editado',
  empty: '',
};

/** Nível de uma linha: o pior dos seus campos. Uma linha lida pelo OCR sem nome conta como não reconhecida. */
export function rowLevel(row: SheetRow, columns: ColumnKey[]): ConfidenceLevel {
  const levels = columns.map((column) => confidenceLevel(row[column]));
  if (levels.includes('low')) return 'low';
  if (levels.includes('check')) return 'check';
  if (levels.includes('high')) return row.name && row.name.value === '' && !row.name.edited ? 'low' : 'high';
  return levels.includes('edited') ? 'edited' : 'empty';
}

/** Precisa de atenção do utilizador? */
export function needsReview(level: ConfidenceLevel): boolean {
  return level === 'check' || level === 'low';
}
