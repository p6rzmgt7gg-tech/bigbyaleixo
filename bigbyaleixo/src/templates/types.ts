import type { ColumnKey, HeaderKey, SectionKey } from '../types/callSheet';

/** O que se espera encontrar num campo do cabeçalho. */
export type HeaderFieldKind = 'text' | 'code' | 'count' | 'date' | 'place' | 'time' | 'note';

/** Onde o campo aparece no documento. */
export type HeaderGroup = 'title' | 'info' | 'logistics' | 'notes';

export interface HeaderFieldDef {
  key: HeaderKey;
  label: string;
  /** Rótulos (já normalizados) que identificam o campo no documento. */
  aliases: string[];
  kind: HeaderFieldKind;
  group: HeaderGroup;
}

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Rótulos (normalizados) do cabeçalho da coluna. */
  aliases: string[];
  align: 'left' | 'center';
  /** Largura relativa, usada no ecrã e no PDF. */
  weight: number;
}

/**
 * Como o bloco se apresenta:
 *  - `role`: cargo e nome numa linha ("Produtor  JOÃO CORREIA"), dentro de um grupo (Equipa, Técnica);
 *  - `list`: lista numerada de pessoas com estado e local (Câmaras, EVS, …);
 *  - `table`: tabela própria (plano de trabalho, logística).
 */
export type SectionLayout = 'role' | 'list' | 'table';

export interface SectionGroup {
  key: string;
  title: string;
}

export interface SectionDef {
  key: SectionKey;
  title: string;
  layout: SectionLayout;
  /** Nome do cargo numa linha `role` ("Produtor", "Chefe Técnico"). */
  roleLabel?: string;
  /** Grupo onde o bloco aparece (os blocos `role` partilham um título de grupo). */
  group?: string;
  /** Rótulos (normalizados) que identificam o bloco no documento. */
  aliases: string[];
  columns: ColumnDef[];
  /**
   * Linhas que o bloco tem sempre, no início ou no fim (ex.: Início da montagem, Testes, Almoço; Desmontagem).
   * Só se acrescentam se o documento ainda não as tiver; os outros campos (a hora) ficam por preencher.
   */
  fixedRows?: {
    values: Partial<Record<ColumnKey, string>>;
    aliases: string[];
    /** Hora da linha em relação ao KO, em minutos (negativo = antes). Fica em "Confirmar". */
    minutesFromKickoff?: number;
    /** No início (por omissão) ou no fim do bloco. */
    position?: 'start' | 'end';
  }[];
}

/**
 * Um template descreve um tipo de call sheet: que campos e blocos tem e como
 * reconhecê-los. A interface, o parser e o PDF são conduzidos por esta descrição,
 * por isso suportar outro tipo de documento é acrescentar outro template.
 */
export interface CallSheetTemplate {
  id: string;
  name: string;
  headerFields: HeaderFieldDef[];
  sections: SectionDef[];
  /** Títulos dos grupos de blocos `role`, pela ordem em que aparecem. */
  groups: SectionGroup[];
  /** Bloco cujas linhas podem vir como "Câm 3" (função + número). */
  numberedRoleSection: SectionKey;
  /** Rótulos da coluna que contém a função (quando a função está em cada linha). */
  roleColumnAliases: string[];
  /** Valores típicos (normalizados) de cada coluna, para a classificar quando não há cabeçalho. */
  vocabulary: Partial<Record<ColumnKey, string[]>>;
  /** Títulos genéricos que não são o nome do evento. */
  genericTitles: string[];
}
