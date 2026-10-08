/**
 * Blocos do call sheet (Câmaras, Realização, EVS, …): encontra os títulos, descobre
 * que linhas pertencem a cada um e distribui as células pelas colunas.
 *
 * Suporta os dois arranjos habituais, que podem coexistir na mesma folha:
 *  - título por cima das linhas ("CÂMARAS" e depois 1, 2, 3…);
 *  - função na primeira coluna de cada linha ("EVS | nome | ok | Pt").
 */
import type { CallSheetTemplate, SectionDef } from '../../templates';
import type { ColumnKey, Field, SectionKey, SheetRow } from '../../types/callSheet';
import { createRowId, emptyField } from '../../utils/fields';
import { combinedConfidence } from '../ocrEngine';
import { cellField, INFERRED_CONFIDENCE, numericField } from './values';
import {
  columnBounds,
  rowToTheRight,
  sameRow,
  tableSpan,
  verticalRulesAt,
  type LayoutCell,
  type PageLayout,
  type Span,
} from './geometry';
import { bestAliasScore, isPlainNumber, labelSimilarity, looksLikeName, normalizeLabel } from './text';

const STRONG_MATCH = 0.85;
const WEAK_MATCH = 0.6;
const CAMERA_PREFIXES = ['cam', 'camara', 'camera', 'camaras', 'cameras'];
/** Marcas de uma só tecla usadas como estado. */
const MARKS = ['?', 'x', 'X', '✓', '√', '-'];
/** Fases de um plano de trabalho. */
const PHASES = ['pre jogo', 'pos jogo', 'intervalo', 'montagem', 'desmontagem', 'ensaio', 'ensaios', 'transmissao', 'pre programa', 'pos programa', 'aquecimento'];

type GuideRole = ColumnKey | 'role';

interface Anchor {
  cell: LayoutCell;
  section: SectionDef;
  score: number;
  /** Número embutido no rótulo ("Câm 3"). */
  number?: Field;
  mode: 'inline' | 'above';
  /** Largura da tabela (se houver grelha). */
  span: Span | null;
  /** Limites da coluna onde o rótulo está. */
  column: { left: number | null; right: number | null };
  /** Faixa horizontal ocupada pelas linhas do bloco (títulos por cima). */
  extent: Span;
}

interface Guide {
  role: GuideRole;
  left: number;
  right: number;
}

interface GuideRow {
  y: number;
  span: Span | null;
  guides: Guide[];
  cells: Set<LayoutCell>;
  /** Faixa horizontal ocupada pelos cabeçalhos. */
  extent: Span;
}

interface BlockRow {
  cells: LayoutCell[];
  guides: GuideRow | null;
  /** Número vindo do rótulo ("Câm 3"). */
  number?: Field;
}

export interface SectionsResult {
  sections: Record<SectionKey, SheetRow[]>;
  /** Células usadas por blocos (títulos, cabeçalhos de coluna e linhas). */
  used: Set<LayoutCell>;
  /** Células de linhas de blocos que não couberam em nenhuma coluna do template. */
  leftovers: LayoutCell[];
  /** Blocos cujo título foi encontrado no documento. */
  found: Set<SectionKey>;
  /** Posição vertical do primeiro bloco: o que está acima é cabeçalho do documento. */
  top: number;
}

function withinSpan(x: number, span: Span, tolerance = 3): boolean {
  return x >= span.start - tolerance && x <= span.end + tolerance;
}

/** Agrupa células em linhas de texto, de cima para baixo. */
function groupRows(cells: LayoutCell[]): LayoutCell[][] {
  const rows: LayoutCell[][] = [];
  for (const cell of [...cells].sort((a, b) => a.yc - b.yc)) {
    const row = rows.find((candidate) => candidate.some((other) => sameRow(other, cell)));
    if (row) row.push(cell);
    else rows.push([cell]);
  }
  for (const row of rows) row.sort((a, b) => a.x0 - b.x0);
  return rows.sort((a, b) => a[0].yc - b[0].yc);
}

/** Como `groupRows`, mas exige o mesmo centro vertical (cabeçalhos de tabelas vizinhas podem estar desfasados). */
function groupLines(cells: LayoutCell[]): LayoutCell[][] {
  const rows: { yc: number; cells: LayoutCell[] }[] = [];
  for (const cell of [...cells].sort((a, b) => a.yc - b.yc)) {
    const row = rows.find((candidate) => Math.abs(candidate.yc - cell.yc) <= Math.max(cell.height, 1) * 0.35);
    if (row) {
      row.cells.push(cell);
      row.yc = row.cells.reduce((sum, member) => sum + member.yc, 0) / row.cells.length;
    } else {
      rows.push({ yc: cell.yc, cells: [cell] });
    }
  }
  return rows.map((row) => row.cells.sort((a, b) => a.x0 - b.x0));
}

export class SectionParser {
  private readonly anchors: Anchor[] = [];
  private readonly anchorCells = new Map<LayoutCell, Anchor>();
  private readonly guideRows: GuideRow[] = [];
  private readonly guideCells = new Set<LayoutCell>();
  private readonly used = new Set<LayoutCell>();
  private readonly leftovers: LayoutCell[] = [];
  private readonly vocabulary: Map<string, ColumnKey>;
  private readonly columnAliases = new Map<ColumnKey, string[]>();
  /** Títulos de grupo e títulos genéricos ("EQUIPA", "TÉCNICA"): separam blocos, não são dados. */
  private readonly dividers: string[];

