/**
 * Leitura por zonas: primeiro encontra as secções do documento (EQUIPA, LOGÍSTICA,
 * PLANO DE TRABALHO, INFORMAÇÕES/OBSERVAÇÕES, …) pelos títulos e pela posição na página,
 * e só depois interpreta o texto de cada zona, com as regras dessa zona.
 * Nada passa de uma zona para outra. O que não é encontrado fica vazio.
 */
import type { CallSheetTemplate, SectionDef } from '../../templates';
import type { ColumnKey, Field, HeaderKey, SectionKey, SheetRow } from '../../types/callSheet';
import { createRowId } from '../../utils/fields';
import type { OcrWord } from '../ocrEngine';
import type { LayoutCell, PageLayout } from './geometry';
import type { SectionsResult } from './sections';
import { bestAliasScore, normalizeLabel } from './text';
import { cellField, INFERRED_CONFIDENCE, wordsField } from './values';

type Kind = 'team' | 'logistics' | 'plan' | 'schedule' | 'notes' | 'map';

/** Títulos das zonas do documento. */
const ZONES: { kind: Kind; aliases: string[] }[] = [
  { kind: 'team', aliases: ['equipa', 'equipa tecnica'] },
  { kind: 'logistics', aliases: ['logistica', 'logistica transportes', 'transportes'] },
  { kind: 'plan', aliases: ['plano de trabalho', 'plano trabalho'] },
  { kind: 'schedule', aliases: ['horario', 'horarios'] },
  { kind: 'notes', aliases: ['informacoes', 'observacoes', 'notas'] },
  { kind: 'map', aliases: ['mapa de camaras', 'mapa camaras'] },
];

const PHASES = ['pre jogo', 'pos jogo', 'intervalo', 'montagem', 'desmontagem', 'aquecimento', 'pre programa', 'pos programa'];

export interface RegionsResult extends SectionsResult {
  header: Partial<Record<HeaderKey, Field>>;
}

interface Zone {
  kind: Kind;
  title: LayoutCell;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cells: LayoutCell[];
}

const emptyRow = (section: SectionDef): SheetRow => {
  const row: SheetRow = { id: createRowId() };
  for (const column of section.columns) row[column.key] = { value: '', confidence: null };
  return row;
};

/** Linhas de texto (células com o mesmo centro vertical), de cima para baixo e da esquerda para a direita. */
function lines(cells: LayoutCell[], textHeight: number): LayoutCell[][] {
  const sorted = [...cells].sort((a, b) => a.yc - b.yc);
  const out: LayoutCell[][] = [];
  for (const cell of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].yc - cell.yc) <= textHeight * 0.6) last.push(cell);
    else out.push([cell]);
  }
  return out.map((line) => line.sort((a, b) => a.x0 - b.x0));
}

/** Junta campos (partes de um valor lido em várias linhas). */
function joinFields(parts: Field[], separator = ' '): Field {
  const values = parts.map((part) => part.value.trim()).filter(Boolean);
  const confidences = parts.map((part) => part.confidence).filter((value): value is number => value !== null);
  return { value: values.join(separator), confidence: confidences.length ? Math.min(...confidences) : null, bbox: parts[0]?.bbox };
}

/** "Rótulo: valor" numa célula → [palavras do rótulo, palavras do valor]. */
function splitLabel(cell: LayoutCell): { label: string; value: Field | null } | null {
  const words = cell.source.words;
  const index = words.findIndex((word) => /:$/.test(word.text));
  if (index < 0 || index > 3) return null;
  const label = words
    .slice(0, index + 1)
    .map((word) => word.text)
    .join(' ')
    .replace(/:$/, '');
  const rest: OcrWord[] = words.slice(index + 1);
  return { label, value: rest.length ? wordsField(rest) : null };
}

