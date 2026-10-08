import type { CallSheetDocument } from '../types/callSheet';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('pt-PT', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export function formatDimensions(width: number, height: number): string {
  return `${width} × ${height} px`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString('pt-PT')} ${date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Texto seguro para nomes de ficheiro: sem acentos, espaços ou símbolos. */
export function slugify(text: string, maxLength = 60): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/**
 * Nome do PDF: BIGbyAleixo_[evento]_[data].pdf, ou BIGbyAleixo_[data].pdf sem evento.
 * Se o documento não tiver data, usa-se o dia em que o PDF é gerado.
 */
export function pdfFileName(document: CallSheetDocument, now: Date = new Date()): string {
  const event = slugify(document.header.event.value);
  const date = slugify(document.header.date.value) || now.toISOString().slice(0, 10);
  return ['BIGbyAleixo', event, date].filter(Boolean).join('_') + '.pdf';
}
