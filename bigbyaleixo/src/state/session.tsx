/**
 * Estado da sessão: a imagem carregada (apenas em memória), os dados extraídos e as
 * edições do utilizador. "Guardar dados" grava os dados estruturados no sessionStorage
 * deste separador, para sobreviverem a um recarregamento; a imagem original nunca é gravada.
 */
import type { PdfSections } from '../pdf/pdfGenerator';
import { withComputedTimes, withFixedRows } from '../templates/fixedRows';
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import type { AnalysisResult } from '../ocr/pipeline';
import { DEFAULT_TEMPLATE, getTemplate } from '../templates';
import type { CallSheetDocument, ColumnKey, ExtraHeaderField, Field, HeaderKey, SectionKey, SheetRow } from '../types/callSheet';
import { createRowId, editedField, emptyField } from '../utils/fields';

export interface SourceImage {
  file: File;
  /** URL temporário (blob:) para mostrar a imagem; vive só neste separador. */
  url: string;
  width: number;
  height: number;
}

/** Logótipo para o canto superior esquerdo do PDF (opcional). */
export interface SessionLogo {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
  /** URL temporário para mostrar o logótipo no ecrã. */
  url: string;
}

export interface SessionState {
  source: SourceImage | null;
  logo: SessionLogo | null;
  /** Mapa de câmaras do jogo (imagem), mostrado no PDF entre a logística e as observações. */
  cameraMap: SessionLogo | null;
  /** Secções opcionais a incluir no PDF. */
  pdfSections: PdfSections;
  /** Nome do ficheiro de origem (mantém-se depois de recarregar a página). */
  fileName: string | null;
  document: CallSheetDocument | null;
  /** Texto lido que não coube em nenhum campo do template. */
  unassigned: string[];
  /** Há alterações por guardar. */
  dirty: boolean;
  savedAt: number | null;
}

export type SessionAction =
  | { type: 'source-selected'; source: SourceImage }
  | { type: 'source-removed' }
  | { type: 'analysis-finished'; result: AnalysisResult }
  | { type: 'manual-started'; partial?: AnalysisResult }
  | { type: 'header-edited'; key: HeaderKey; value: string }
  | { type: 'extra-edited'; id: string; part: 'label' | 'value'; value: string }
  | { type: 'extra-added' }
  | { type: 'extra-removed'; id: string }
  | { type: 'cell-edited'; section: SectionKey; rowId: string; column: ColumnKey; value: string }
  | { type: 'row-added'; section: SectionKey }
  | { type: 'row-removed'; section: SectionKey; rowId: string }
  | { type: 'saved'; at: number }
  | { type: 'logo-set'; logo: SessionLogo }
  | { type: 'logo-removed' }
  | { type: 'camera-map-set'; image: SessionLogo }
  | { type: 'camera-map-removed' }
  | { type: 'pdf-section-toggled'; key: keyof PdfSections; include: boolean }
  | { type: 'reset' };

const STORAGE_KEY = 'big-by-aleixo:session';

interface StoredSession {
  fileName: string | null;
  document: CallSheetDocument;
  unassigned: string[];
  savedAt: number;
}

const ALL_SECTIONS: PdfSections = { logistics: true, notes: true, cameraMap: true };

const EMPTY: SessionState = { source: null, logo: null, cameraMap: null, pdfSections: ALL_SECTIONS, fileName: null, document: null, unassigned: [], dirty: false, savedAt: null };

/** Documento vazio segundo o template, para preenchimento manual. */
export function emptyDocument(): CallSheetDocument {
  const template = DEFAULT_TEMPLATE;
  return withFixedRows({
    documentType: 'call_sheet',
    template: template.id,
    header: {
      ...(Object.fromEntries(template.headerFields.map((field) => [field.key, emptyField()])) as Record<HeaderKey, Field>),
      others: [],
    },
    sections: Object.fromEntries(template.sections.map((section) => [section.key, []])) as unknown as Record<SectionKey, SheetRow[]>,
  }, template);
}

function emptyRow(section: SectionKey): SheetRow {
  const definition = DEFAULT_TEMPLATE.sections.find((candidate) => candidate.key === section);
  const row: SheetRow = { id: createRowId() };
  for (const column of definition?.columns ?? []) row[column.key] = emptyField();
  return row;
}

function editDocument(state: SessionState, edit: (document: CallSheetDocument) => CallSheetDocument): SessionState {
  if (!state.document) return state;
  return { ...state, document: edit(state.document), dirty: true };
}

