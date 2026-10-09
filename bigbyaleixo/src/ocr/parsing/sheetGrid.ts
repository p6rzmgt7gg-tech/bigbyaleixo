/**
 * Folha de serviço em grelha (a folha de cálculo habitual): cabeçalho colorido em cima
 * (a cor indica o cliente) e blocos com uma barra cinzenta escura por título
 * (CAMARAS, PRODUÇÃO, EVS, …) com as colunas Nome · # · Trans/Pk · Loc.
 *
 * As barras são encontradas na própria imagem (não dependem do OCR do título). Primeiro
 * decide-se o bloco de cada linha pela posição; só depois se lê o que cada célula quer dizer.
 */
import type { CallSheetTemplate, SectionDef } from '../../templates';
import type { Field, HeaderKey, SectionKey, SheetRow } from '../../types/callSheet';
import { createRowId } from '../../utils/fields';
import type { RgbaImage } from '../raster';
import type { LayoutCell, PageLayout } from './geometry';
import type { RegionsResult } from './regions';
import { editDistance, normalizeLabel } from './text';
import { cellField, INFERRED_CONFIDENCE } from './values';

interface Bar {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Títulos possíveis e o bloco do template correspondente. */
const TITLES: { key: SectionKey; names: string[] }[] = [
  { key: 'cameras', names: ['camaras', 'cameras'] },
  { key: 'production', names: ['producao'] },
  { key: 'technicalManagers', names: ['chefe tecnico'] },
  { key: 'realization', names: ['realizacao'] },
  { key: 'materialManagers', names: ['resp material'] },
  { key: 'evs', names: ['evs'] },
  { key: 'ccu', names: ['ccu'] },
  { key: 'dsngRf', names: ['dsng rf', 'dsng'] },
  { key: 'varTechnicians', names: ['tec var'] },
  { key: 'soundOperators', names: ['op som'] },
  { key: 'varFinal', names: ['var juizo final'] },
  { key: 'soundAssistants', names: ['ass som'] },
  { key: 'videoAssistants', names: ['ass video'] },
  { key: 'sky', names: ['4 sky'] },
  { key: 'drivers', names: ['condutores'] },
  { key: 'lighting', names: ['iluminacao'] },
  { key: 'graphics', names: ['grafismo', 'grafismo wtvision'] },
];

/** Disposição habitual da folha (coluna → blocos de cima para baixo), para quando o título não se lê. */
const DEFAULT_LAYOUT: SectionKey[][] = [
  ['cameras', 'videoAssistants'],
  ['production', 'realization', 'evs', 'varTechnicians', 'varFinal', 'sky'],
  ['technicalManagers', 'materialManagers', 'ccu', 'dsngRf', 'soundOperators', 'soundAssistants', 'drivers'],
];

/** Cor do cabeçalho → cliente. */
function clientFromHue(hue: number | null): string {
  if (hue === null) return '';
  if (hue >= 45 && hue < 80) return 'SPORT TV';
  if (hue >= 80 && hue < 170) return 'CANAL 11';
  if (hue >= 170 && hue < 260) return 'PORTO CANAL';
  return '';
}

const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** Barras cinzentas escuras (títulos dos blocos). */
export function findBars(image: RgbaImage, textHeight: number): Bar[] {
  const { data, width, height } = image;
  const isBar = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = lum(r, g, b);
    return Math.max(r, g, b) - Math.min(r, g, b) < 28 && l > 50 && l < 150;
  };
  const minWidth = width * 0.12;
  // Faixas cinzentas contínuas em cada linha. As linhas com o texto branco do título partem-se,
  // mas as de cima e de baixo da barra são contínuas e separam bem as colunas.
  const strips: Bar[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    let lastBar = -1;
    const close = (): void => {
      if (start < 0 || lastBar - start < minWidth) return;
      const strip = strips.find((candidate) => candidate.y1 >= y - 1 && Math.abs(candidate.x0 - start) < 6 && Math.abs(candidate.x1 - lastBar) < 6);
      if (strip) strip.y1 = y;
      else strips.push({ x0: start, x1: lastBar, y0: y, y1: y });
    };
    for (let x = 0; x < width; x++) {
      if (isBar(x, y)) {
        if (start < 0) start = x;
        lastBar = x;
      } else if (start >= 0 && x - lastBar > 3) {
        close();
        start = -1;
      }
    }
    close();
  }
  // As barras de colunas vizinhas tocam-se: a folha tem três colunas iguais, por isso
  // cada faixa é cortada nos terços da largura da folha.
  const wide = strips;
  if (!wide.length) return [];
  const sheetX0 = Math.min(...wide.map((strip) => strip.x0));
  const sheetX1 = Math.max(...wide.map((strip) => strip.x1));
  const third = (sheetX1 - sheetX0) / 3;
  const pieces: Bar[] = [];
  for (const strip of wide) {
    for (let k = 0; k < 3; k++) {
      const a = sheetX0 + k * third;
      const b = a + third;
      const x0 = Math.max(a, strip.x0);
      const x1 = Math.min(b, strip.x1);
      if (x1 - x0 >= third * 0.5) pieces.push({ x0: Math.round(a), x1: Math.round(b), y0: strip.y0, y1: strip.y1 });
    }
  }
  // Junta as faixas de cima e de baixo de cada barra.
  const bars: Bar[] = [];
  for (const piece of pieces.sort((a, b) => a.y0 - b.y0)) {
    const bar = bars.find((candidate) => candidate.x0 === piece.x0 && piece.y0 - candidate.y1 <= textHeight * 1.6);
    if (bar) bar.y1 = Math.max(bar.y1, piece.y1);
    else bars.push({ ...piece });
  }
  return bars
    .filter((bar) => bar.y1 - bar.y0 + 1 >= Math.max(8, textHeight * 1.1) && bar.y1 - bar.y0 < textHeight * 4)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** Matiz (0..360) dominante do fundo do cabeçalho, ou null se não for colorido. */
function headerHue(image: RgbaImage, bottom: number): number | null {
  const { data, width } = image;
  const bins = new Array(36).fill(0);
  let total = 0;
  for (let y = 0; y < bottom; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max < 120 || max - min < 70) continue;
      let h: number;
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      bins[Math.floor((((h * 60) % 360) + 360) % 360 / 10)]++;
      total++;
    }
  }
  if (total < 200) return null;
  const best = bins.indexOf(Math.max(...bins));
  return best * 10 + 5;
}

