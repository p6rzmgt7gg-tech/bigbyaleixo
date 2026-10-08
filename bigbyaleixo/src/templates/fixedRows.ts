import type { CallSheetDocument, Field, SheetRow } from '../types/callSheet';
import { createRowId } from '../utils/fields';
import type { CallSheetTemplate } from './types';

/** Hora deduzida (do KO): fica em "Confirmar", como os outros valores deduzidos. */
export const COMPUTED_TIME_CONFIDENCE = 0.89;

const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** "15:30", "15h30", "15.30" → minutos desde a meia-noite. */
export function parseClock(text: string): number | null {
  const match = /^\s*(\d{1,2})\s*[:h.]\s*(\d{2})\s*$/i.exec(text) ?? /^\s*(\d{1,2})\s*h\s*$/i.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const day = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
}

/** Uma linha conta como a linha fixa quando um dos seus campos é exatamente um dos rótulos ("Testes", mas não "Teste de VAR"). */
function matches(row: SheetRow, aliases: string[]): boolean {
  return Object.entries(row)
    .filter(([key]) => key !== 'id')
    .some(([, field]) => aliases.includes(plain((field as Field | undefined)?.value ?? '')));
}

/**
 * Acrescenta, no início ou no fim de cada bloco, as linhas fixas do template que o documento ainda não tem,
 * e preenche-lhes a hora a partir do KO. Não altera o documento recebido.
 */
export function withFixedRows(document: CallSheetDocument, template: CallSheetTemplate): CallSheetDocument {
  let sections = document.sections;
  for (const section of template.sections) {
    if (!section.fixedRows?.length) continue;
    const rows = sections[section.key] ?? [];
    const missing = section.fixedRows.filter((fixed) => !rows.some((row) => matches(row, fixed.aliases)));
    if (missing.length === 0) continue;
    const build = (fixed: (typeof missing)[number]): SheetRow => {
      const row: SheetRow = { id: createRowId() };
      for (const column of section.columns) {
        const value = fixed.values[column.key];
        row[column.key] = value === undefined ? { value: '', confidence: null } : { value, confidence: 1 };
      }
      return row;
    };
    const atStart = missing.filter((fixed) => fixed.position !== 'end').map(build);
    const atEnd = missing.filter((fixed) => fixed.position === 'end').map(build);
    sections = { ...sections, [section.key]: [...atStart, ...rows, ...atEnd] };
  }
  const next = sections === document.sections ? document : { ...document, sections };
  return withComputedTimes(next, template);
}

/**
 * Horas das linhas fixas calculadas a partir do KO (ex.: montagem 5 h antes).
 * Só mexe em horas vazias ou que já tinham sido calculadas; uma hora lida ou escrita pelo utilizador fica.
 */
export function withComputedTimes(document: CallSheetDocument, template: CallSheetTemplate): CallSheetDocument {
  const kickoff = parseClock(document.header.kickoff?.value ?? '');
  let sections = document.sections;
  for (const section of template.sections) {
    const timed = section.fixedRows?.filter((fixed) => fixed.minutesFromKickoff !== undefined) ?? [];
    if (timed.length === 0) continue;
    const rows = sections[section.key] ?? [];
    let changed = false;
    const updated = rows.map((row) => {
      const fixed = timed.find((candidate) => matches(row, candidate.aliases));
      if (!fixed) return row;
      const time = row.time;
      const computed = !time || time.value === '' || (!time.edited && time.confidence === COMPUTED_TIME_CONFIDENCE);
      if (!computed) return row;
      const next: Field = kickoff === null ? { value: '', confidence: null } : { value: formatClock(kickoff + (fixed.minutesFromKickoff ?? 0)), confidence: COMPUTED_TIME_CONFIDENCE };
      if (time?.value === next.value && time.confidence === next.confidence) return row;
      changed = true;
      return { ...row, time: next };
    });
    if (changed) sections = { ...sections, [section.key]: updated };
  }
  return sections === document.sections ? document : { ...document, sections };
}