  constructor(
    private readonly layout: PageLayout,
    private readonly template: CallSheetTemplate,
  ) {
    this.vocabulary = new Map();
    for (const [column, words] of Object.entries(template.vocabulary)) {
      for (const word of words ?? []) this.vocabulary.set(word, column as ColumnKey);
    }
    for (const section of template.sections) {
      for (const column of section.columns) this.columnAliases.set(column.key, [...(this.columnAliases.get(column.key) ?? []), ...column.aliases]);
    }
    this.dividers = [
      ...template.groups.map((group) => normalizeLabel(group.title)),
      ...template.genericTitles,
      // Títulos de campos de texto livre (Observações) também fecham o bloco anterior.
      ...template.headerFields.filter((field) => field.kind === 'note').flatMap((field) => field.aliases.filter((alias) => alias.length >= 5)),
    ];
  }

  private isDivider(cell: LayoutCell): boolean {
    return bestAliasScore(cell.norm, this.dividers) >= STRONG_MATCH;
  }

  /** Texto claramente maior do que o corrente: um título (mesmo que mal lido). */
  private isHeading(cell: LayoutCell): boolean {
    if (!/\p{L}{2}/u.test(cell.text) || bestAliasScore(cell.norm, PHASES) >= WEAK_MATCH) return false;
    // A altura de uma linha com acentos e descendentes ("Óscar Baptista") engana: em caixa
    // alta basta ser 1,6× maior; em caixa mista tem de ser bem maior.
    const letters = cell.text.replace(/[^\p{L}]/gu, '');
    const upper = letters.replace(/[^\p{Lu}]/gu, '').length / letters.length;
    return cell.height >= this.layout.textHeight * (upper >= 0.7 ? 1.6 : 2.3);
  }

  /** "Saída: 08:30" dentro de um bloco é um campo do cabeçalho, não uma linha do bloco. */
  private isHeaderLabel(cell: LayoutCell): boolean {
    const colon = cell.text.indexOf(':');
    if (colon <= 0 || colon > 30) return false;
    const label = normalizeLabel(cell.text.slice(0, colon));
    return this.template.headerFields.some((field) => bestAliasScore(label, field.aliases) >= STRONG_MATCH);
  }

  parse(): SectionsResult {
    this.findGuideRows();
    this.findAnchors();
    this.decideModes();

    const sections = Object.fromEntries(this.template.sections.map((section) => [section.key, [] as SheetRow[]])) as Record<SectionKey, SheetRow[]>;
    const unreadNumbers = new Map<SheetRow, Field>();
    for (const anchor of this.anchors) {
      this.used.add(anchor.cell);
      if (anchor.section.layout === 'table') {
        sections[anchor.section.key].push(...this.tableRows(anchor));
        continue;
      }
      const rows = anchor.mode === 'inline' ? this.inlineRows(anchor) : this.rowsBelow(anchor);
      for (const row of rows) {
        const built = this.buildRow(anchor.section, row);
        if (!built) continue;
        sections[anchor.section.key].push(built.row);
        if (built.unreadNumber) unreadNumbers.set(built.row, built.unreadNumber);
      }
    }
    for (const section of this.template.sections) {
      if (section.columns.some((column) => column.key === 'number')) repairNumberSequence(sections[section.key], unreadNumbers);
    }
    harmonizeVocabulary(Object.values(sections).flat(), this.template);
    for (const cell of this.guideCells) this.used.add(cell);

    const tops = [...this.anchors.map((anchor) => anchor.cell.y0), ...this.guideRows.map((row) => row.y)];
    return {
      sections,
      used: this.used,
      leftovers: this.leftovers,
      found: new Set(this.anchors.map((anchor) => anchor.section.key)),
      top: tops.length > 0 ? Math.min(...tops) : Infinity,
    };
  }

  // ---------------------------------------------------------------------------
  // Cabeçalhos de coluna ("Nº | Nome | Estado | Trans/Pk | Local")
  // ---------------------------------------------------------------------------

  private columnRole(cell: LayoutCell): { role: GuideRole; distinctive: boolean } | null {
    if (this.isDivider(cell) || cell.height > this.layout.textHeight * 1.5) return null;
    if (bestAliasScore(cell.norm, this.template.roleColumnAliases) >= STRONG_MATCH) return { role: 'role', distinctive: true };
    let best: { role: GuideRole; score: number } | null = null;
    for (const [key, aliases] of this.columnAliases) {
      const score = bestAliasScore(cell.norm, aliases);
      if (score >= STRONG_MATCH && (!best || score > best.score)) best = { role: key, score };
    }
    if (!best) return null;
    // "ok", "local" e "nº" também aparecem como valores ou rótulos; só os outros identificam a linha de cabeçalhos.
    const ambiguous = cell.norm === 'ok' || cell.norm === 'local' || cell.norm.length <= 2 || this.vocabulary.has(cell.norm);
    return { role: best.role, distinctive: !ambiguous };
  }

