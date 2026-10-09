/**
 * Interpretação do texto reconhecido: recebe as células lidas pelo OCR (texto + posição
 * + confiança) e os traços da grelha, e devolve o call sheet estruturado segundo o
 * template. Nunca inventa valores: o que não for encontrado fica vazio.
 */
import { withFixedRows } from '../templates/fixedRows';
import type { CallSheetTemplate } from '../templates';
import type { CallSheetDocument, Field, HeaderKey, SectionKey, SheetRow } from '../types/callSheet';
import { combinedConfidence, type TextCell } from './ocrEngine';
import { buildLayout } from './parsing/geometry';
import { withRestoredAccents } from './parsing/accents';
import { parseHeader } from './parsing/header';
import { parseByRegions } from './parsing/regions';
import { parseSheetGrid } from './parsing/sheetGrid';
import type { SectionsResult } from './parsing/sections';
import type { RgbaImage } from './raster';
import { SectionParser } from './parsing/sections';
import { bestAliasScore, looksLikeName, normalizeLabel } from './parsing/text';
import type { Rule } from './tableDetector';

export interface ParseInput {
  /** A imagem original (para ler cores e as barras dos títulos). Opcional. */
  image?: RgbaImage;
  cells: TextCell[];
  rules: Rule[];
  width: number;
  height: number;
  textHeight: number;
}

export interface ParseResult {
  document: CallSheetDocument;
  /** Blocos do template cujo título existe no documento. */
  sectionsFound: SectionKey[];
  /** Número de pessoas (linhas) reconhecidas. */
  people: number;
  /** Texto com ar de conteúdo que não foi atribuído a nenhum campo. */
  unassigned: string[];
}

/** Mínimos para considerar que a imagem é mesmo um call sheet deste tipo. */
const MIN_SECTIONS = 2;
const MIN_PEOPLE = 2;

export function isCallSheet(result: ParseResult): boolean {
  return result.sectionsFound.length >= MIN_SECTIONS && result.people >= MIN_PEOPLE;
}

/** "Data: sábado | Local: Estádio" lido como uma só célula: separa nos "|". */
function splitAtBars(cells: TextCell[]): TextCell[] {
  const out: TextCell[] = [];
  for (const cell of cells) {
    const parts: TextCell['words'][] = [[]];
    for (const word of cell.words) {
      if (/^[|¦]+$/.test(word.text)) parts.push([]);
      else parts[parts.length - 1].push(word);
    }
    const pieces = parts.filter((words) => words.length > 0);
    if (pieces.length <= 1 && parts.length === 1) {
      out.push(cell);
      continue;
    }
    for (const words of pieces) {
      out.push({
        text: words.map((word) => word.text).join(' '),
        confidence: combinedConfidence(words),
        words,
        bbox: {
          x0: Math.min(...words.map((word) => word.bbox.x0)),
          y0: cell.bbox.y0,
          x1: Math.max(...words.map((word) => word.bbox.x1)),
          y1: cell.bbox.y1,
        },
      });
    }
  }
  return out;
}

function filledFields(sections: Record<SectionKey, SheetRow[]>): number {
  let count = 0;
  for (const rows of Object.values(sections)) for (const row of rows) for (const [key, field] of Object.entries(row)) if (key !== 'id' && (field as Field | undefined)?.value.trim()) count++;
  return count;
}

export function parseCallSheet(input: ParseInput, template: CallSheetTemplate): ParseResult {
  const layout = buildLayout(splitAtBars(input.cells), input.rules, input.width, input.height, input.textHeight);
  // Duas leituras: por zonas (secção primeiro, depois o significado) e a leitura por tabela.
  // Fica a que reconhece mais campos.
  const classic = new SectionParser(layout, template).parse();
  const regions = parseByRegions(layout, template);
  const grid = input.image ? parseSheetGrid(layout, template, input.image) : null;
  let blocks: SectionsResult = classic;
  for (const candidate of [regions]) if (candidate && filledFields(candidate.sections) >= filledFields(blocks.sections)) blocks = candidate;
  // A folha em grelha reconhece-se pelas barras dos títulos: quando há blocos suficientes, é ela que manda.
  if (grid && grid.found.size >= 4) blocks = grid;
  const { header, used: headerCells } = parseHeader(layout, template, blocks.used, blocks.top);
  if (blocks === regions && regions) {
    for (const [key, field] of Object.entries(regions.header) as [HeaderKey, Field][]) if (field && header[key].value.trim() === '') header[key] = field;
  }
  if (blocks === grid && grid) {
    // Folha em grelha: o cabeçalho vem só das posições conhecidas (nada de texto solto).
    for (const definition of template.headerFields) header[definition.key] = grid.header[definition.key] ?? { value: '', confidence: null };
    header.others = [];
  }
  // Texto solto no canto superior esquerdo (o nome no logótipo) não é informação do cabeçalho.
  header.others = header.others.filter((extra) => extra.label.trim() !== '' || !extra.field.bbox || extra.field.bbox.x1 > input.width * 0.3);

  const dividers = [...template.groups.map((group) => normalizeLabel(group.title)), ...template.genericTitles];
  const unassigned = [
    ...blocks.leftovers,
    ...layout.cells.filter(
      (cell) =>
        !blocks.used.has(cell) &&
        !headerCells.has(cell) &&
        cell.yc >= blocks.top &&
        looksLikeName(cell.text) &&
        cell.source.confidence >= 0.5 &&
        bestAliasScore(cell.norm, dividers) < 0.85,
    ),
  ]
    .sort((a, b) => a.yc - b.yc || a.x0 - b.x0)
    .map((cell) => cell.text);

  // Acentos perdidos pelo OCR em texto em maiúsculas.
  for (const rows of Object.values(blocks.sections)) {
    for (const row of rows) {
      for (const key of Object.keys(row) as (keyof typeof row)[]) {
        if (key === 'id') continue;
        const field = row[key];
        if (field && typeof field === 'object') row[key] = withRestoredAccents(field);
      }
    }
  }
  for (const definition of template.headerFields) header[definition.key] = withRestoredAccents(header[definition.key]);

  const people = Object.values(blocks.sections).reduce((total, rows) => total + rows.length, 0);
  return {
    // As linhas fixas do template (ex.: Início da Montagem) entram depois de contar o que foi lido.
    document: withFixedRows({ documentType: 'call_sheet', template: template.id, header, sections: blocks.sections }, template),
    sectionsFound: [...blocks.found],
    people,
    unassigned,
  };
}