function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    // O logótipo mantém-se de um call sheet para o seguinte; o mapa de câmaras é de cada jogo.
    case 'source-selected':
      return { ...EMPTY, logo: state.logo, source: action.source, fileName: action.source.file.name };
    case 'source-removed':
    case 'reset':
      return { ...EMPTY, logo: state.logo };
    case 'logo-set':
      return { ...state, logo: action.logo };
    case 'logo-removed':
      return { ...state, logo: null };
    case 'camera-map-set':
      return { ...state, cameraMap: action.image };
    case 'camera-map-removed':
      return { ...state, cameraMap: null };
    case 'pdf-section-toggled':
      return { ...state, pdfSections: { ...state.pdfSections, [action.key]: action.include } };
    case 'analysis-finished':
      return { ...state, document: action.result.document, unassigned: action.result.unassigned, dirty: false, savedAt: null };
    case 'manual-started':
      return {
        ...state,
        document: action.partial?.document ?? emptyDocument(),
        unassigned: action.partial?.unassigned ?? [],
        dirty: false,
        savedAt: null,
      };
    case 'header-edited':
      return editDocument(state, (document) => {
        const edited = { ...document, header: { ...document.header, [action.key]: editedField(action.value, document.header[action.key]) } };
        // Mudar o KO recalcula as horas deduzidas dele (montagem, testes, almoço).
        return action.key === 'kickoff' ? withComputedTimes(edited, getTemplate(document.template)) : edited;
      });
    case 'extra-edited':
      return editDocument(state, (document) => ({
        ...document,
        header: {
          ...document.header,
          others: document.header.others.map((extra): ExtraHeaderField => {
            if (extra.id !== action.id) return extra;
            return action.part === 'label' ? { ...extra, label: action.value } : { ...extra, field: editedField(action.value, extra.field) };
          }),
        },
      }));
    case 'extra-added':
      return editDocument(state, (document) => ({
        ...document,
        header: { ...document.header, others: [...document.header.others, { id: createRowId(), label: '', field: { ...emptyField(), edited: true } }] },
      }));
    case 'extra-removed':
      return editDocument(state, (document) => ({
        ...document,
        header: { ...document.header, others: document.header.others.filter((extra) => extra.id !== action.id) },
      }));
    case 'cell-edited':
      return editDocument(state, (document) => ({
        ...document,
        sections: {
          ...document.sections,
          [action.section]: document.sections[action.section].map((row) =>
            row.id === action.rowId ? { ...row, [action.column]: editedField(action.value, row[action.column]) } : row,
          ),
        },
      }));
    case 'row-added':
      return editDocument(state, (document) => ({
        ...document,
        sections: { ...document.sections, [action.section]: [...document.sections[action.section], emptyRow(action.section)] },
      }));
    case 'row-removed':
      return editDocument(state, (document) => ({
        ...document,
        sections: { ...document.sections, [action.section]: document.sections[action.section].filter((row) => row.id !== action.rowId) },
      }));
    case 'saved':
      return { ...state, dirty: false, savedAt: action.at };
  }
}

const LOGO_KEY = 'big-by-aleixo:logo';
const CAMERA_MAP_KEY = 'big-by-aleixo:camera-map';

function loadImage(key: string): SessionLogo | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const { type, data } = JSON.parse(raw) as { type: 'png' | 'jpg'; data: string };
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    return { type, bytes, url: URL.createObjectURL(new Blob([bytes], { type: type === 'png' ? 'image/png' : 'image/jpeg' })) };
  } catch {
    return null;
  }
}

function storeImage(key: string, logo: SessionLogo | null): void {
  try {
    if (!logo) {
      window.sessionStorage.removeItem(key);
      return;
    }
    let binary = '';
    for (let i = 0; i < logo.bytes.length; i += 0x8000) binary += String.fromCharCode(...logo.bytes.subarray(i, i + 0x8000));
    window.sessionStorage.setItem(key, JSON.stringify({ type: logo.type, data: btoa(binary) }));
  } catch {
    // Sem espaço ou sem acesso: a imagem fica só em memória.
  }
}

function loadStored(): SessionState {
  const base = loadStoredDocument();
  return { ...base, logo: loadImage(LOGO_KEY), cameraMap: base.document ? loadImage(CAMERA_MAP_KEY) : null };
}

function loadStoredDocument(): SessionState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const stored = JSON.parse(raw) as StoredSession;
    if (stored.document?.documentType !== 'call_sheet') return EMPTY;
    return { ...EMPTY, fileName: stored.fileName, document: stored.document, unassigned: stored.unassigned ?? [], savedAt: stored.savedAt };
  } catch {
    return EMPTY;
  }
}

/** Grava os dados estruturados neste separador. Devolve `false` se o browser não o permitir. */
export function saveSession(state: SessionState, at: number): boolean {
  if (!state.document) return false;
  try {
    const stored: StoredSession = { fileName: state.fileName, document: state.document, unassigned: state.unassigned, savedAt: at };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

function clearStored(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sem acesso ao armazenamento: não há nada para limpar.
  }
}

const SessionContext = createContext<{ state: SessionState; dispatch: Dispatch<SessionAction> } | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadStored);

  // A imagem vive num URL temporário; liberta-o quando é substituída ou removida.
  const url = state.source?.url ?? null;
  const previousUrl = useRef<string | null>(null);
  useEffect(() => {
    if (previousUrl.current && previousUrl.current !== url) URL.revokeObjectURL(previousUrl.current);
    previousUrl.current = url;
  }, [url]);

  const logo = state.logo;
  useEffect(() => {
    storeImage(LOGO_KEY, logo);
  }, [logo]);

  const cameraMap = state.cameraMap;
  useEffect(() => {
    storeImage(CAMERA_MAP_KEY, cameraMap);
  }, [cameraMap]);

  // Um novo carregamento (ou recomeçar) invalida os dados guardados.
  useEffect(() => {
    if (!state.document) clearStored();
  }, [state.document]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): { state: SessionState; dispatch: Dispatch<SessionAction> } {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession tem de ser usado dentro de SessionProvider');
  return context;
}