  /**
   * Um cabeçalho de tabela mal lido ("Paccanoiros") fica de fora; se a linha tiver outra
   * célula logo a seguir às reconhecidas, e a tabela do template tiver uma coluna em falta
   * nessa posição, a célula passa a ser esse cabeçalho.
   */
  private completeGuides(guides: Guide[], cells: LayoutCell[], group: LayoutCell[]): void {
    const roles = guides.map((guide) => guide.role);
    const section = this.template.sections.find(
      (candidate) => candidate.layout === 'table' && roles.every((role) => role === 'role' || candidate.columns.some((column) => column.key === role)),
    );
    if (!section) return;
    const order: ColumnKey[] = section.columns.map((column) => column.key).filter((key) => key !== 'phase');
    const last = cells[cells.length - 1];
    const spacing = cells.length > 1 ? (last.x0 - cells[0].x0) / (cells.length - 1) : this.layout.textHeight * 8;
    const next = order[order.indexOf(guides[guides.length - 1].role as ColumnKey) + 1];
    if (!next || roles.includes(next)) return;
    const candidate = this.layout.cells
      .filter((cell) => !group.includes(cell) && cell.x0 > last.x1 && cell.x0 - last.x0 < spacing * 1.6 && Math.abs(cell.yc - last.yc) < last.height * 0.6)
      .sort((a, b) => a.x0 - b.x0)[0];
    if (!candidate || /\d/.test(candidate.text)) return;
    guides[guides.length - 1].right = candidate.x0 - 2;
    guides.push({ role: next, left: candidate.x0 - 2, right: Infinity });
    group.push(candidate);
  }

  private findGuideRows(): void {
    const candidates = this.layout.cells
      .map((cell) => ({ cell, match: this.columnRole(cell) }))
      .filter((entry): entry is { cell: LayoutCell; match: { role: GuideRole; distinctive: boolean } } => entry.match !== null);

    // Inícios de blocos (títulos grandes): duas tabelas lado a lado separam-se aí.
    const headings = this.layout.cells.filter((cell) => this.isHeading(cell) && this.template.sections.some((section) => bestAliasScore(cell.norm, section.aliases) >= STRONG_MATCH));
    const maxGap = this.layout.textHeight * 20;
    for (const row of groupLines(candidates.map((entry) => entry.cell))) {
      // Uma linha de texto pode atravessar duas tabelas lado a lado: separa por tabela, por
      // início de bloco e por espaços muito grandes.
      const groups = new Map<string, LayoutCell[]>();
      let cluster = 0;
      // Só contam os títulos da faixa logo acima desta linha.
      const band = headings.filter((heading) => heading.yc < row[0].yc && row[0].yc - heading.yc < this.layout.rowPitch * 4);
      row.forEach((cell, index) => {
        const previous = row[index - 1];
        if (previous) {
          const gap = cell.x0 - previous.x1;
          const startsBlock = band.some((heading) => heading.x0 > previous.x1 && heading.x0 <= cell.x0 + this.layout.textHeight);
          if (gap > maxGap || startsBlock) cluster++;
        }
        const span = tableSpan(this.layout, cell);
        const key = `${cluster}|${span ? `${Math.round(span.start)}:${Math.round(span.end)}` : 'none'}`;
        groups.set(key, [...(groups.get(key) ?? []), cell]);
      });
      for (const group of groups.values()) {
        const matches = group.map((cell) => ({ cell, match: candidates.find((entry) => entry.cell === cell)!.match }));
        const roles = new Set(matches.map((entry) => entry.match.role));
        if (roles.size < 2 || !matches.some((entry) => entry.match.distinctive)) continue;
        const span = tableSpan(this.layout, group[0]);
        const sorted = [...matches].sort((a, b) => a.cell.x0 - b.cell.x0);
        const margin = this.layout.textHeight * 1.5;
        const guides = sorted.map(({ cell, match }, index) => {
          const bounds = columnBounds(this.layout, cell);
          // Sem grelha, as colunas encostam umas às outras: cada uma vai até onde começa a seguinte.
          const next = sorted[index + 1]?.cell;
          const previous = sorted[index - 1]?.cell;
          const left = bounds.left ?? (previous ? Math.min(cell.x0 - margin, Math.max(previous.x1, cell.x0 - margin)) : -Infinity);
          const right = bounds.right ?? (next ? next.x0 - 2 : Infinity);
          return { role: match.role, left, right };
        });
        this.completeGuides(guides, sorted.map((entry) => entry.cell), group);
        const extent = { start: Math.min(...group.map((cell) => cell.x0)), end: Math.max(...group.map((cell) => cell.x1)) };
        this.guideRows.push({ y: group[0].yc, span, guides, cells: new Set(group), extent });
        for (const cell of group) this.guideCells.add(cell);
      }
    }
    this.guideRows.sort((a, b) => a.y - b.y);
  }

  // ---------------------------------------------------------------------------
  // Títulos dos blocos
  // ---------------------------------------------------------------------------

