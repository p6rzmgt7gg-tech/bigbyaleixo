/**
 * Geração do PDF. O documento é reconstruído a partir dos dados estruturados — texto
 * real, pesquisável e selecionável — com o layout do call sheet de referência:
 * cabeçalho (logo, canal, competição, jogo, PF), linha de informação, Equipa e Técnica
 * (cargo + nome), listas numeradas por função, plano de trabalho, logística e observações.
 * A imagem original não entra no PDF.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFEmbeddedPage, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { CallSheetTemplate, HeaderFieldDef, SectionDef } from '../templates';
import type { CallSheetDocument, ColumnKey, HeaderKey, SheetRow } from '../types/callSheet';
import { vehicleCode, withDepartures, withTeamLogistics } from '../utils/logistics';
import { formatDateTime, pdfFileName } from '../utils/formatters';
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE, VEHICLE_TINTS, type Rgb } from './pdfStyles';

/** Ficheiros TTF da Barlow Condensed (ver src/pdf/fonts). */
export interface PdfFonts {
  regular: Uint8Array;
  medium: Uint8Array;
  semibold: Uint8Array;
  bold: Uint8Array;
}

export interface PdfLogo {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

/** Secções opcionais do PDF (os dados continuam no documento; só não são exportados). */
export interface PdfSections {
  logistics: boolean;
  notes: boolean;
  cameraMap: boolean;
  /** Pessoas marcadas P-Vlt (ou L-Vlt) na logística. */
  vlt: boolean;
}

export interface PdfOptions {
  /** Por omissão, todas incluídas. */
  include?: Partial<PdfSections>;
  fonts: PdfFonts;
  /** Logótipo para o canto superior esquerdo. Sem logótipo, aparece a marca BIG. */
  logo?: PdfLogo | null;
  /** Logótipo do cliente (canto superior direito, por cima da data). */
  clientLogo?: PdfLogo | null;
  /** Mapa de câmaras (imagem), na página seguinte. */
  cameraMap?: PdfLogo | null;
  /** Ficheiros acrescentados a seguir ao mapa (PDF: todas as páginas; imagens: uma página cada). */
  extraFiles?: PdfExtraFile[];
  /** Momento da geração (rodapé e, na falta de data, nome do ficheiro). */
  generatedAt?: Date;
}

export interface PdfExtraFile {
  kind: 'pdf' | 'png' | 'jpg';
  bytes: Uint8Array;
}

export interface GeneratedPdf {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
}

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

/** Altura das maiúsculas da Barlow Condensed, em fração do corpo. */
const CAP_HEIGHT = 0.7;
const BRAND = 'BIG - Broadcast Information Generator';

function color([r, g, b]: Rgb) {
  return rgb(r, g, b);
}

/** Texto: medição, quebra de linhas e limpeza de caracteres que a fonte não tem. */
class Typesetter {
  private readonly glyphs = new Map<PDFFont, Set<number>>();

  constructor(private readonly fonts: Record<Weight, PDFFont>) {}

  font(weight: Weight): PDFFont {
    return this.fonts[weight];
  }

  clean(text: string, weight: Weight): string {
    const font = this.fonts[weight];
    let set = this.glyphs.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      this.glyphs.set(font, set);
    }
    let out = '';
    for (const character of text.replace(/\s+/g, ' ').trim()) {
      if (set.has(character.codePointAt(0)!)) {
        out += character;
        continue;
      }
      const base = character.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base !== '' && [...base].every((part) => set.has(part.codePointAt(0)!)) ? base : '?';
    }
    return out;
  }

  width(text: string, weight: Weight, size: number): number {
    return this.fonts[weight].widthOfTextAtSize(text, size);
  }