export function parseByRegions(layout: PageLayout, template: CallSheetTemplate): RegionsResult | null {
  const th = layout.textHeight;
  const sectionOf = (key: SectionKey): SectionDef => template.sections.find((section) => section.key === key)!;
  const matchSection = (norm: string, minimum = 0.85): SectionDef | null => {
    let best: SectionDef | null = null;
    let bestScore = minimum;
    for (const section of template.sections) {
      const score = bestAliasScore(norm, section.aliases);
      if (score >= bestScore && (score > bestScore || !best)) {
        best = section;
        bestScore = score;
      }
    }
    return best;
  };

  // 1. Títulos das zonas: célula inteira igual a um título conhecido.
  const titles: { kind: Kind; cell: LayoutCell }[] = [];
  for (const cell of layout.cells) {
    const norm = normalizeLabel(cell.text);
    const zone = ZONES.find((candidate) => bestAliasScore(norm, candidate.aliases) >= 0.9);
    if (zone) titles.push({ kind: zone.kind, cell });
  }
  if (titles.length < 2) return null;

  // 2. Colunas da página: títulos alinhados à esquerda com a mesma posição X.
  const columnStarts: number[] = [];
  for (const { cell } of [...titles].sort((a, b) => a.cell.x0 - b.cell.x0)) {
    if (!columnStarts.some((x) => Math.abs(x - cell.x0) < th * 4)) columnStarts.push(cell.x0);
  }
  columnStarts.sort((a, b) => a - b);
  const columnOf = (x: number): number => {
    let index = 0;
    columnStarts.forEach((start, i) => {
      if (x >= start - th * 2) index = i;
    });
    return index;
  };

  // 3. Cada zona vai do seu título até ao título seguinte na mesma coluna.
  const top = Math.min(...titles.map(({ cell }) => cell.y0));
  const zones: Zone[] = titles.map(({ kind, cell }) => {
    const column = columnOf(cell.x0);
    const below = titles.filter((other) => other.cell !== cell && columnOf(other.cell.x0) === column && other.cell.y0 > cell.y0);
    const y1 = below.length ? Math.min(...below.map((other) => other.cell.y0)) : layout.height;
    const x0 = columnStarts[column] - th * 2;
    const x1 = column + 1 < columnStarts.length ? columnStarts[column + 1] - th * 2 : layout.width;
    return { kind, title: cell, x0, x1, y0: cell.y1, y1, cells: [] };
  });
  const titleCells = new Set(titles.map(({ cell }) => cell));
  for (const cell of layout.cells) {
    if (titleCells.has(cell) || cell.yc < top) continue;
    const zone = zones.find((candidate) => cell.x0 >= candidate.x0 && cell.x0 < candidate.x1 && cell.yc > candidate.y0 && cell.yc < candidate.y1);
    if (zone) zone.cells.push(cell);
  }
  // O que vem depois de um grande espaço em branco (ex.: nota de rodapé) já não pertence à zona.
  for (const zone of zones) {
    const zoneLines = lines(zone.cells, th);
    let keep = zoneLines.length;
    for (let i = 1; i < zoneLines.length; i++) {
      if (zoneLines[i][0].y0 - zoneLines[i - 1][0].y1 > th * 5.5) {
        keep = i;
        break;
      }
    }
    zone.cells = zoneLines.slice(0, keep).flat();
  }

  const sections = Object.fromEntries(template.sections.map((section) => [section.key, [] as SheetRow[]])) as Record<SectionKey, SheetRow[]>;
  const header: Partial<Record<HeaderKey, Field>> = {};
  const used = new Set<LayoutCell>(titleCells);
  const leftovers: LayoutCell[] = [];
  const found = new Set<SectionKey>();
  const scheduleRows: SheetRow[] = [];
  const planRows: SheetRow[] = [];

  for (const zone of zones) {
    zone.cells.forEach((cell) => used.add(cell));
    if (zone.kind === 'team') parseTeam(zone);
    else if (zone.kind === 'logistics') parseLogistics(zone);
    else if (zone.kind === 'plan') planRows.push(...parsePlan(zone));
    else if (zone.kind === 'schedule') scheduleRows.push(...parsePlan(zone));
    else if (zone.kind === 'notes') parseNotes(zone);
  }
  if (scheduleRows.length || planRows.length) {
    sections.workPlan = [...scheduleRows, ...planRows];
    found.add('workPlan');
  }
  return { sections, used, leftovers, found, top, header };

  // --- EQUIPA ---------------------------------------------------------------
  function parseTeam(zone: Zone): void {
    // Subtítulos (Câmaras, EVS, CCU, Op. Som…): célula só com o nome de um bloco.
    const subtitles = zone.cells.filter((cell) => !/:\s*\S/.test(cell.text) && matchSection(normalizeLabel(cell.text)) !== null);
    const subStarts: number[] = [];
    for (const cell of [...subtitles].sort((a, b) => a.x0 - b.x0)) if (!subStarts.some((x) => Math.abs(x - cell.x0) < th * 4)) subStarts.push(cell.x0);
    subStarts.sort((a, b) => a - b);
    const subColumn = (x: number): number => subStarts.filter((start) => x >= start - th * 2).length - 1;
    const owner = new Map<LayoutCell, LayoutCell>();
    for (const cell of zone.cells) {
      if (subtitles.includes(cell)) continue;
      const column = subColumn(cell.x0);
      const candidates = subtitles.filter((sub) => subColumn(sub.x0) === column && sub.yc < cell.yc - th * 0.3);
      if (!candidates.length) continue;
      owner.set(cell, candidates.reduce((a, b) => (b.yc > a.yc ? b : a)));
    }

    for (const line of lines(zone.cells.filter((cell) => !subtitles.includes(cell)), th)) {
      // "Cargo: NOME" na mesma linha.
      const free = line.filter((cell) => !owner.has(cell));
      for (const cell of free) {
        const split = splitLabel(cell);
        const section = split ? matchSection(normalizeLabel(split.label), 0.8) : null;
        if (split && section && split.value) {
          const row = emptyRow(section);
          row.name = split.value;
          sections[section.key].push(row);
          found.add(section.key);
          continue;
        }
        // "Cargo  NOME" em duas células.
        const next = free[free.indexOf(cell) + 1];
        const role = matchSection(normalizeLabel(cell.text), 0.85);
        if (role && next && !matchSection(normalizeLabel(next.text), 0.85)) {
          const row = emptyRow(role);
          row.name = cellField(next);
          sections[role.key].push(row);
          found.add(role.key);
          free.splice(free.indexOf(next), 1);
        } else if (!role) leftovers.push(cell);
      }
    }

    // Linhas de cada subtítulo.
    for (const sub of subtitles) {
      const section = matchSection(normalizeLabel(sub.text))!;
      found.add(section.key);
      const mine = zone.cells.filter((cell) => owner.get(cell) === sub);
      const hasNumber = section.columns.some((column) => column.key === 'number');
      let previousNumber = 0;
      for (const line of lines(mine, th)) {
        const row = emptyRow(section);
        let cells = line;
        if (hasNumber && cells.length > 1 && cells[0].text.replace(/[\s:.)]/g, '').length <= 3) {
          // Número da linha; se não se ler, segue a sequência (para confirmar).
          const digits = cells[0].text.replace(/[^\d]/g, '');
          const number = digits !== '' && digits.length <= 2 ? Number(digits) : null;
          const value = number !== null && number === previousNumber + 1 ? number : previousNumber + 1;
          row.number = { value: String(value), confidence: number === value ? cells[0].source.confidence : INFERRED_CONFIDENCE, bbox: cells[0].source.bbox };
          previousNumber = value;
          cells = cells.slice(1);
        } else if (hasNumber) {
          previousNumber += 1;
        }
        if (!cells.length) continue;
        row.name = cellField(cells[0]);
        for (const extra of cells.slice(1)) {
          const norm = normalizeLabel(extra.text);
          const column = (['status', 'location', 'transPk'] as ColumnKey[]).find(
            (key) => section.columns.some((c) => c.key === key) && (template.vocabulary[key] ?? []).includes(norm),
          );
          if (column) row[column] = cellField(extra);
          else row.name = joinFields([row.name!, cellField(extra)]);
        }
        sections[section.key].push(row);
      }
    }
  }

  // --- LOGÍSTICA ------------------------------------------------------------
  function parseLogistics(zone: Zone): void {
    const section = sectionOf('drivers');
    found.add('drivers');
    const logisticsFields = template.headerFields.filter((field) => field.group === 'logistics');
    let columns: { key: ColumnKey; x0: number }[] = [];
    let current: Record<string, Field[]> | null = null;
    const records: Record<string, Field[]>[] = [];
    const nameWords = (record: Record<string, Field[]>): number => (record.name ?? []).map((field) => field.value).join(' ').split(/\s+/).filter(Boolean).length;

    for (const line of lines(zone.cells, th)) {
      // Saída: 08:30 · De: MATOSINHOS
      let rest = line;
      for (const cell of line) {
        const split = splitLabel(cell);
        if (!split?.value) continue;
        const field = logisticsFields.find((candidate) => bestAliasScore(normalizeLabel(split.label), [normalizeLabel(candidate.label), ...candidate.aliases]) >= 0.85);
        if (field) {
          header[field.key] = split.value;
          rest = rest.filter((other) => other !== cell);
        }
      }
      if (!rest.length) continue;
      // Cabeçalho da tabela: Condutor · Viatura · Passageiros.
      const headers = rest.map((cell) => ({ cell, column: section.columns.find((column) => bestAliasScore(normalizeLabel(cell.text), column.aliases) >= 0.85) }));
      if (headers.filter((entry) => entry.column).length >= 2) {
        columns = headers.filter((entry) => entry.column).map((entry) => ({ key: entry.column!.key, x0: entry.cell.x0 }));
        columns.sort((a, b) => a.x0 - b.x0);
        continue;
      }
      if (!columns.length) {
        rest.forEach((cell) => leftovers.push(cell));
        continue;
      }
      // Cada célula vai para a coluna em cuja faixa começa.
      const placed: Record<string, Field[]> = {};
      for (const cell of rest) {
        let column = columns[0];
        for (const candidate of columns) if (cell.x0 >= candidate.x0 - th * 1.5) column = candidate;
        (placed[column.key] ??= []).push(cellField(cell));
      }
      // Uma linha começa um registo novo quando traz um condutor e o nome do anterior já está completo.
      const startsRecord = placed.name && (!current || nameWords(current) >= 2);
      if (!current || startsRecord) {
        current = {};
        records.push(current);
      }
      for (const [key, fields] of Object.entries(placed)) (current[key] ??= []).push(...fields);
    }

    for (const record of records) {
      const row = emptyRow(section);
      for (const column of section.columns) {
        const parts = record[column.key];
        if (!parts?.length) continue;
        const joined = joinFields(parts);
        joined.value = joined.value.replace(/\s*,\s*/g, ', ').replace(/[,\s]+$/, '').replace(/\s*-\s*$/, '').trim();
        row[column.key] = joined;
      }
      sections.drivers.push(row);
    }
  }

  // --- PLANO DE TRABALHO / HORÁRIO -------------------------------------------
  function parsePlan(zone: Zone): SheetRow[] {
    const section = sectionOf('workPlan');
    const rows: SheetRow[] = [];
    let phase = '';
    let item: { parts: Field[]; time: Field | null; means: Field | null } | null = null;
    const flush = (): void => {
      if (!item) return;
      const row = emptyRow(section);
      if (phase) row.phase = { value: phase, confidence: 0.95 };
      if (item.time) row.time = item.time;
      if (item.means) row.means = item.means;
      const description = joinFields(item.parts);
      description.value = description.value.replace(/^[-–—\s]+/, '').replace(/[-–—\s]+$/, '').trim();
      row.description = description;
      if (description.value || item.time) rows.push(row);
      item = null;
    };

    for (const line of lines(zone.cells, th)) {
      const text = line.map((cell) => cell.text).join(' ').trim();
      const norm = normalizeLabel(text);
      // Fase: "Pré-jogo:", "INTERVALO:", "PÓS JOGO:"
      if (/:\s*$/.test(text) && bestAliasScore(norm, PHASES) >= 0.8) {
        flush();
        phase = text.replace(/:\s*$/, '').toUpperCase().replace(/\s+/g, '-');
        continue;
      }
      // Hora no início: "09:30", "13H30".
      const first = line[0];
      const leadingTime = /^[-–—\s]*(\d{1,2})\s*[hH:.]\s*(\d{2})\b/.exec(text);
      const startsItem = /^[-–—]/.test(text) || leadingTime !== null;
      if (startsItem || !item) {
        flush();
        item = { parts: [], time: null, means: null };
      }
      let body = text;
      if (leadingTime && startsItem) {
        item!.time = { value: `${leadingTime[1].padStart(2, '0')}:${leadingTime[2]}`, confidence: first.source.confidence, bbox: first.source.bbox };
        body = body.slice(leadingTime[0].length);
      }
      // Meios no fim ("- CAM 05", ou "CAM 05" separado por um espaço largo): coluna Meios / Obs.
      const words = line.flatMap((cell) => cell.source.words);
      const means = /(?:^|\s)[-–—]\s*(CAM\s*\d{1,2})\s*$/i.exec(body);
      let meansText: string | null = means ? means[1] : null;
      if (!meansText && words.length >= 3) {
        const [a, b] = words.slice(-2);
        const before = words[words.length - 3];
        if (/^CAM$/i.test(a.text) && /^\d{1,2}$/.test(b.text) && a.bbox.x0 - before.bbox.x1 > th * 0.9 && !/^\s*CAM/i.test(body)) meansText = `${a.text} ${b.text}`;
      }
      if (meansText && item) {
        const tail = words.slice(-2);
        item.means = { value: meansText.replace(/\s+/g, ' ').toUpperCase(), confidence: Math.min(...tail.map((word) => word.confidence)), bbox: line[line.length - 1].source.bbox };
        body = body.slice(0, body.lastIndexOf(meansText.split(/\s+/)[0])).replace(/[-–—\s]+$/, '');
      }
      item!.parts.push({ value: body, confidence: Math.min(...line.map((cell) => cell.source.confidence)), bbox: first.source.bbox });
    }
    flush();
    return rows;
  }

  // --- INFORMAÇÕES / OBSERVAÇÕES ---------------------------------------------
  function parseNotes(zone: Zone): void {
    const out: string[] = [];
    const confidences: number[] = [];
    for (const line of lines(zone.cells, th)) {
      const text = line.map((cell) => cell.text).join(' ').trim();
      if (!text || (out.length === 0 && normalizeLabel(text) === 'outras informacoes')) continue;
      confidences.push(...line.map((cell) => cell.source.confidence));
      const previous = out[out.length - 1];
      // Linha partida: continua a anterior.
      if (previous !== undefined && (/^[a-zà-ú(]/.test(text) || /[,+–-]$/.test(previous))) out[out.length - 1] = `${previous} ${text}`;
      else out.push(text);
    }
    if (out.length) header.notes = { value: out.join('\n'), confidence: Math.min(...confidences), bbox: zone.cells[0]?.source.bbox };
  }
}