  private matchSection(cell: LayoutCell): { section: SectionDef; score: number; number?: Field } | null {
    const numbered = /^([a-z ]+?) ?(\d{1,2})$/.exec(cell.norm);
    if (numbered && Math.max(...CAMERA_PREFIXES.map((prefix) => labelSimilarity(numbered[1], prefix))) >= WEAK_MATCH) {
      const section = this.template.sections.find((candidate) => candidate.key === this.template.numberedRoleSection);
      // "Câm 3" só é uma linha de câmara se tiver um nome à frente (no plano de trabalho, "CAM 05" é um meio).
      const named = rowToTheRight(this.layout, cell).some((other) => looksLikeName(other.text) && other.x0 - cell.x1 < this.layout.textHeight * 25);
      if (section && named) {
        const words = cell.source.words.filter((word) => /\d/.test(word.text));
        const confidence = words.length > 0 ? combinedConfidence(words) : cell.source.confidence;
        return { section, score: 1, number: { value: numbered[2], confidence, bbox: cell.source.bbox } };
      }
    }
    let best: { section: SectionDef; score: number } | null = null;
    for (const section of this.template.sections) {
      const score = bestAliasScore(cell.norm, section.aliases);
      if (score > (best?.score ?? 0)) best = { section, score };
    }
    return best && best.score >= WEAK_MATCH ? best : null;
  }

  private findAnchors(): void {
    const weak: Anchor[] = [];
    for (const cell of this.layout.cells) {
      if (this.guideCells.has(cell)) continue;
      const match = this.matchSection(cell);
      if (!match) continue;
      const anchor: Anchor = { cell, ...match, mode: 'above', span: tableSpan(this.layout, cell), column: columnBounds(this.layout, cell), extent: { start: 0, end: this.layout.width } };
      if (match.score >= STRONG_MATCH) this.anchors.push(anchor);
      else weak.push(anchor);
    }
    // Uma correspondência fraca (ex.: "Ceu" por "CCU") só conta se estiver alinhada
    // com títulos seguros — os nomes das pessoas nunca estão na coluna dos títulos.
    const tolerance = this.layout.textHeight * 1.5;
    for (const anchor of weak) {
      const aligned = this.anchors.some(
        (other) => Math.abs(other.cell.x0 - anchor.cell.x0) <= tolerance || Math.abs(other.cell.xc - anchor.cell.xc) <= tolerance,
      );
      if (aligned) this.anchors.push(anchor);
    }
    this.anchors.sort((a, b) => a.cell.yc - b.cell.yc || a.cell.x0 - b.cell.x0);
    for (const anchor of this.anchors) this.anchorCells.set(anchor.cell, anchor);
  }

  private isAnchor(cell: LayoutCell): boolean {
    return this.anchorCells.has(cell);
  }

  /** Células de dados na mesma linha do título, à direita, até ao título seguinte ou ao fim da tabela. */
  private inlineContent(anchor: Anchor): LayoutCell[] {
    const content: LayoutCell[] = [];
    const limit = anchor.span ? anchor.span.end : this.rightLimit(anchor);
    for (const cell of rowToTheRight(this.layout, anchor.cell)) {
      if (this.isAnchor(cell) || cell.xc > limit + 3) break;
      if (!this.guideCells.has(cell)) content.push(cell);
    }
    return content;
  }

  /**
   * Sem grelha: o bloco vai até onde começa o bloco seguinte à direita — contando só os
   * títulos cuja zona (do título até ao título seguinte por baixo, na mesma coluna)
   * abrange a altura deste bloco.
   */
  private rightLimit(anchor: Anchor): number {
    const { textHeight } = this.layout;
    let limit = this.layout.width;
    for (const other of this.anchors) {
      if (other.cell.x0 <= anchor.cell.x1 + textHeight * 4) continue;
      if (other.cell.y0 > anchor.cell.y1 + this.layout.rowPitch) continue;
      const next = this.anchors
        .filter((below) => below !== other && below.cell.y0 > other.cell.y1 && below.cell.x0 >= other.cell.x0 - textHeight * 4)
        .reduce((min, below) => Math.min(min, below.cell.y0), Infinity);
      if (anchor.cell.yc >= next) continue;
      limit = Math.min(limit, other.cell.x0 - textHeight);
    }
    return limit;
  }

  private leftLimit(anchor: Anchor): number {
    return anchor.cell.x0 - this.layout.textHeight * 4;
  }

  private isData(cell: LayoutCell): boolean {
    return !this.isAnchor(cell) && !this.guideCells.has(cell);
  }

