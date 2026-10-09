/** Retângulo em píxeis da imagem original. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Um valor reconhecido. `confidence` vai de 0 a 1; é `null` quando o campo
 * não foi lido pelo OCR (vazio ou criado à mão).
 */
export interface Field {
  value: string;
  confidence: number | null;
  /** O utilizador alterou ou confirmou este valor. */
  edited?: boolean;
  /** Zona da imagem original de onde o valor foi lido. */
  bbox?: BBox;
}

export type HeaderKey =
  | 'client'
  | 'competition'
  | 'event'
  | 'pf'
  | 'day'
  | 'date'
  | 'location'
  | 'means'
  | 'kickoff'
  | 'setup'
  | 'id'
  | 'crew'
  | 'missing'
  | 'lx'
  | 'pt'
  | 'departure'
  | 'origin'
  | 'notes'
  | 'footer';

export type SectionKey =
  | 'production'
  | 'clientProducer'
  | 'cameras'
  | 'realization'
  | 'evs'
  | 'ccu'
  | 'dsngRf'
  | 'assistantRealization'
  | 'anotadora'
  | 'soundOperators'
  | 'soundAssistants'
  | 'videoAssistants'
  | 'varTechnicians'
  | 'varFinal'
  | 'sky'
  | 'lighting'
  | 'graphics'
  | 'workPlan'
  | 'cablecam'
  | 'drivers'
  | 'technicalManagers'
  | 'materialManagers';

export type ColumnKey = 'number' | 'name' | 'status' | 'transPk' | 'location' | 'vehicle' | 'passengers' | 'phase' | 'time' | 'description' | 'means';

/** Uma linha de um bloco (uma pessoa). As colunas existentes dependem do bloco. */
export type SheetRow = { id: string } & Partial<Record<ColumnKey, Field>>;

/** Campo do cabeçalho que existe no documento mas não faz parte do template. */
export interface ExtraHeaderField {
  id: string;
  label: string;
  field: Field;
}

export interface CallSheetDocument {
  documentType: 'call_sheet';
  template: string;
  header: Record<HeaderKey, Field> & { others: ExtraHeaderField[] };
  sections: Record<SectionKey, SheetRow[]>;
}

export type ConfidenceLevel = 'high' | 'check' | 'low' | 'edited' | 'empty';