  /** Parte o texto em linhas que caibam em `maxWidth`. */
  wrap(text: string, weight: Weight, size: number, maxWidth: number): string[] {
    const cleaned = this.clean(text, weight);
    if (cleaned === '') return [];
    const lines: string[] = [];
    let line = '';
    for (const word of cleaned.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (this.width(candidate, weight, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      // Uma palavra maior do que a coluna é cortada.
      let rest = word;
      while (this.width(rest, weight, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && this.width(rest.slice(0, cut), weight, size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line !== '') lines.push(line);
    return lines;
  }

  /** Corpo que faz o texto caber numa largura (sem descer abaixo de `minSize`). */
  fit(text: string, weight: Weight, size: number, maxWidth: number, minSize: number): number {
    const width = this.width(this.clean(text, weight), weight, size);
    return width <= maxWidth ? size : Math.max(minSize, (size * maxWidth) / width);
  }
}

/** Superfície de desenho em coordenadas "a partir do topo". */
class Canvas {
  page!: PDFPage;

  constructor(readonly type: Typesetter) {}

  /** Escreve uma linha de texto; `top` é o topo da caixa da linha, com as maiúsculas centradas nela. */
  text(value: string, x: number, top: number, weight: Weight, size: number, tint: Rgb, lineBox = size * SPACE.lineHeight): void {
    const cleaned = this.type.clean(value, weight);
    if (cleaned === '') return;
    const baseline = top + (lineBox + size * CAP_HEIGHT) / 2;
    this.page.drawText(cleaned, { x, y: PAGE.height - baseline, size, font: this.type.font(weight), color: color(tint) });
  }

  centered(value: string, center: number, top: number, weight: Weight, size: number, tint: Rgb, lineBox?: number): void {
    const width = this.type.width(this.type.clean(value, weight), weight, size);
    this.text(value, center - width / 2, top, weight, size, tint, lineBox);
  }

  rect(x: number, top: number, width: number, height: number, fill: Rgb): void {
    this.page.drawRectangle({ x, y: PAGE.height - top - height, width, height, color: color(fill) });
  }

  line(x0: number, top0: number, x1: number, top1: number, thickness: number, tint: Rgb): void {
    this.page.drawLine({ start: { x: x0, y: PAGE.height - top0 }, end: { x: x1, y: PAGE.height - top1 }, thickness, color: color(tint) });
  }

  image(image: PDFImage | PDFEmbeddedPage, x: number, top: number, width: number, height: number): void {
    if (image instanceof PDFEmbeddedPage) this.page.drawPage(image, { x, y: PAGE.height - top - height, width, height });
    else this.page.drawImage(image, { x, y: PAGE.height - top - height, width, height });
  }
}

/** Uma linha de um bloco: sabe a sua altura e desenha-se numa posição. */
interface Line {
  height: number;
  draw: (canvas: Canvas, x: number, top: number) => void;
  /** Um título não fica sozinho no fim da página. */
  keepWithNext?: boolean;
}

interface Block {
  title: string;
  lines: Line[];
  /** Título pequeno, a negro (listas). */
  small?: boolean;
  /** Espaço antes do bloco, em vez do habitual (as listas da equipa ficam juntas). */
  gapBefore?: number;
}

/** Uma faixa horizontal da página, com uma ou mais colunas de blocos. */
interface Band {
  columns: { width: number; blocks: Block[] }[];
  /** Começa já na página atual, mesmo que não caiba toda (continua na seguinte). */
  flow?: boolean;
}

function blockHeight(block: Block): number {
  return block.lines.reduce((sum, line) => sum + line.height, 0);
}

function columnHeight(blocks: Block[]): number {
  return blocks.reduce((sum, block, index) => sum + blockHeight(block) + (index > 0 ? (block.gapBefore ?? SPACE.blockGap) : 0), 0);
}

const value = (row: SheetRow, key: ColumnKey): string => row[key]?.value.trim() ?? '';

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function heading(title: string): Line {
  return {
    height: SIZE.heading * 1.12 + SPACE.headingGap,
    keepWithNext: true,
    draw: (canvas, x, top) => canvas.text(title, x, top, 'bold', SIZE.heading, COLOR.red, SIZE.heading * 1.12),
  };
}

/** Título das listas (Câmaras, EVS, …): mais pequeno, a negro. */
function subheading(title: string): Line {
  return {
    height: SIZE.subheading * 1.2 + SPACE.headingGap,
    keepWithNext: true,
    draw: (canvas, x, top) => canvas.text(title, x, top, 'bold', SIZE.subheading, COLOR.ink, SIZE.subheading * 1.2),
  };
}

/** Uma linha com texto em várias colunas; a altura ajusta-se ao texto mais comprido. */
function textRow(type: Typesetter, cells: { text: string; x: number; width: number; weight: Weight; tint: Rgb; size?: number }[]): Line {
  // Uma quebra de linha no texto (\n) começa uma linha nova (ex.: um passageiro por linha).
  const wrapped = cells.map((cell) => cell.text.split('\n').flatMap((part) => type.wrap(part, cell.weight, cell.size ?? SIZE.body, cell.width)));
  const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
  const step = SIZE.body * SPACE.lineHeight;
  return {
    height: SPACE.row + (lineCount - 1) * step,
    draw: (canvas, x, top) => {
      cells.forEach((cell, index) => {
        wrapped[index].forEach((line, lineIndex) => {
          canvas.text(line, x + cell.x, top + lineIndex * step, cell.weight, cell.size ?? SIZE.body, cell.tint, SPACE.row);
        });
      });
    },
  };
}

/** Equipa / Técnica: "Cargo  NOME", com os nomes alinhados numa coluna. */
function roleGroupBlock(type: Typesetter, title: string, sections: SectionDef[], document: CallSheetDocument, labelWidth: number, width: number): Block | null {
  const lines: Line[] = [heading(title)];
  for (const section of sections) {
    const names = document.sections[section.key].map((row) => value(row, 'name')).filter(Boolean);
    names.forEach((name, index) => {
      lines.push(
        textRow(type, [
          { text: index === 0 ? (section.roleLabel ?? section.title) : '', x: 0, width: labelWidth - 6, weight: 'bold', tint: COLOR.ink },
          { text: name, x: labelWidth, width: width - labelWidth, weight: 'medium', tint: COLOR.navy },
        ]),
      );
    });
  }
  return lines.length > 1 ? { title, lines } : null;
}

/** Lista numerada: Nº, nome, (trans/pk), estado. */
/** `nameX`: onde começam os nomes (alinhados com os nomes da Equipa). */
/** Listas com número à esquerda do nome (as outras só têm o nome). */
const NUMBERED_LISTS = new Set(['cameras', 'evs']);

function listBlock(type: Typesetter, section: SectionDef, rows: SheetRow[], width: number, nameX = 24): Block {
  const showNumber = NUMBERED_LISTS.has(section.key);
  const hasNumber = section.columns.some((column) => column.key === 'number');
  const hasTransport = rows.some((row) => value(row, 'transPk') !== '');
  const statusWidth = 30;
  const transportWidth = hasTransport ? 38 : 0;
  const numberWidth = nameX;
  const nameWidth = width - numberWidth - transportWidth - statusWidth - 4;
  const lines: Line[] = [subheading(section.title)];
  rows.forEach((row, index) => {
    const number = showNumber ? (hasNumber ? value(row, 'number') : String(index + 1)) : '';
    // O número fica encostado ao nome (alinhado à direita, logo antes dele).
    const numberX = Math.max(0, numberWidth - 8 - type.width(type.clean(number, 'semibold'), 'semibold', SIZE.body));
    const cells = [
      { text: number, x: numberX, width: numberWidth - numberX, weight: 'semibold' as Weight, tint: COLOR.ink },
      { text: value(row, 'name'), x: numberWidth, width: nameWidth, weight: 'medium' as Weight, tint: COLOR.navy },
    ];
    let x = numberWidth + nameWidth + 4;
    if (hasTransport) {
      cells.push({ text: value(row, 'transPk'), x, width: transportWidth - 4, weight: 'regular', tint: COLOR.navy });
      x += transportWidth;
    }
    cells.push({ text: value(row, 'status'), x, width: statusWidth - 2, weight: 'regular', tint: COLOR.navy });
    lines.push(textRow(type, cells));
  });
  return { title: section.title, lines, small: true };
}

/** Plano de trabalho: barras de fase (Pré-jogo, Intervalo, …) e linhas Hora | Descrição | Meios. */
function workPlanBlock(type: Typesetter, section: SectionDef, rows: SheetRow[], width: number): Block {
  const timeWidth = 44;
  const meansWidth = 62;
  const descriptionWidth = width - timeWidth - meansWidth - 8;
  const label = (key: ColumnKey): string => section.columns.find((column) => column.key === key)?.label ?? '';
  const columnHeader: Line = {
    ...textRow(type, [
      { text: label('time'), x: 0, width: timeWidth, weight: 'bold', tint: COLOR.ink, size: SIZE.columnHeader },
      { text: label('description'), x: timeWidth, width: descriptionWidth, weight: 'bold', tint: COLOR.ink, size: SIZE.columnHeader },
      { text: label('means'), x: timeWidth + descriptionWidth + 8, width: meansWidth, weight: 'bold', tint: COLOR.ink, size: SIZE.columnHeader },
    ]),
    keepWithNext: true,
  };
  // Barra de fase (Pré-jogo, Intervalo, Pós-jogo): faixa baixa, com o nome centrado.
  const barHeight = SIZE.phase * 1.55;
  const phaseBar = (phase: string): Line => ({
    height: barHeight + 6,
    keepWithNext: true,
    draw: (canvas, x, top) => {
      canvas.rect(x - 6, top + 3, width + 6, barHeight, COLOR.blush);
      canvas.centered(phase.toUpperCase(), x - 3 + (width + 6) / 2, top + 3, 'bold', SIZE.phase, COLOR.red, barHeight);
    },
  });

  const lines: Line[] = [heading(section.title)];
  let currentPhase: string | null = null;
  let headerShown = false;
  for (const row of rows) {
    const phase = value(row, 'phase');
    if (phase !== '' && phase !== currentPhase) {
      lines.push(phaseBar(phase));
      currentPhase = phase;
    }
    if (!headerShown) {
      lines.push(columnHeader);
      headerShown = true;
    }
    // Sem meios, a descrição pode ocupar também essa coluna.
    const means = value(row, 'means');
    lines.push(
      textRow(type, [
        { text: value(row, 'time'), x: 0, width: timeWidth - 4, weight: 'semibold', tint: COLOR.ink },
        { text: value(row, 'description'), x: timeWidth, width: means === '' ? width - timeWidth : descriptionWidth, weight: 'regular', tint: COLOR.navy },
        { text: means, x: timeWidth + descriptionWidth + 8, width: meansWidth, weight: 'regular', tint: COLOR.navy },
      ]),
    );
  }
  return { title: section.title, lines };
}

/** Logística: saída, origem e a tabela Condutor | Viatura | Passageiros. */
function logisticsBlock(type: Typesetter, section: SectionDef, document: CallSheetDocument, fields: HeaderFieldDef[], width: number): Block | null {
  const rows = document.sections[section.key] ?? [];
  // A logística aparece sempre, mesmo sem viaturas (fica a tabela para preencher).
  const lines: Line[] = [heading(section.title)];
  const timeLabel = fields.find((field) => field.key === 'departure')?.label ?? 'Saída';
  const placeLabel = fields.find((field) => field.key === 'origin')?.label ?? 'De';

  /** Linha "Saída: 07:30   De: Porto". */
  const departureLine = (time: string, place: string, gap: number): Line => {
    const parts = [time !== '' ? { label: `${timeLabel}:`, text: time } : null, place !== '' ? { label: `${placeLabel}:`, text: place } : null].filter(
      (part): part is { label: string; text: string } => part !== null,
    );
    return {
      height: SPACE.row + gap,
      keepWithNext: true,
      draw: (canvas, left, top) => {
        let cursor = left;
        const y = top + gap;
        for (const part of parts) {
          canvas.text(part.label, cursor, y, 'bold', SIZE.body, COLOR.ink, SPACE.row);
          cursor += type.width(part.label, 'bold', SIZE.body) + 4;
          const text = type.wrap(part.text, 'bold', SIZE.body, Math.max(40, left + width - cursor))[0] ?? '';
          canvas.text(text, cursor, y, 'bold', SIZE.body, COLOR.navy, SPACE.row);
          cursor += type.width(text, 'bold', SIZE.body) + 14;
        }
      },
    };
  };

  // Horas de saída gerais (pode haver várias).
  const departures = (document.sections.departures ?? []).filter((row) => value(row, 'time') !== '' || value(row, 'location') !== '');
  departures.forEach((row) => lines.push({ ...departureLine(value(row, 'time'), value(row, 'location'), 0), keepWithNext: false }));
  if (departures.length > 0) lines.push({ height: 4, draw: () => undefined });

  {
    // No PDF: Viatura, Condutor, Passageiros (um por linha). A hora e o local de saída de cada
    // viatura agrupam as linhas: cada saída tem uma linha "Saída: … De: …" por cima das suas viaturas.
    const order: ColumnKey[] = ['vehicle', 'name', 'passengers'];
    const columns = section.columns.filter((column) => order.includes(column.key)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const total = columns.reduce((sum, column) => sum + column.weight, 0);
    let x = 0;
    const layout = columns.map((column) => {
      const columnWidth = (column.weight / total) * width;
      const entry = { column, x, width: columnWidth - 6 };
      x += columnWidth;
      return entry;
    });
    const groups: { time: string; place: string; rows: SheetRow[] }[] = [];
    for (const row of rows) {
      const time = value(row, 'time');
      const place = value(row, 'location');
      const group = groups.find((candidate) => candidate.time === time && candidate.place === place);
      if (group) group.rows.push(row);
      else groups.push({ time, place, rows: [row] });
    }
    // Sem saídas por viatura: tudo como antes (só a saída geral do cabeçalho).
    const withDepartures = groups.some((group) => group.time !== '' || group.place !== '');
    if (groups.length === 0) groups.push({ time: '', place: '', rows: [] });

    let vehicleIndex = 0;
    groups.forEach((group, groupIndex) => {
      if (withDepartures && (group.time !== '' || group.place !== '')) lines.push(departureLine(group.time, group.place, groupIndex > 0 ? 4 : 0));
      if (groupIndex === 0 || withDepartures) {
        lines.push({
          ...textRow(
            type,
            layout.map((entry) => ({ text: entry.column.label, x: entry.x, width: entry.width, weight: 'bold' as Weight, tint: COLOR.ink, size: SIZE.columnHeader })),
          ),
          keepWithNext: true,
        });
      }
      for (const row of group.rows) {
        // Todas as viaturas com fundo suave, alternando dois tons: vê-se onde começa e acaba a equipa de cada uma.
        const tint = VEHICLE_TINTS[vehicleIndex++ % VEHICLE_TINTS.length];
        const content = textRow(
            type,
            layout.map((entry) => ({
              text: entry.column.key === 'passengers' ? value(row, 'passengers').split(/\s*[,;]\s*/).filter(Boolean).join('\n') : value(row, entry.column.key),
              x: entry.x,
              width: entry.width,
              weight: 'regular' as Weight,
              tint: COLOR.navy,
              size: SIZE.table,
            })),
          );
        lines.push({
          height: content.height + 3,
          draw: (canvas, left, top) => {
            canvas.rect(left - 3, top + 1, width + 3, content.height + 1, tint);
            content.draw(canvas, left, top + 1);
          },
        });
      }
    });
  }
  return { title: section.title, lines };
}


/** Mapa de câmaras: a imagem à largura da coluna, sem passar a altura máxima. */
function imageBlock(type: Typesetter, title: string, image: PDFImage | PDFEmbeddedPage, width: number, maxHeight: number, caption?: { label: string; text: string }): Block {
  const scale = Math.min(width / image.width, maxHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const lines: Line[] = title !== '' ? [heading(title)] : [];
  // Legenda ("Local: …") por cima da imagem, centrada com ela.
  if (caption && caption.text !== '') {
    const label = `${caption.label}: `;
    const labelWidth = type.width(label, 'bold', SIZE.body);
    const text = type.wrap(caption.text, 'bold', SIZE.body, width - labelWidth)[0] ?? '';
    const total = labelWidth + type.width(text, 'bold', SIZE.body);
    lines.push({
      height: SPACE.row + 2,
      keepWithNext: true,
      draw: (canvas, x, top) => {
        const left = x + (width - total) / 2;
        canvas.text(label.trim(), left, top, 'bold', SIZE.body, COLOR.ink, SPACE.row);
        canvas.text(text, left + labelWidth, top, 'bold', SIZE.body, COLOR.navy, SPACE.row);
      },
    });
  }
  lines.push({
    height: drawHeight + 2,
    draw: (canvas, x, top) => canvas.image(image, x + (width - drawWidth) / 2, top + 1, drawWidth, drawHeight),
  });
  return { title, lines };
}

/** Observações: caixa rosada, com o texto (se houver) ou em branco para notas à mão. */
function notesBlock(type: Typesetter, title: string, notes: string, width: number, minHeight: number): Block {
  const padding = 8;
  const paragraphs = notes.split(/\n+/).flatMap((paragraph) => type.wrap(paragraph, 'regular', SIZE.body, width - padding * 2));
  const step = SIZE.body * SPACE.lineHeight;
  const height = Math.max(minHeight, paragraphs.length * step + padding * 2);
  return {
    title,
    lines: [
      heading(title),
      {
        height,
        draw: (canvas, x, top) => {
          canvas.rect(x, top, width, height, COLOR.blush);
          paragraphs.forEach((line, index) => canvas.text(line, x + padding, top + padding + index * step, 'regular', SIZE.body, COLOR.navy, step));
        },
      },
    ],
  };
}

const NOTES_PADDING = 8;

/** Divide as observações: as linhas que cabem na caixa da 1.ª página e o texto que sobra. */
function splitNotes(type: Typesetter, notes: string, width: number, maxLines: number): { head: string; rest: string } {
  const paragraphs = notes.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const head: string[] = [];
  let used = 0;
  for (let index = 0; index < paragraphs.length; index++) {
    const lines = type.wrap(paragraphs[index], 'regular', SIZE.body, width - NOTES_PADDING * 2);
    if (used + lines.length <= maxLines) {
      head.push(paragraphs[index]);
      used += lines.length;
      continue;
    }
    const fit = maxLines - used;
    if (fit > 0) head.push(lines.slice(0, fit).join(' '));
    const rest = [lines.slice(Math.max(fit, 0)).join(' '), ...paragraphs.slice(index + 1)];
    return { head: head.join('\n'), rest: rest.join('\n') };
  }
  return { head: head.join('\n'), rest: '' };
}

/** Continuação das observações a toda a largura: uma linha de cada vez, para poder mudar de página. */
function notesFlowBlock(type: Typesetter, title: string, notes: string, width: number): Block {
  const lines = notes.split(/\n+/).flatMap((paragraph) => type.wrap(paragraph, 'regular', SIZE.body, width - NOTES_PADDING * 2));
  const step = SIZE.body * SPACE.lineHeight;
  return {
    title,
    lines: [
      heading(title),
      ...lines.map((text, index): Line => {
        const first = index === 0;
        const last = index === lines.length - 1;
        const height = step + (first ? NOTES_PADDING : 0) + (last ? NOTES_PADDING : 0);
        return {
          height,
          draw: (canvas, x, top) => {
            canvas.rect(x, top, width, height, COLOR.blush);
            canvas.text(text, x + NOTES_PADDING, top + (first ? NOTES_PADDING : 0), 'regular', SIZE.body, COLOR.navy, step);
          },
        };
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

class Composer {
  readonly pages: PDFPage[] = [];
  readonly canvas: Canvas;
  page = 0;
  y = 0;

  constructor(
    private readonly pdf: PDFDocument,
    type: Typesetter,
    private readonly runningTitle: string,
  ) {
    this.canvas = new Canvas(type);
    this.addPage();
  }

  get bottom(): number {
    return PAGE.height - PAGE.marginBottom - 22;
  }

  private addPage(): void {
    const page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    this.canvas.page = page;
    if (this.pages.length > 1) {
      // Páginas seguintes: uma linha discreta a identificar o documento.
      this.canvas.text(this.runningTitle, PAGE.marginX, PAGE.marginTop, 'semibold', SIZE.footer, COLOR.muted, 14);
      this.canvas.line(PAGE.marginX, PAGE.marginTop + 17, PAGE.width - PAGE.marginX, PAGE.marginTop + 17, 0.6, COLOR.rule);
    }
  }

  /** Passa para uma página nova, no topo. */
  newPage(): void {
    this.usePage(this.pages.length);
    this.y = this.nextPageTop();
  }

  /** Vai para a página `index`, criando-a se for preciso. */
  usePage(index: number): void {
    while (this.pages.length <= index) this.addPage();
    this.page = index;
    this.canvas.page = this.pages[index];
  }

  nextPageTop(): number {
    return PAGE.marginTop + 26;
  }

  /** Desenha uma coluna de blocos a partir de (page, y), mudando de página quando não cabe. */
  private flowColumn(blocks: Block[], x: number, startPage: number, startY: number): { page: number; y: number } {
    let page = startPage;
    let y = startY;
    blocks.forEach((block, blockIndex) => {
      if (blockIndex > 0) y += block.gapBefore ?? SPACE.blockGap;
      block.lines.forEach((line, lineIndex) => {
        const following = line.keepWithNext && block.lines[lineIndex + 1] ? block.lines[lineIndex + 1].height : 0;
        if (y + line.height + following > this.bottom && y > this.nextPageTop() + 1) {
          page++;
          y = this.nextPageTop();
          // Bloco a meio: repete o título na página nova.
          if (lineIndex > 0) {
            const cont = (block.small ? subheading : heading)(`${block.title} (cont.)`);
            this.usePage(page);
            cont.draw(this.canvas, x, y);
            y += cont.height;
          }
        }
        this.usePage(page);
        line.draw(this.canvas, x, y);
        y += line.height;
      });
    });
    return { page, y };
  }

  /** Coloca uma faixa: inteira na página atual, inteira na seguinte, ou a fluir por várias. */
  placeBand(band: Band): void {
    const columns = band.columns.filter((column) => column.blocks.length > 0);
    if (columns.length === 0) return;
    const height = Math.max(...columns.map((column) => columnHeight(column.blocks)));
    if (!band.flow && this.y + height > this.bottom && height <= this.bottom - this.nextPageTop() && this.y > this.nextPageTop() + 1) {
      this.usePage(this.page + 1);
      this.y = this.nextPageTop();
    }
    const start = { page: this.page, y: this.y };
    let end = start;
    let x = PAGE.marginX;
    for (const column of band.columns) {
      if (column.blocks.length > 0) {
        const finish = this.flowColumn(column.blocks, x, start.page, start.y);
        if (finish.page > end.page || (finish.page === end.page && finish.y > end.y)) end = finish;
      }
      x += column.width + SPACE.columnGap;
    }
    this.usePage(end.page);
    this.y = end.y + SPACE.blockGap + 4;
  }
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

function drawMasthead(composer: Composer, document: CallSheetDocument, logo: PDFImage | null, clientLogo: PDFImage | null): void {
  const { canvas } = composer;
  const type = canvas.type;
  const get = (key: HeaderKey): string => (document.header[key]?.value ?? '').trim();
  const top = PAGE.marginTop;
  const height = SPACE.mastheadHeight;

  // Logótipo (ou a marca BIG).
  if (logo) {
    const scale = Math.min(SPACE.logoWidth / logo.width, (height - 8) / logo.height);
    const width = logo.width * scale;
    const logoHeight = logo.height * scale;
    canvas.image(logo, PAGE.marginX, top + (height - logoHeight) / 2, width, logoHeight);
  } else {
    canvas.text('BIG', PAGE.marginX, top + 12, 'bold', 38, COLOR.ink, 38);
  }

  // Logótipo do cliente e data, à direita de um filete vertical.
  const ruleX = PAGE.width - PAGE.marginX - SPACE.pfWidth;
  const day = get('date');
  if (clientLogo || day !== '') {
    canvas.line(ruleX, top + 6, ruleX, top + height - 4, 1.2, COLOR.ink);
    const center = ruleX + (PAGE.width - PAGE.marginX - ruleX) / 2 + 4;
    if (clientLogo) {
      const boxWidth = SPACE.pfWidth - 16;
      const boxHeight = SIZE.pf + 2;
      const scale = Math.min(boxWidth / clientLogo.width, boxHeight / clientLogo.height);
      const width = clientLogo.width * scale;
      const logoHeight = clientLogo.height * scale;
      canvas.image(clientLogo, center - width / 2, top + 4 + (boxHeight - logoHeight) / 2, width, logoHeight);
    }
    canvas.centered(day, center, top + 6 + SIZE.pf + 2, 'semibold', type.fit(day, 'semibold', SIZE.day, SPACE.pfWidth - 8, 9), COLOR.ink, SIZE.day * 1.1);
  }

  // Canal, competição e jogo, ao centro.
  const left = PAGE.marginX + SPACE.logoWidth + 10;
  const right = ruleX - 12;
  const center = (left + right) / 2;
  const available = right - left;
  const candidates: { text: string; weight: Weight; size: number }[] = [
    { text: get('client'), weight: 'semibold', size: SIZE.client },
    { text: get('competition'), weight: 'bold', size: SIZE.competition },
    { text: get('event'), weight: 'semibold', size: SIZE.event },
  ];
  const titles = candidates.filter((title) => title.text !== '');
  if (titles.length === 0) titles.push({ text: 'CALL SHEET', weight: 'bold', size: SIZE.competition });
  const sized = titles.map((title) => ({ ...title, size: type.fit(title.text, title.weight, title.size, available, title.size * 0.55) }));
  const total = sized.reduce((sum, title) => sum + title.size * 1.05, 0);
  let y = top + Math.max(0, (height - total) / 2);
  for (const title of sized) {
    canvas.centered(title.text, center, y, title.weight, title.size, COLOR.ink, title.size * 1.05);
    y += title.size * 1.05;
  }
  composer.y = top + height + 8;
}

/** Linhas "Rótulo: valor | Rótulo: valor", centradas. */
function drawInfoLines(composer: Composer, document: CallSheetDocument, fields: HeaderFieldDef[]): void {
  const { canvas } = composer;
  const type = canvas.type;
  const item = (key: HeaderKey) => ({ label: fields.find((field) => field.key === key)?.label ?? '', text: fields.some((field) => field.key === key) ? (document.header[key]?.value ?? '').trim() : '' });
  const groups: { label: string; text: string }[][] = [
    // A data está no canto superior direito e o local por baixo do mapa de câmaras.
    [item('means'), item('kickoff'), item('setup')],
    [item('crew'), item('location')],
    // Outros campos encontrados no cabeçalho do documento original.
    document.header.others.map((extra) => ({ label: extra.label.trim(), text: extra.field.value.trim() })),
  ];
  const separatorWidth = SIZE.info * 2.2;
  const lineBox = SIZE.info * 1.55;
  const labelText = (entry: { label: string }): string => (entry.label === '' ? '' : `${entry.label}: `);
  const measure = (entry: { label: string; text: string }): number =>
    type.width(labelText(entry), 'semibold', SIZE.info) + type.width(type.clean(entry.text, 'regular'), 'regular', SIZE.info);

  for (const group of groups) {
    const items = group.filter((entry) => entry.text !== '');
    if (items.length === 0) continue;
    // Parte em linhas que caibam na largura.
    const rows: (typeof items)[] = [[]];
    let used = 0;
    for (const entry of items) {
      const current = rows[rows.length - 1];
      const width = measure(entry) + (current.length > 0 ? separatorWidth : 0);
      if (used + width > CONTENT_WIDTH && current.length > 0) {
        rows.push([entry]);
        used = measure(entry);
      } else {
        current.push(entry);
        used += width;
      }
    }
    for (const row of rows) {
      const widths = row.map(measure);
      const total = widths.reduce((sum, width) => sum + width, 0) + separatorWidth * (row.length - 1);
      let x = PAGE.width / 2 - Math.min(total, CONTENT_WIDTH) / 2;
      row.forEach((entry, index) => {
        if (index > 0) {
          canvas.centered('|', x + separatorWidth / 2, composer.y, 'regular', SIZE.info, COLOR.ink, lineBox);
          x += separatorWidth;
        }
        const label = labelText(entry).trim();
        if (label !== '') canvas.text(label, x, composer.y, 'semibold', SIZE.info, COLOR.ink, lineBox);
        const valueX = x + type.width(labelText(entry), 'semibold', SIZE.info);
        const valueWidth = Math.max(20, PAGE.width - PAGE.marginX - valueX);
        canvas.text(type.wrap(entry.text, 'regular', SIZE.info, valueWidth)[0] ?? '', valueX, composer.y, 'regular', SIZE.info, COLOR.navy, lineBox);
        x += widths[index];
      });
      composer.y += lineBox;
    }
  }
  composer.y += 10;
}

function drawFooters(composer: Composer, document: CallSheetDocument, generatedAt: Date): void {
  const { canvas } = composer;
  const total = composer.pages.length;
  const note = document.header.footer.value.trim();
  composer.pages.forEach((page, index) => {
    canvas.page = page;
    const top = PAGE.height - PAGE.marginBottom - 14;
    if (note !== '') canvas.text(note, PAGE.marginX, top, 'medium', SIZE.footer, COLOR.ink, 14);
    const credit = `Gerado com ${BRAND} em ${formatDateTime(generatedAt)}${total > 1 ? `   ·   Página ${index + 1} de ${total}` : ''}`;
    const width = canvas.type.width(credit, 'regular', SIZE.credit);
    canvas.text(credit, PAGE.width - PAGE.marginX - width, top + 3, 'regular', SIZE.credit, COLOR.muted, 10);
  });
}

// ---------------------------------------------------------------------------

async function embedLogo(pdf: PDFDocument, logo: PdfLogo | null | undefined): Promise<PDFImage | null> {
  if (!logo) return null;
  try {
    return logo.type === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
  } catch {
    return null;
  }
}

export async function generateCallSheetPdf(source: CallSheetDocument, template: CallSheetTemplate, options: PdfOptions): Promise<GeneratedPdf> {
  // Viaturas, condutores e passageiros deduzidos da equipa quando a logística está vazia.
  let document = withDepartures(withTeamLogistics(source));
  const generatedAt = options.generatedAt ?? new Date();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embed = (bytes: Uint8Array) => pdf.embedFont(bytes, { subset: true });
  const type = new Typesetter({
    regular: await embed(options.fonts.regular),
    medium: await embed(options.fonts.medium),
    semibold: await embed(options.fonts.semibold),
    bold: await embed(options.fonts.bold),
  });
  const logo = await embedLogo(pdf, options.logo);
  const clientLogo = await embedLogo(pdf, options.clientLogo);
  const include: PdfSections = { logistics: true, notes: true, cameraMap: true, vlt: true, ...options.include };
  // Sem a opção P-Vlt, as viaturas Vlt saem da logística.
  if (!include.vlt) {
    const drivers = (document.sections.drivers ?? []).filter((row) => !/^[PL]-Vlt$/.test(vehicleCode(row.vehicle?.value ?? '')));
    document = { ...document, sections: { ...document.sections, drivers } };
  }
  const cameraMap = include.cameraMap ? await embedLogo(pdf, options.cameraMap) : null;

  const get = (key: HeaderKey): string => (document.header[key]?.value ?? '').trim();
  const title = [get('competition'), get('event')].filter(Boolean).join(' - ') || 'CALL SHEET';
  pdf.setTitle([title, get('date')].filter(Boolean).join(' - '));
  pdf.setAuthor(BRAND);
  pdf.setCreator(BRAND);
  pdf.setProducer(BRAND);
  pdf.setSubject('Call sheet de produção');
  pdf.setLanguage('pt-PT');
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  const runningTitle = [get('pf') && (/^\d/.test(get('pf')) ? `PF ${get('pf')}` : get('pf')), get('event') || get('competition'), get('date')].filter(Boolean).join('   ·   ');
  const composer = new Composer(pdf, type, runningTitle);
  drawMasthead(composer, document, logo, clientLogo);
  drawInfoLines(composer, document, template.headerFields);

  const half = (CONTENT_WIDTH - SPACE.columnGap) / 2;
  const rowsOf = (section: SectionDef) => document.sections[section.key] ?? [];

  // Coluna da esquerda: Equipa, Técnica, Câmaras e as restantes listas, pela ordem do template.
  const roleSections = template.sections.filter((section) => section.layout === 'role');
  const labelWidth = Math.min(
    half * 0.45,
    Math.max(...roleSections.map((section) => type.width(section.roleLabel ?? section.title, 'bold', SIZE.body))) + 16,
  );
  // Todos os cargos num só bloco, com o título do primeiro grupo (Equipa).
  const orderedRoles = template.groups.flatMap((group) => roleSections.filter((section) => section.group === group.key));
  const teamTitle = template.groups[0]?.title ?? 'EQUIPA';
  const roleBlocks = [roleGroupBlock(type, teamTitle, orderedRoles, document, labelWidth, half)].filter((block): block is Block => block !== null);
  const lists = template.sections.filter((section) => section.layout === 'list' && rowsOf(section).length > 0);
  // Listas da equipa juntas, sem o espaço entre blocos, para sobrar lugar para o mapa de câmaras.
  const staff = [...roleBlocks, ...lists.map((section) => ({ ...listBlock(type, section, rowsOf(section), half, labelWidth), gapBefore: SPACE.tightGap }))];
  const available = composer.bottom - composer.y;
  const locationField = template.headerFields.find((field) => field.key === 'location');
  const location = { label: locationField?.label ?? 'Local', text: get('location') };

  const left = staff;

  // Coluna da direita: plano de trabalho, logística e observações (estas ocupam o que sobra da página).
  const tables = template.sections.filter((section) => section.layout === 'table');
  const plan = tables.find((section) => section.key === 'workPlan');
  const transport = tables.find((section) => section.key === 'drivers');
  const planBlock = plan && rowsOf(plan).length > 0 ? workPlanBlock(type, plan, rowsOf(plan), half) : null;
  const logistics = transport ? logisticsBlock(type, transport, document, template.headerFields.filter((field) => field.group === 'logistics'), half) : null;
  const above = [planBlock, logistics].filter((block): block is Block => block !== null);
  const notesField = template.headerFields.find((field) => field.key === 'notes');
  const notesTitle = (notesField?.label ?? 'Observações').toUpperCase();
  const notesHeading = notesBlock(type, notesTitle, '', half, 0).lines[0].height;
  const aboveHeight = columnHeight(above) + (above.length > 0 ? SPACE.blockGap : 0);
  // Observações ajustadas ao espaço que fica no fundo da primeira página; o que não couber
  // continua na página seguinte, a toda a largura e alinhado à esquerda.
  const room = available - aboveHeight - notesHeading - 4;
  const notesText = include.notes ? get('notes') : '';
  const step = SIZE.body * SPACE.lineHeight;
  const capacity = Math.floor((room - NOTES_PADDING * 2) / step);
  let notesHere: Block | null = null;
  let notesLater = '';
  if (include.notes) {
    if (room < SPACE.notesMinHeight || (capacity < 2 && notesText !== '')) {
      // Sem espaço na 1.ª página: as observações vão todas para a seguinte.
      notesLater = notesText;
      if (notesText === '') notesHere = notesBlock(type, notesTitle, '', half, SPACE.notesMinHeight);
    } else {
      // Se não couberem todas na primeira página, passam inteiras para a seguinte.
      const { rest } = splitNotes(type, notesText, half, capacity);
      if (rest === '') notesHere = notesBlock(type, notesTitle, notesText, half, room);
      else notesLater = notesText;
    }
  }

  composer.placeBand({
    flow: true,
    columns: [
      { width: half, blocks: left },
      { width: half, blocks: notesHere ? [...above, notesHere] : above },
    ],
  });

  if (notesLater !== '') {
    if (composer.page === 0) composer.newPage();
    const title = notesHere ? `${notesTitle} (cont.)` : notesTitle;
    composer.placeBand({ flow: true, columns: [{ width: CONTENT_WIDTH, blocks: [notesFlowBlock(type, title, notesLater, CONTENT_WIDTH)] }] });
  }

  // Mapa de câmaras na página seguinte, a toda a largura.
  const fullRoom = (withTitle: boolean, withCaption: boolean) =>
    composer.bottom - composer.y - (withTitle ? heading('').height : 0) - (withCaption ? SPACE.row + 2 : 0) - 8;
  if (cameraMap) {
    composer.newPage();
    const mapRoom = fullRoom(true, location.text !== '');
    composer.placeBand({ columns: [{ width: CONTENT_WIDTH, blocks: [imageBlock(type, 'MAPA DE CÂMARAS', cameraMap, CONTENT_WIDTH, mapRoom, location)] }] });
  }

  // Ficheiros acrescentados a seguir ao mapa: cada página do PDF (ou cada imagem) numa página.
  for (const extra of include.cameraMap ? options.extraFiles ?? [] : []) {
    let items: (PDFImage | PDFEmbeddedPage)[] = [];
    try {
      if (extra.kind === 'pdf') {
        const sourcePdf = await PDFDocument.load(extra.bytes, { ignoreEncryption: true });
        items = await pdf.embedPages(sourcePdf.getPages());
      } else {
        const image = await embedLogo(pdf, { bytes: extra.bytes, type: extra.kind });
        if (image) items = [image];
      }
    } catch {
      items = [];
    }
    for (const item of items) {
      composer.newPage();
      composer.placeBand({ columns: [{ width: CONTENT_WIDTH, blocks: [imageBlock(type, '', item, CONTENT_WIDTH, fullRoom(false, false))] }] });
    }
  }

  drawFooters(composer, document, generatedAt);
  const bytes = await pdf.save();
  return { bytes, fileName: pdfFileName(document, generatedAt), pageCount: composer.pages.length };
}