  private decideModes(): void {
    for (const anchor of this.anchors) {
      const content = this.inlineContent(anchor);
      if (anchor.number) {
        anchor.mode = 'inline';
        continue;
      }
      if (anchor.span) {
        // Com grelha: um título por cima ocupa a largura toda da tabela (célula unida) ou,
        // numa grelha de títulos lado a lado, tem as pessoas na sua própria coluna.
        const { left, right } = anchor.column;
        const fullWidth = (left === null || left <= anchor.span.start + 4) && (right === null || right >= anchor.span.end - 4);
        const column: Span = { start: left ?? anchor.span.start, end: right ?? anchor.span.end };
        if (content.length > 0) anchor.mode = 'inline';
        else if (fullWidth) anchor.mode = 'above';
        else anchor.mode = this.dataBelow(anchor, column.start, column.end) ? 'above' : 'inline';
        anchor.extent = fullWidth ? anchor.span : column;
        continue;
      }
      // Sem grelha: um título tem as linhas por baixo, alinhadas consigo; numa tabela com a
      // função em cada linha, por baixo de um rótulo só há outros rótulos.
      const under = this.dataBelow(anchor, this.leftLimit(anchor), anchor.cell.x1);
      anchor.mode = !under && content.some((cell) => looksLikeName(cell.text) || this.vocabulary.has(cell.norm)) ? 'inline' : 'above';
      anchor.extent = { start: this.leftLimit(anchor), end: this.rightLimit(anchor) };
    }
  }

