import { callSheet001 } from './callSheet001';
import type { CallSheetTemplate } from './types';

export type { CallSheetTemplate, ColumnDef, HeaderFieldDef, SectionDef } from './types';

/** Templates disponíveis. Para suportar outro tipo de call sheet, basta registá-lo aqui. */
const TEMPLATES: CallSheetTemplate[] = [callSheet001];

export const DEFAULT_TEMPLATE = callSheet001;

export function getTemplate(id: string): CallSheetTemplate {
  return TEMPLATES.find((template) => template.id === id) ?? DEFAULT_TEMPLATE;
}
