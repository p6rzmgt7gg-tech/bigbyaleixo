/**
 * Geração do PDF. O documento é reconstruído a partir dos dados estruturados — texto
 * real, pesquisável e selecionável — com o layout do call sheet de referência:
 * cabeçalho (logo, canal, competição, jogo, PF), linha de informação, Equipa e Técnica
 * (cargo + nome), listas numeradas por função, plano de trabalho, logística e observações.
 * A imagem original não entra no PDF.
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { CallSheetTemplate, HeaderFieldDef, SectionDef } from '../templates';
import type { CallSheetDocument, ColumnKey, HeaderKey, SheetRow } from '../types/callSheet';
import { formatDateTime, pdfFileName } from '../utils/formatters';
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE, type Rgb } from './pdfStyles';

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
}

export interface PdfOptions {
  /** Por omissão, todas incluídas. */
  include?: Partial<PdfSections>;
  fonts: PdfFonts;
  /** Logótipo para o canto superior esquerdo. Sem logótipo, aparece a marca BIG. */
  logo?: PdfLogo | null;
  /** Mapa de câmaras (imagem), entre a logística e as observações. */
  cameraMap?: PdfLogo | null;
  /** Momento da geração (rodapé e, na falta de data, nome do ficheiro). */
  generatedAt?: Date;
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

  image(image: PDFImage, x: number, top: number, width: number, height: number): void {
    this.page.drawImage(image, { x, y: PAGE.height - top - height, width, height });
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

/** Lista numerada: Nº, nome, (trans/pk), estado, local. */
/** `nameX`: onde começam os nomes (alinhados com os nomes da Equipa). */
/** Listas com número à esquerda do nome (as outras só têm o nome). */
const NUMBERED_LISTS = new Set(['cameras', 'evs']);

function listBlock(type: Typesetter, section: SectionDef, rows: SheetRow[], width: number, nameX = 24): Block {
  const showNumber = NUMBERED_LISTS.has(section.key);
  const hasNumber = section.columns.some((column) => column.key === 'number');
  const hasTransport = rows.some((row) => value(row, 'transPk') !== '');
  const locationWidth = 24;
  const statusWidth = 30;
  const transportWidth = hasTransport ? 38 : 0;
  const numberWidth = nameX;
  const nameWidth = width - numberWidth - transportWidth - statusWidth - locationWidth - 4;
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
    cells.push({ text: value(row, 'location'), x: x + statusWidth, width: locationWidth, weight: 'regular', tint: COLOR.navy });
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
  const rows = document.sections[section.key];
  const meta = fields.filter((field) => document.header[field.key].value.trim() !== '');
  if (rows.length === 0 && meta.length === 0) return null;
  const lines: Line[] = [heading(section.title)];

  if (meta.length > 0) {
    const slot = width / Math.max(2, meta.length);
    lines.push({
      height: SPACE.row + 4,
      draw: (canvas, x, top) => {
        meta.forEach((field, index) => {
          const label = `${field.label}:`;
          const left = x + index * slot;
          canvas.text(label, left, top, 'bold', SIZE.body, COLOR.ink, SPACE.row);
          canvas.text(document.header[field.key].value, left + type.width(label, 'bold', SIZE.body) + 4, top, 'bold', SIZE.body, COLOR.navy, SPACE.row);
        });
      },
    });
  }

  if (rows.length > 0) {
    // No PDF: Viatura, Condutor, Passageiros (um por linha).
    const order: ColumnKey[] = ['vehicle', 'name', 'passengers'];
    const columns = [...section.columns].sort((a, b) => (order.indexOf(a.key) + 99) % 99 - ((order.indexOf(b.key) + 99) % 99));
    const total = columns.reduce((sum, column) => sum + column.weight, 0);
    let x = 0;
    const layout = columns.map((column) => {
      const columnWidth = (column.weight / total) * width;
      const entry = { column, x, width: columnWidth - 6 };
      x += columnWidth;
      return entry;
    });
    lines.push({
      ...textRow(
        type,
        layout.map((entry) => ({ text: entry.column.label, x: entry.x, width: entry.width, weight: 'bold' as Weight, tint: COLOR.ink, size: SIZE.columnHeader })),
      ),
      keepWithNext: true,
    });
    for (const row of rows) {
      lines.push(
        textRow(
          type,
          layout.map((entry) => ({
            text: entry.column.key === 'passengers' ? value(row, 'passengers').split(/\s*[,;]\s*/).filter(Boolean).join('\n') : value(row, entry.column.key),
            x: entry.x,
            width: entry.width,
            weight: 'regular' as Weight,
            tint: COLOR.navy,
            size: SIZE.table,
          })),
        ),
      );
    }
  }
  return { title: section.title, lines };
}

/** "Rótulo: valor" numa linha (o valor parte se for comprido), sem título de bloco. */
function labelLineBlock(type: Typesetter, label: string, text: string, width: number): Block {
  const labelText = `${label}:`;
  const labelWidth = type.width(labelText, 'bold', SIZE.body) + 4;
  const lines = type.wrap(text, 'bold', SIZE.body, width - labelWidth);
  const step = SIZE.body * SPACE.lineHeight;
  return {
    title: label,
    lines: [
      {
        height: SPACE.row + (lines.length - 1) * step,
        draw: (canvas, x, top) => {
          canvas.text(labelText, x, top, 'bold', SIZE.body, COLOR.ink, SPACE.row);
          lines.forEach((line, index) => canvas.text(line, x + labelWidth, top + index * step, 'bold', SIZE.body, COLOR.navy, SPACE.row));
        },
      },
    ],
  };
}

/** Mapa de câmaras: a imagem à largura da coluna, sem passar a altura máxima. */
function imageBlock(type: Typesetter, title: string, image: PDFImage, width: number, maxHeight: number, caption?: { label: string; text: string }): Block {
  const scale = Math.min(width / image.width, maxHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const lines: Line[] = [heading(title)];
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

function drawMasthead(composer: Composer, document: CallSheetDocument, logo: PDFImage | null): void {
  const { canvas } = composer;
  const type = canvas.type;
  const get = (key: HeaderKey): string => document.header[key].value.trim();
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

  // PF e dia, à direita de um filete vertical.
  const ruleX = PAGE.width - PAGE.marginX - SPACE.pfWidth;
  const pf = get('pf');
  // A data aparece só aqui, no canto superior direito (o dia, ou a data quando não há dia).
  const day = get('day') || get('date');
  if (pf !== '' || day !== '') {
    canvas.line(ruleX, top + 6, ruleX, top + height - 4, 1.2, COLOR.ink);
    const center = ruleX + (PAGE.width - PAGE.marginX - ruleX) / 2 + 4;
    const pfText = pf === '' ? '' : /^pf/i.test(pf) ? pf : `PF ${pf}`;
    const pfSize = type.fit(pfText, 'bold', SIZE.pf, SPACE.pfWidth - 12, 16);
    canvas.centered(pfText, center, top + 6, 'bold', pfSize, COLOR.ink, SIZE.pf);
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
  const item = (key: HeaderKey) => ({ label: fields.find((field) => field.key === key)?.label ?? '', text: document.header[key].value.trim() });
  const groups: { label: string; text: string }[][] = [
    // A data está no canto superior direito e o local por baixo do mapa de câmaras.
    [item('means'), item('kickoff'), item('setup')],
    [item('id'), item('crew'), item('missing'), item('lx'), item('pt')],
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

export async function generateCallSheetPdf(document: CallSheetDocument, template: CallSheetTemplate, options: PdfOptions): Promise<GeneratedPdf> {
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
  const include: PdfSections = { logistics: true, notes: true, cameraMap: true, ...options.include };
  const cameraMap = include.cameraMap ? await embedLogo(pdf, options.cameraMap) : null;

  const get = (key: HeaderKey): string => document.header[key].value.trim();
  const title = [get('competition'), get('event')].filter(Boolean).join(' - ') || 'CALL SHEET';
  pdf.setTitle([title, get('date')].filter(Boolean).join(' - '));
  pdf.setAuthor(BRAND);
  pdf.setCreator(BRAND);
  pdf.setProducer(BRAND);
  pdf.setSubject('Call sheet de produção');
  pdf.setLanguage('pt-PT');
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  const runningTitle = [get('pf') && (/^pf/i.test(get('pf')) ? get('pf') : `PF ${get('pf')}`), get('event') || get('competition'), get('date')].filter(Boolean).join('   ·   ');
  const composer = new Composer(pdf, type, runningTitle);
  drawMasthead(composer, document, logo);
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

  // Mapa de câmaras debaixo da equipa (coluna da esquerda), com o local por cima.
  // Ocupa o espaço que sobra nesta página; se não couber legível, passa para a página seguinte, a toda a largura.
  let mapBlock: Block | null = null;
  let mapBelow = false;
  if (cameraMap) {
    const captionHeight = location.text !== '' ? SPACE.row + 2 : 0;
    const room = available - columnHeight(staff) - SPACE.blockGap - heading('').height - captionHeight - 6;
    if (room >= SPACE.cameraMapMinHeight) mapBlock = imageBlock(type, 'MAPA DE CÂMARAS', cameraMap, half, Math.min(SPACE.cameraMapMaxHeight, room), location);
    else mapBelow = true;
  }
  const left = mapBlock ? [...staff, mapBlock] : staff;

  // Coluna da direita: plano de trabalho, logística (e o local, quando não acompanha o mapa) e observações.
  const tables = template.sections.filter((section) => section.layout === 'table');
  const plan = tables.find((section) => section.key === 'workPlan');
  const transport = tables.find((section) => section.key === 'drivers');
  const planBlock = plan && rowsOf(plan).length > 0 ? workPlanBlock(type, plan, rowsOf(plan), half) : null;
  const logistics = transport && include.logistics ? logisticsBlock(type, transport, document, template.headerFields.filter((field) => field.group === 'logistics'), half) : null;
  const locationBlock = !cameraMap && location.text !== '' ? labelLineBlock(type, location.label, location.text, half) : null;
  const above = [planBlock, logistics, locationBlock].filter((block): block is Block => block !== null);
  const notesField = template.headerFields.find((field) => field.key === 'notes');
  const notesTitle = (notesField?.label ?? 'Observações').toUpperCase();
  const notesHeading = notesBlock(type, notesTitle, get('notes'), half, 0).lines[0].height;

  const target = Math.min(columnHeight(left), available);
  const aboveHeight = columnHeight(above) + (above.length > 0 ? SPACE.blockGap : 0);
  // Metade do espaço que sobra até ao fundo da coluna da esquerda.
  const notesMin = Math.max(SPACE.notesMinHeight, (target - aboveHeight - notesHeading) / 2);
  const fitsBeside = aboveHeight + notesHeading + notesMin <= available;
  const notes = notesBlock(type, notesTitle, get('notes'), half, fitsBeside ? notesMin : SPACE.notesMinHeight);

  composer.placeBand({
    flow: true,
    columns: [
      { width: half, blocks: left },
      { width: half, blocks: include.notes ? [...above, notes] : above },
    ],
  });
  if (mapBelow && cameraMap) {
    composer.placeBand({ columns: [{ width: CONTENT_WIDTH, blocks: [imageBlock(type, 'MAPA DE CÂMARAS', cameraMap, CONTENT_WIDTH, SPACE.cameraMapMaxHeight * 2, location)] }] });
  }

  drawFooters(composer, document, generatedAt);
  const bytes = await pdf.save();
  return { bytes, fileName: pdfFileName(document, generatedAt), pageCount: composer.pages.length };
}