  /** Há células de dados logo por baixo do título, entre `left` e `right`? */
  private dataBelow(anchor: Anchor, left: number, right: number): boolean {
    const reach = anchor.cell.y1 + this.layout.rowPitch * 2.6;
    const below = this.layout.cells
      .filter((cell) => cell.yc > anchor.cell.y1 && cell.y0 < reach && cell.x0 < right && cell.x1 > left)
      .sort((a, b) => a.yc - b.yc);
    for (const cell of below) {
      if (this.isAnchor(cell) || this.isDivider(cell)) return false;
      if (this.guideCells.has(cell)) continue;
      if (looksLikeName(cell.text)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Linhas de cada bloco
  // ---------------------------------------------------------------------------

  /** Cabeçalhos de coluna aplicáveis a uma linha de dados: os mais próximos por cima, na mesma tabela. */
  private guidesFor(y: number, span: Span | null, from: number, extent: Span): GuideRow | null {
    let best: GuideRow | null = null;
    for (const row of this.guideRows) {
      if (row.y >= y || row.y < from) continue;
      // Os cabeçalhos têm de estar sobretudo dentro da faixa do bloco (não só a tocar-lhe).
      const overlap = Math.min(row.extent.end, extent.end) - Math.max(row.extent.start, extent.start);
      if (overlap < (row.extent.end - row.extent.start) * 0.5) continue;
      if (span && row.span && (row.span.end < span.start || row.span.start > span.end)) continue;
      if (Boolean(span) !== Boolean(row.span)) continue;
      best = row;
    }
    return best;
  }

  /** A grelha continua na altura `y`? (um traço vertical a atravessá-la ou um traço horizontal logo por baixo) */
  private gridContinues(y: number, extent: Span): boolean {
    if (verticalRulesAt(this.layout, y).some((position) => withinSpan(position, extent))) return true;
    return this.layout.rules.some(
      (rule) => rule.orientation === 'h' && rule.position > y && rule.position - y <= this.layout.rowPitch * 1.3 && rule.end > extent.start && rule.start < extent.end,
    );
  }

  private rowsBelow(anchor: Anchor): BlockRow[] {
    const { textHeight, rowPitch } = this.layout;
    const { extent } = anchor;
    const below = this.layout.cells.filter((cell) => cell !== anchor.cell && cell.yc > anchor.cell.y1 && withinSpan(cell.xc, extent));
    const rows: BlockRow[] = [];
    let previousBottom = anchor.cell.y1;
    for (const cells of groupRows(below)) {
      if (cells.some((cell) => this.isAnchor(cell) || this.isDivider(cell) || this.isHeading(cell))) break;
      const y = cells[0].yc;
      // Com grelha, o bloco acaba onde a grelha acaba; sem grelha, quando aparece um espaço em branco.
      if (anchor.span ? !this.gridContinues(y, extent) : cells[0].y0 - previousBottom > rowPitch * 2.2 + textHeight) break;
      previousBottom = Math.max(...cells.map((cell) => cell.y1));
      const data = cells.filter((cell) => !this.guideCells.has(cell) && !this.used.has(cell) && !this.isHeaderLabel(cell));
      if (data.length === 0) continue;
      rows.push({ cells: data, guides: this.guidesFor(y, anchor.span, anchor.cell.y0, extent) });
    }
    return rows;
  }

  private inlineRows(anchor: Anchor): BlockRow[] {
    const { textHeight, rowPitch } = this.layout;
    const limit = anchor.span ? anchor.span.end : this.rightLimit(anchor);
    // A coluna dos rótulos: tudo o que aí aparecer começa outro bloco.
    const labels = anchor.span
      ? { start: anchor.column.left ?? anchor.cell.x0 - textHeight, end: anchor.column.right ?? anchor.cell.x1 + textHeight }
      : this.labelColumn(anchor);

    const rows: BlockRow[] = [];
    const first = this.inlineContent(anchor).filter((cell) => !this.used.has(cell));
    const guidesAt = (y: number): GuideRow | null => this.guidesFor(y, anchor.span, -Infinity, { start: labels.start, end: limit });
    if (first.length > 0 || anchor.number) rows.push({ cells: first, guides: guidesAt(anchor.cell.yc), number: anchor.number });
    if (anchor.number) return rows;

    const below = this.layout.cells.filter((cell) => cell.yc > anchor.cell.y1 && !sameRow(cell, anchor.cell));
    let previousBottom = anchor.cell.y1;
    for (const cells of groupRows(below)) {
      const y = cells[0].yc;
      if (cells.some((cell) => cell.x1 > labels.start && cell.x0 < labels.end)) break;
      const content = cells.filter((cell) => cell.x0 >= labels.end - 3 && cell.xc <= limit + 3 && this.isData(cell) && !this.used.has(cell));
      if (anchor.span) {
        if (!this.gridContinues(y, anchor.span)) break;
      } else if (content.length > 0 && content[0].y0 - previousBottom > rowPitch * 1.6 + textHeight) {
        break;
      }
      if (content.length === 0) continue;
      previousBottom = Math.max(...content.map((cell) => cell.y1));
      rows.push({ cells: content, guides: guidesAt(y) });
    }
    return rows;
  }

  /**
   * Blocos com tabela própria (plano de trabalho, logística): as colunas vêm do cabeçalho
   * da tabela; uma linha só com texto em caixa alta é uma fase ("PRÉ-JOGO"); uma linha
   * sem a primeira coluna é a continuação da anterior (texto partido em duas linhas).
   */
  private tableRows(anchor: Anchor): SheetRow[] {
    const section = anchor.section;
    const hasPhase = section.columns.some((column) => column.key === 'phase');
    const lead = section.columns.find((column) => column.key !== 'phase')?.key;
    const out: SheetRow[] = [];
    let phase: Field | null = null;
    let phaseChanged = false;
    let previousY = -Infinity;
    for (const blockRow of this.rowsBelow(anchor)) {
      const cells = blockRow.cells;
      if (hasPhase && cells.length === 1 && this.isPhase(cells[0])) {
        this.used.add(cells[0]);
        phase = { ...cellField(cells[0]) };
        phaseChanged = true;
        continue;
      }
      const built = this.buildRow(section, blockRow, true);
      if (!built) continue;
      const row = built.row;
      const previous = phaseChanged ? undefined : out[out.length - 1];
      phaseChanged = false;
      const y = Math.min(...blockRow.cells.map((cell) => cell.yc));
      // Mais perto da linha anterior do que o espaçamento normal entre linhas: é texto partido.
      const tight = y - previousY < this.layout.rowPitch * 0.9;
      previousY = y;
      if (previous && lead && !row[lead]?.value && (tight || this.continues(previous, row, section))) {
        for (const column of section.columns) {
          const addition = row[column.key];
          if (!addition?.value || column.key === 'phase') continue;
          const target = previous[column.key];
          previous[column.key] = target?.value
            ? { ...target, value: `${target.value} ${addition.value}`, confidence: Math.min(target.confidence ?? 1, addition.confidence ?? 1) }
            : addition;
        }
        continue;
      }
      if (hasPhase && phase) row.phase = { ...phase };
      out.push(row);
    }
    return out;
  }

  /**
   * Uma linha sem a primeira coluna continua a anterior quando o texto parte a meio:
   * começa em minúscula, ou a anterior acaba em vírgula, "+", "-" ou "e".
   */
  private continues(previous: SheetRow, row: SheetRow, section: SectionDef): boolean {
    return section.columns.some((column) => {
      const text = row[column.key]?.value ?? '';
      if (text === '') return false;
      const before = previous[column.key]?.value ?? '';
      return /^\p{Ll}/u.test(text) || /[,+\-–]\s*$|\se$/u.test(before);
    });
  }

  private isPhase(cell: LayoutCell): boolean {
    if (/\d/.test(cell.text)) return false;
    if (bestAliasScore(cell.norm, PHASES) >= WEAK_MATCH) return true;
    // Uma só palavra em caixa alta ("PRÉ-JOGO"); um nome em caixa alta tem duas ou mais.
    const letters = cell.text.replace(/[^\p{L}]/gu, '');
    return letters.length >= 4 && letters === letters.toUpperCase() && !cell.text.trim().includes(' ');
  }

  /** Sem grelha: a coluna dos rótulos é a faixa ocupada pelos títulos alinhados com este. */
  private labelColumn(anchor: Anchor): Span {
    const tolerance = this.layout.textHeight * 2;
    const stack = this.anchors.filter((other) => other.mode === 'inline' && Math.abs(other.cell.x0 - anchor.cell.x0) <= tolerance);
    return {
      start: Math.min(...stack.map((other) => other.cell.x0)) - this.layout.textHeight,
      end: Math.max(...stack.map((other) => other.cell.x1)) + this.layout.textHeight * 0.5,
    };
  }

  // ---------------------------------------------------------------------------
  // Células → colunas
  // ---------------------------------------------------------------------------

  private buildRow(section: SectionDef, row: BlockRow, byGuidesOnly = false): { row: SheetRow; unreadNumber: Field | null } | null {
    const wanted = new Set(section.columns.map((column) => column.key));
    const assigned = new Map<ColumnKey, Field>();
    const taken = new Set<LayoutCell>();
    const pending: LayoutCell[] = [];
    // Algo na posição do número que não se conseguiu ler como número.
    let unreadNumber: LayoutCell | null = null;

    for (const cell of row.cells) {
      this.used.add(cell);
      const guide = row.guides?.guides.find((candidate) => cell.xc >= candidate.left && cell.xc <= candidate.right);
      if (!guide) {
        pending.push(cell);
      } else if (guide.role !== 'role' && wanted.has(guide.role) && assigned.has(guide.role) && byGuidesOnly) {
        // Duas células na mesma coluna (texto partido por um espaço maior): junta-as.
        const field = assigned.get(guide.role)!;
        assigned.set(guide.role, { ...field, value: `${field.value} ${cell.text}`, confidence: Math.min(field.confidence ?? 1, cell.source.confidence) });
        taken.add(cell);
      } else if (guide.role !== 'role' && wanted.has(guide.role) && !assigned.has(guide.role)) {
        const field = guide.role === 'number' ? numericField(cell) : cellField(cell);
        if (field) {
          assigned.set(guide.role, field);
          taken.add(cell);
        } else {
          unreadNumber = cell;
        }
      }
    }
    if (byGuidesOnly) {
      // Sem cabeçalho aplicável: as células vão para as colunas pela ordem. Estados e locais
      // ("ok", "Lx") não pertencem a estas tabelas e ficam por atribuir.
      const free = section.columns.filter((column) => column.key !== 'phase' && !assigned.has(column.key));
      for (const cell of pending.filter((candidate) => !this.vocabulary.has(candidate.norm))) {
        const column = free.shift();
        if (!column) break;
        assigned.set(column.key, cellField(cell));
        taken.add(cell);
      }
    } else {
      unreadNumber = this.assignByContent(pending, assigned, wanted, taken) ?? unreadNumber;
    }
    if (row.number) assigned.set('number', row.number);
    if (row.cells.length === 1 && !byGuidesOnly) this.splitCompoundName(assigned, wanted);
    if (assigned.has('number')) unreadNumber = null;
    if (unreadNumber) taken.add(unreadNumber);

    // Nada do que está no documento se perde em silêncio: o que não coube nas colunas é reportado.
    for (const cell of row.cells) if (!taken.has(cell)) this.leftovers.push(cell);

    if (assigned.size === 0 || (assigned.size === 1 && assigned.has('number') && !row.number)) return null;
    const built: SheetRow = { id: createRowId() };
    for (const column of section.columns) built[column.key] = assigned.get(column.key) ?? emptyField();
    return { row: built, unreadNumber: unreadNumber ? cellField(unreadNumber) : null };
  }

  /**
   * Sem cabeçalhos de coluna: decide pelo conteúdo e pela ordem das células.
   * Devolve a célula que está na posição do número mas não se leu como número, se houver.
   */
  private assignByContent(cells: LayoutCell[], assigned: Map<ColumnKey, Field>, wanted: Set<ColumnKey>, taken: Set<LayoutCell>): LayoutCell | null {
    const unknown: LayoutCell[] = [];
    let unreadNumber: LayoutCell | null = null;
    let nameCell: LayoutCell | null = null;
    let previous: LayoutCell | null = null;
    for (const cell of cells) {
      const known = this.vocabulary.get(cell.norm);
      const name = assigned.get('name');
      const numeric = !name && !assigned.has('number') && wanted.has('number') ? numericField(cell) : null;
      if (known && wanted.has(known) && !assigned.has(known)) {
        assigned.set(known, cellField(cell));
        taken.add(cell);
      } else if (!name && !wanted.has('number') && isPlainNumber(cell.text)) {
        // Numeração da lista (1, 2, 3…): a ordem já é guardada pela posição da linha.
        taken.add(cell);
      } else if (numeric) {
        assigned.set('number', numeric);
        taken.add(cell);
      } else if (!name && !known && looksLikeName(cell.text)) {
        assigned.set('name', cellField(cell));
        taken.add(cell);
        nameCell = cell;
      } else if (name && nameCell && previous === nameCell && !known && looksLikeName(cell.text) && cell.x0 - nameCell.x1 <= this.layout.textHeight * 3) {
        // Um nome partido em dois segmentos por um espaço mais largo.
        name.value = `${name.value} ${cell.text}`;
        name.confidence = Math.min(name.confidence ?? 1, cell.source.confidence);
        if (name.bbox) name.bbox = { ...name.bbox, x1: cell.x1, y0: Math.min(name.bbox.y0, cell.y0), y1: Math.max(name.bbox.y1, cell.y1) };
        taken.add(cell);
        nameCell = cell;
      } else if (!name && !known && wanted.has('number') && cell.text.length <= 2) {
        unreadNumber = cell;
      } else if (name && !known && (/\p{L}/u.test(cell.text) || MARKS.includes(cell.text))) {
        unknown.push(cell);
      }
      previous = cell;
    }
    // O que sobra à direita do nome: a última coluna do template é o local; a do meio, o transporte.
    const free = (['status', 'transPk', 'location'] as ColumnKey[]).filter((column) => wanted.has(column) && !assigned.has(column));
    for (const cell of unknown.reverse()) {
      const column = free.pop();
      if (!column) break;
      assigned.set(column, cellField(cell));
      taken.add(cell);
    }
    return unreadNumber;
  }

  /**
   * "3 Ana Silva ok Pt" numa só célula (colunas muito juntas, sem traços): separa as partes.
   * Só se aplica a siglas curtas no fim — "Maria Porto" é um apelido, não um local.
   */
  private splitCompoundName(assigned: Map<ColumnKey, Field>, wanted: Set<ColumnKey>): void {
    const name = assigned.get('name');
    if (!name) return;
    const words = name.value.split(/\s+/);
    if (words.length > 2 && isPlainNumber(words[0])) {
      const number = words.shift()!;
      if (wanted.has('number') && !assigned.has('number')) assigned.set('number', { ...name, value: number });
    }
    while (words.length > 2) {
      const last = words[words.length - 1];
      const column = last.length <= 3 ? this.vocabulary.get(normalizeLabel(last)) : undefined;
      if (!column || !wanted.has(column) || assigned.has(column)) break;
      assigned.set(column, { ...name, value: words.pop()! });
    }
    assigned.set('name', { ...name, value: words.join(' ') });
  }
}

/** Confiança de um valor reposto a partir do contexto: fica sempre para confirmar. */
const REPAIRED_CONFIDENCE = 0.75;

/**
 * Os números das câmaras são uma sequência. Quando o OCR leu mal um deles (um "11" vira
 * "u", um "6" vira "O") e os vizinhos de cima e de baixo dizem qual é, repõe-se o valor —
 * marcado para confirmar. Uma célula em que não se leu nada continua vazia.
 */
function repairNumberSequence(rows: SheetRow[], unreadNumbers: Map<SheetRow, Field>): void {
  const numberAt = (index: number): number | null => {
    const value = rows[index]?.number?.value ?? '';
    return isPlainNumber(value) ? Number(value) : null;
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const current = numberAt(i);
    const unread = unreadNumbers.get(row);
    const doubtful = current !== null && (row.number?.confidence ?? 1) < 0.9;
    if (!unread && !doubtful) continue;
    const before = i === 0 ? 0 : numberAt(i - 1);
    const after = numberAt(i + 1);
    if (before === null || after === null || after - before !== 2 || current === before + 1) continue;
    row.number = { value: String(before + 1), confidence: REPAIRED_CONFIDENCE, bbox: unread?.bbox ?? row.number?.bbox };
  }
}

type CasePattern = 'upper' | 'lower' | 'title';

function casePattern(value: string): CasePattern | null {
  if (!/^\p{L}{2,3}$/u.test(value)) return null;
  if (value === value.toUpperCase()) return 'upper';
  if (value === value.toLowerCase()) return 'lower';
  return value === value[0].toUpperCase() + value.slice(1).toLowerCase() ? 'title' : null;
}

function applyCase(value: string, pattern: CasePattern): string {
  if (pattern === 'upper') return value.toUpperCase();
  if (pattern === 'lower') return value.toLowerCase();
  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * Colunas de vocabulário fechado (estado, local): uniformiza variações de leitura.
 * Em letra pequena o OCR hesita entre "Lx" e "LX", ou lê "Dk" onde quase todas as
 * células dizem "ok": adota-se a forma dominante da coluna.
 */
function harmonizeVocabulary(rows: SheetRow[], template: CallSheetTemplate): void {
  for (const column of Object.keys(template.vocabulary) as ColumnKey[]) {
    const fields = rows.map((row) => row[column]).filter((field): field is Field => Boolean(field && field.value));

    // Maiúsculas/minúsculas das siglas: segue o padrão dominante da coluna.
    const patterns = new Map<CasePattern, number>();
    for (const field of fields) {
      const pattern = casePattern(field.value);
      if (pattern) patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
    }
    const total = [...patterns.values()].reduce((sum, count) => sum + count, 0);
    const dominantPattern = [...patterns.entries()].find(([, count]) => count >= 3 && count >= total * 0.7)?.[0];
    if (dominantPattern) {
      for (const field of fields) if (casePattern(field.value)) field.value = applyCase(field.value, dominantPattern);
    }

    // Uma letra trocada numa sigla que domina a coluna.
    const counts = new Map<string, number>();
    for (const field of fields) counts.set(field.value, (counts.get(field.value) ?? 0) + 1);
    const known = new Set(template.vocabulary[column] ?? []);
    for (const field of fields) {
      // Uma sigla desconhecida ("Ft") a uma letra da dominante ("Pt") corrige-se mesmo com confiança alta.
      if (field.value.length > 3 || ((field.confidence ?? 0) >= 0.9 && known.has(normalizeLabel(field.value)))) continue;
      const dominant = [...counts.entries()].find(
        ([value, count]) => value !== field.value && count >= 3 && count >= fields.length * 0.5 && value.length === field.value.length && differsByOneCharacter(value, field.value),
      );
      if (!dominant) continue;
      field.value = dominant[0];
      field.confidence = Math.min(field.confidence ?? 0, INFERRED_CONFIDENCE);
    }
  }
}

function differsByOneCharacter(a: string, b: string): boolean {
  let differences = 0;
  for (let i = 0; i < a.length; i++) if (a[i].toLowerCase() !== b[i].toLowerCase()) differences++;
  return differences === 1;
}