/** Texto a cor laranja/vermelha (nomes riscados, retirados da equipa). */
function isColoredText(image: RgbaImage, cell: LayoutCell): boolean {
  const { data, width } = image;
  let ink = 0;
  let colored = 0;
  for (let y = Math.max(0, cell.y0); y < Math.min(image.height, cell.y1); y++) {
    for (let x = Math.max(0, cell.x0); x < Math.min(width, cell.x1); x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (lum(r, g, b) > 215) continue;
      ink++;
      if (r - b > 70 && r > 140) colored++;
    }
  }
  return ink > 8 && colored / ink > 0.25;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const x = a.replace(/ /g, '');
  const y = b.replace(/ /g, '');
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

export function parseSheetGrid(layout: PageLayout, template: CallSheetTemplate, image: RgbaImage): RegionsResult | null {
  const th = layout.textHeight;
  const bars = findBars(image, th);
  if (bars.length < 3) return null;

  // Colunas da folha: barras com o mesmo início.
  const columnStarts: number[] = [];
  for (const bar of [...bars].sort((a, b) => a.x0 - b.x0)) if (!columnStarts.some((x) => Math.abs(x - bar.x0) < 20)) columnStarts.push(bar.x0);
  columnStarts.sort((a, b) => a - b);
  const columnOf = (bar: Bar): number => columnStarts.findIndex((x) => Math.abs(x - bar.x0) < 20);

  const sectionOf = (key: SectionKey): SectionDef | undefined => template.sections.find((section) => section.key === key);
  const sections = Object.fromEntries(template.sections.map((section) => [section.key, [] as SheetRow[]])) as Record<SectionKey, SheetRow[]>;
  const header: Partial<Record<HeaderKey, Field>> = {};
  const used = new Set<LayoutCell>();
  const leftovers: LayoutCell[] = [];
  const found = new Set<SectionKey>();
  const top = Math.min(...bars.map((bar) => bar.y0));

  // 1. Cada barra é um bloco; o título decide qual (pela leitura ou, se ilegível, pela posição).
  const byColumn = new Map<number, Bar[]>();
  for (const bar of bars) {
    const column = columnOf(bar);
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column)!.push(bar);
  }
  const taken = new Set<SectionKey>();
  for (const [column, columnBars] of byColumn) {
    columnBars.sort((a, b) => a.y0 - b.y0);
    columnBars.forEach((bar, order) => {
      const width = bar.x1 - bar.x0;
      const inBar = layout.cells.filter((cell) => cell.yc >= bar.y0 - 2 && cell.yc <= bar.y1 + 2 && cell.xc >= bar.x0 && cell.xc <= bar.x1);
      inBar.forEach((cell) => used.add(cell));
      const titleText = normalizeLabel(
        inBar
          .filter((cell) => cell.xc < bar.x0 + width * 0.55)
          .map((cell) => cell.text)
          .join(' '),
      );
      let key: SectionKey | null = null;
      let best = 0.55;
      for (const title of TITLES) {
        for (const name of title.names) {
          const score = Math.max(similarity(titleText, name), titleText.includes(name) ? 0.95 : 0);
          if (score > best) {
            best = score;
            key = title.key;
          }
        }
      }
      if (!key || taken.has(key)) {
        const fallback = DEFAULT_LAYOUT[Math.min(column, DEFAULT_LAYOUT.length - 1)]?.[order];
        key = fallback && !taken.has(fallback) ? fallback : null;
      }
      if (!key) return;
      taken.add(key);
      const section = sectionOf(key);
      if (!section) return;
      found.add(key);

      // 2. Linhas do bloco: entre esta barra e a seguinte na mesma coluna.
      const next = columnBars[order + 1];
      const yEnd = next ? next.y0 : layout.height;
      const cells = layout.cells.filter((cell) => !used.has(cell) && cell.xc >= bar.x0 - 4 && cell.xc <= bar.x1 + 4 && cell.yc > bar.y1 && cell.yc < yEnd);
      const lines: LayoutCell[][] = [];
      for (const cell of [...cells].sort((a, b) => a.yc - b.yc)) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last[0].yc - cell.yc) < th * 0.7) last.push(cell);
        else lines.push([cell]);
      }
      let sequence = 0;
      for (const line of lines) {
        line.forEach((cell) => used.add(cell));
        const at = (cell: LayoutCell): number => (cell.xc - bar.x0) / width;
        const nameCells = line.filter((cell) => at(cell) >= 0.1 && at(cell) < 0.54);
        const numberCells = line.filter((cell) => at(cell) < 0.1);
        const statusCells = line.filter((cell) => at(cell) >= 0.54 && at(cell) < 0.645);
        const transCells = line.filter((cell) => at(cell) >= 0.645 && at(cell) < 0.88);
        const locCells = line.filter((cell) => at(cell) >= 0.88);
        // Sem marcas soltas (o triângulo de comentário da folha lê-se como "b").
        const nameText = nameCells.map((cell) => cell.text).join(' ').replace(/(^|\s)[a-z](?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
        if (!/\p{L}{2}/u.test(nameText)) continue;
        // Nome a laranja (riscado): já não faz parte da equipa.
        if (nameCells.every((cell) => isColoredText(image, cell))) continue;
        const row: SheetRow = { id: createRowId() };
        for (const column of section.columns) row[column.key] = { value: '', confidence: null };
        row.name = { value: nameText, confidence: Math.min(...nameCells.map((cell) => cell.source.confidence)), bbox: nameCells[0].source.bbox };
        sequence++;
        if (section.columns.some((column) => column.key === 'number')) {
          const digits = numberCells.map((cell) => cell.text).join('').replace(/\D/g, '');
          const read = digits ? Number(digits.slice(0, 2)) : null;
          row.number =
            read !== null && read === sequence
              ? { value: String(read), confidence: numberCells[0].source.confidence, bbox: numberCells[0].source.bbox }
              : { value: String(sequence), confidence: INFERRED_CONFIDENCE };
        }
        if (statusCells.length && section.columns.some((column) => column.key === 'status')) row.status = cellField(statusCells[0]);
        if (transCells.length && section.columns.some((column) => column.key === 'transPk'))
          row.transPk = { value: transCells.map((cell) => cell.text).join(' '), confidence: Math.min(...transCells.map((cell) => cell.source.confidence)) };
        if (locCells.length && section.columns.some((column) => column.key === 'location')) row.location = cellField(locCells[locCells.length - 1]);
        sections[key].push(row);
      }
    });
  }

  // 3. Cabeçalho: tudo o que está acima da primeira barra.
  const head = layout.cells.filter((cell) => cell.yc < top - 2);
  head.forEach((cell) => used.add(cell));
  const headLines: LayoutCell[][] = [];
  for (const cell of [...head].sort((a, b) => a.yc - b.yc)) {
    const last = headLines[headLines.length - 1];
    if (last && Math.abs(last[0].yc - cell.yc) < th * 0.8) last.push(cell);
    else headLines.push([cell]);
  }
  headLines.forEach((line) => line.sort((a, b) => a.x0 - b.x0));
  const field = (cell: LayoutCell, confidence = cell.source.confidence): Field => ({ value: cell.text.trim(), confidence, bbox: cell.source.bbox });
  const below = (label: LayoutCell): LayoutCell | undefined =>
    head
      .filter((cell) => cell.y0 > label.y1 - 2 && cell.y0 < label.y1 + th * 3 && Math.abs(cell.xc - label.xc) < Math.max(label.width, cell.width) * 0.75)
      .sort((a, b) => a.y0 - b.y0)[0];
  const isLabel = (cell: LayoutCell, names: string[], minimum = 0.7): boolean => names.some((name) => similarity(normalizeLabel(cell.text), name) >= minimum);
  /** O rótulo mais parecido (e não o primeiro parecido: "Saída ML Lx" e "Saída ML Pt" diferem numa sigla). */
  const bestLabel = (names: string[]): LayoutCell | undefined => {
    let best: LayoutCell | undefined;
    let bestScore = 0.7;
    for (const cell of head) {
      const score = Math.max(...names.map((name) => similarity(normalizeLabel(cell.text), name)));
      if (score > bestScore) {
        best = cell;
        bestScore = score;
      }
    }
    return best;
  };

  // Cliente pela cor do cabeçalho.
  const client = clientFromHue(headerHue(image, top));
  if (client) header.client = { value: client, confidence: INFERRED_CONFIDENCE };

  // Código (ST2, PF1, FF1, DZN…): primeira célula da primeira linha.
  const first = headLines[0]?.[0];
  if (first && first.text.trim().length <= 6 && /[A-Za-z]/.test(first.text)) {
    const code = first.text.trim().replace(/^([A-Z]{2,3})[lIL|]$/, '$11');
    header.pf = { ...field(first), value: code, confidence: code === first.text.trim() ? first.source.confidence : INFERRED_CONFIDENCE };
  }

  // Local: célula larga com vírgula ou "Estádio/Circuito".
  const isDate = (text: string): boolean => /(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)|\b\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i.test(text);
  const place = head
    .filter((cell) => !isDate(cell.text) && /,|est[aá]dio|circuito|pavilh|campo|arena|aut[oó]dromo/i.test(cell.text) && /\p{L}{4}/u.test(cell.text))
    .sort((a, b) => b.width - a.width)[0];
  if (place) header.location = field(place);
  else {
    // Sem pista no texto: a célula mais larga da primeira linha (para confirmar).
    const widest = (headLines[0] ?? []).filter((cell) => cell !== first && (cell.text.match(/\p{L}/gu)?.length ?? 0) >= 8).sort((a, b) => b.width - a.width)[0];
    if (widest) header.location = field(widest, Math.min(widest.source.confidence, INFERRED_CONFIDENCE));
  }

  // Data: dia da semana ou "10 out".
  const date = head.find((cell) => isDate(cell.text));
  if (date) header.date = { ...field(date), value: date.text.trim().replace(/[,.]+$/, '') };

  // Competição e equipas: na linha da data, à direita dela, antes dos contadores.
  const countersStart = Math.min(...head.filter((cell) => isLabel(cell, ['lx ok', 'pt ok', 'tr lx', 'vlt', 'bus', 'l r1', 'p r1'], 0.85)).map((cell) => cell.x0), layout.width);
  if (date) {
    const line = headLines.find((candidate) => candidate.includes(date)) ?? [];
    const words = line.filter((cell) => cell.x0 > date.x1 && cell.x1 <= countersStart + 4 && /\p{L}{2}/u.test(cell.text) && cell.source.confidence >= 0.55 && cell !== place);
    if (words.length) {
      header.competition = field(words[0]);
      const teams = words.slice(1).map((cell) => cell.text.trim());
      if (teams.length >= 2) header.event = { value: `${teams[0]} vs ${teams[1]}`, confidence: Math.min(words[1].source.confidence, words[2].source.confidence) };
      else if (teams.length === 1) header.event = field(words[1]);
    }
  }

  // Modelo: "4 CAM + 1 SSM + 1 beauty", "3 CAM".
  const setup = head.find((cell) => /\+/.test(cell.text) || /\b\d+\s*CAM\b/i.test(cell.text));
  if (setup) header.setup = field(setup);

  // Meios: por baixo do modelo (OB 55, G 14, …), sem os que têm "?".
  if (setup) {
    const means = head
      .filter((cell) => cell.y0 > setup.y1 - 2 && cell.y0 < setup.y1 + th * 3 && cell.xc > setup.x0 - th * 6 && cell.xc < setup.x1 + th * 4 && cell !== setup)
      .filter((cell) => !/\?/.test(cell.text) && /\w/.test(cell.text))
      .sort((a, b) => a.x0 - b.x0)
      .map((cell) => {
        let text = cell.text.trim();
        // Leituras típicas do OCR em siglas de meios.
        text = text.replace(/^0B/i, 'OB').replace(/^OB\s*([0-9OS]+)$/i, (_m, digits: string) => `OB ${digits.replace(/O/gi, '0').replace(/S/gi, '5')}`);
        text = text.replace(/^6\s?(\d{2})$/, 'G $1');
        return { text, confidence: cell.source.confidence };
      })
      .filter((entry) => /^(OB|G|E|ML|MASTER|AUX|DSNG)\b/i.test(entry.text) || /^[A-Z]{1,6}[\s-]?\d/.test(entry.text));
    if (means.length) header.means = { value: means.map((entry) => entry.text).join(' + '), confidence: Math.min(INFERRED_CONFIDENCE, ...means.map((entry) => entry.confidence)) };
  }

  // Valores por baixo de rótulos: Crew, Faltam, KO e horas do dia.
  const timeRows: SheetRow[] = [];
  const planSection = sectionOf('workPlan');
  const labelled: { names: string[]; header?: HeaderKey; plan?: string }[] = [
    { names: ['crew', 'core', 'crev'], header: 'crew' },
    { names: ['faltam'], header: 'missing' },
    { names: ['ko'], header: 'kickoff' },
    { names: ['parking ob'], plan: 'Parking OB' },
    { names: ['saida ml lx'], plan: 'Saída ML Lx' },
    { names: ['saida ml pt'], plan: 'Saída ML Pt' },
    { names: ['hora no local'], plan: 'Hora no local' },
    { names: ['1 direto', '1o direto'], plan: '1º Direto' },
  ];
  for (const entry of labelled) {
    const label = bestLabel(entry.names);
    if (!label) continue;
    const value = below(label);
    if (!value) continue;
    const text = value.text.trim();
    if (entry.header === 'kickoff' || entry.plan) {
      const time = /(\d{1,2})\s*[:h.]\s*(\d{2})/.exec(text);
      if (!time) continue;
      const clock = `${time[1].padStart(2, '0')}:${time[2]}`;
      if (entry.header) header[entry.header] = { value: clock, confidence: value.source.confidence, bbox: value.source.bbox };
      else if (planSection) {
        const row: SheetRow = { id: createRowId() };
        for (const column of planSection.columns) row[column.key] = { value: '', confidence: null };
        row.time = { value: clock, confidence: value.source.confidence, bbox: value.source.bbox };
        row.description = { value: entry.plan!, confidence: 0.95 };
        timeRows.push(row);
      }
    } else if (entry.header && /^\d{1,3}$/.test(text)) header[entry.header] = field(value);
  }
  // KO: na folha é sempre a última hora da última linha do cabeçalho (canto inferior direito).
  if (!header.kickoff) {
    const lastLine = headLines[headLines.length - 1] ?? [];
    const times = lastLine.filter((cell) => /^\d{1,2}[:h.]\d{2}$/.test(cell.text.trim()));
    const ko = times[times.length - 1];
    if (ko && ko.x0 > layout.width * 0.8) {
      const [h, m] = ko.text.trim().split(/[:h.]/);
      header.kickoff = { value: `${h.padStart(2, '0')}:${m}`, confidence: Math.min(ko.source.confidence, INFERRED_CONFIDENCE), bbox: ko.source.bbox };
    }
  }
  // Lx 3 · Pt 13 · Lc 0
  for (const cell of head) {
    const match = /^(lx|pt)\s*(\d{1,3})$/i.exec(cell.text.trim());
    if (match) header[match[1].toLowerCase() as 'lx' | 'pt'] = { value: match[2], confidence: cell.source.confidence, bbox: cell.source.bbox };
  }
  if (timeRows.length) {
    timeRows.sort((a, b) => (a.time?.value ?? '').localeCompare(b.time?.value ?? ''));
    sections.workPlan = timeRows;
    found.add('workPlan');
  }

  return { sections, used, leftovers, found, top, header };
}
