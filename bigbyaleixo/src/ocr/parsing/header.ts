/**
 * Cabeçalho do call sheet: campos com rótulo ("PF", "Nº elementos", "Faltam", …) e, na
 * falta de rótulo, os que se reconhecem pela forma (uma data, um local, o título).
 */
import type { CallSheetTemplate, HeaderFieldDef } from '../../templates';
import type { ExtraHeaderField, Field, HeaderKey } from '../../types/callSheet';
import { emptyField } from '../../utils/fields';
import { horizontalOverlap, rowToTheRight, rulesBetween, type LayoutCell, type PageLayout } from './geometry';
import { bestAliasScore, countLetters, isPlainNumber, looksLikeName, normalizeLabel } from './text';
import { cellField, INFERRED_CONFIDENCE, numericField, wordsField } from './values';

const LABEL_MATCH = 0.85;
/** Texto solto do cabeçalho lido com menos confiança do que isto é ruído (restos de grelha, logótipos). */
const MIN_EXTRA_CONFIDENCE = 0.4;

const WEEKDAY = /\b(seg|segunda|ter|terca|qua|quarta|qui|quinta|sex|sexta|sab|sabado|dom|domingo)\b/;
const MONTH = /\b(jan|janeiro|fev|fevereiro|mar|marco|abr|abril|mai|maio|jun|junho|jul|julho|ago|agosto|set|setembro|out|outubro|nov|novembro|dez|dezembro)\b/;
const NUMERIC_DATE = /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/;
const VENUE = /\b(pavilhao|estadio|arena|coliseu|teatro|estudio|estudios|forum|multiusos|auditorio|campo|complexo|centro|casino|autodromo|circuito|piscina|piscinas|hipodromo|altice|meo)\b/;

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function looksLikeDate(text: string): boolean {
  const folded = fold(text);
  if (NUMERIC_DATE.test(folded)) return true;
  return (WEEKDAY.test(folded) || MONTH.test(folded)) && /\d/.test(folded) ? true : WEEKDAY.test(folded) && MONTH.test(folded);
}

export function looksLikePlace(text: string): boolean {
  const folded = fold(text);
  if (VENUE.test(folded)) return true;
  const parts = text.split(',');
  return parts.length === 2 && parts.every((part) => countLetters(part) >= 3);
}

interface Label {
  cell: LayoutCell;
  definition: HeaderFieldDef;
  /** Valor na própria célula ("PF 26.1042", "Local: Porto"). */
  inline: Field | null;
}

export interface HeaderResult {
  header: Record<HeaderKey, Field> & { others: ExtraHeaderField[] };
  used: Set<LayoutCell>;
}

function accepts(definition: HeaderFieldDef, cell: LayoutCell): Field | null {
  switch (definition.kind) {
    case 'count':
      return numericField(cell);
    case 'code':
      return /\d/.test(cell.text) ? cellField(cell) : null;
    case 'place':
      return looksLikeName(cell.text) ? cellField(cell) : null;
    default:
      return cellField(cell);
  }
}

export function parseHeader(layout: PageLayout, template: CallSheetTemplate, taken: Set<LayoutCell>, blocksTop: number): HeaderResult {
  const { textHeight, rowPitch } = layout;
  const free = layout.cells.filter((cell) => !taken.has(cell));
  const inZone = (cell: LayoutCell): boolean => cell.yc < blocksTop;
  const used = new Set<LayoutCell>();

  // 1. Rótulos conhecidos, sozinhos numa célula ou seguidos do valor.
  const labels: Label[] = [];
  const labelCells = new Set<LayoutCell>();
  for (const cell of free) {
    for (const definition of template.headerFields) {
      if (bestAliasScore(cell.norm, definition.aliases) >= LABEL_MATCH) {
        labels.push({ cell, definition, inline: null });
        labelCells.add(cell);
        break;
      }
    }
    if (labelCells.has(cell)) continue;
    const words = cell.source.words;
    for (let count = Math.min(4, words.length - 1); count >= 1 && !labelCells.has(cell); count--) {
      const prefix = normalizeLabel(
        words
          .slice(0, count)
          .map((word) => word.text)
          .join(' '),
      );
      const definition = template.headerFields.find((candidate) => bestAliasScore(prefix, candidate.aliases) >= LABEL_MATCH);
      if (!definition) continue;
      const inline = wordsField(words.slice(count));
      // "Porto, Pavilhão…" não é o rótulo "Porto": o que vem a seguir tem de condizer com o campo.
      const fits =
        definition.kind === 'count' ? isPlainNumber(inline.value) : definition.kind === 'code' ? /\d/.test(inline.value) : words[count - 1].text.endsWith(':');
      if (!fits) continue;
      labels.push({ cell, definition, inline });
      labelCells.add(cell);
    }
    // "Rótulo: valor" quando o OCR não separou as palavras.
    const colon = cell.text.indexOf(':');
    if (!labelCells.has(cell) && colon > 0 && colon < cell.text.length - 1) {
      const definition = template.headerFields.find((candidate) => bestAliasScore(normalizeLabel(cell.text.slice(0, colon)), candidate.aliases) >= LABEL_MATCH);
      const value = cell.text.slice(colon + 1).trim();
      if (definition && value !== '' && (definition.kind !== 'count' || isPlainNumber(value))) {
        labels.push({ cell, definition, inline: { ...cellField(cell), value } });
        labelCells.add(cell);
      }
    }
  }

  // 2. Valor de cada rótulo: na própria célula, na célula à direita ou na de baixo.
  const header: HeaderResult['header'] = {
    ...(Object.fromEntries(template.headerFields.map((definition) => [definition.key, emptyField()])) as Record<HeaderKey, Field>),
    others: [],
  };
  const filled = new Set<HeaderKey>();
  // Os rótulos acima dos blocos têm prioridade ("Local" também é título de coluna; "Pt" também é um valor).
  labels.sort((a, b) => Number(inZone(b.cell)) - Number(inZone(a.cell)) || a.cell.yc - b.cell.yc || a.cell.x0 - b.cell.x0);

  for (const label of labels) {
    const { cell, definition } = label;
    if (filled.has(definition.key)) continue;
    let value: Field | null = label.inline;
    let source: LayoutCell | null = null;

    if (definition.kind === 'note' && !value) {
      // Observações: todo o texto por baixo do título, até um espaço em branco grande.
      const lines = collectBelow(layout, cell, free, taken, labelCells);
      if (lines.length > 0) {
        header[definition.key] = { ...cellField(lines[0]), value: lines.map((line) => line.text).join('\n'), confidence: Math.min(...lines.map((line) => line.source.confidence)) };
        lines.forEach((line) => used.add(line));
        filled.add(definition.key);
      }
      used.add(cell);
      continue;
    }

    if (!value) {
      const right = rowToTheRight(layout, cell).find((other) => !taken.has(other));
      if (right && !labelCells.has(right) && !used.has(right) && rulesBetween(layout, cell, right) <= 1 && right.x0 - cell.x1 <= textHeight * 14) {
        value = accepts(definition, right);
        if (value) source = right;
      }
    }
    if (!value) {
      const below = free
        .filter(
          (other) =>
            !labelCells.has(other) &&
            !used.has(other) &&
            other.yc > cell.y1 &&
            other.y0 - cell.y1 <= rowPitch * 1.6 &&
            (horizontalOverlap(cell, other) > 0 || Math.abs(other.x0 - cell.x0) <= textHeight * 1.5),
        )
        .sort((a, b) => a.yc - b.yc || Math.abs(a.x0 - cell.x0) - Math.abs(b.x0 - cell.x0))[0];
      if (below) {
        value = accepts(definition, below);
        if (value) source = below;
      }
    }
    if (!value) continue;
    // Fora da zona de cabeçalho só contam rótulos com valor inequívoco (evita ler "Local" de uma tabela).
    if (!inZone(cell) && !label.inline) continue;
    header[definition.key] = value;
    filled.add(definition.key);
    used.add(cell);
    if (source) used.add(source);
  }
  for (const cell of labelCells) if (inZone(cell)) used.add(cell);

  // 3. Sem rótulo: reconhece pela forma, e deixa para confirmar.
  const loose = free.filter((cell) => inZone(cell) && !used.has(cell) && !labelCells.has(cell)).sort((a, b) => a.yc - b.yc || a.x0 - b.x0);
  // Valor sem rótulo reconhecido: tira um eventual "Rótulo:" mal lido do início ("Lucal: ESTÁDIO…").
  const inferred = (cell: LayoutCell): Field => {
    const match = /^[^\s:]{2,12}:\s*(.+)$/.exec(cell.text);
    return { ...cellField(cell), value: match ? match[1] : cell.text, confidence: Math.min(cell.source.confidence, INFERRED_CONFIDENCE) };
  };
  const claim = (key: HeaderKey, test: (cell: LayoutCell) => boolean): void => {
    if (filled.has(key)) return;
    const cell = loose.find((candidate) => !used.has(candidate) && test(candidate));
    if (!cell) return;
    header[key] = inferred(cell);
    filled.add(key);
    used.add(cell);
  };
  // "PF1": o código e o número na mesma palavra.
  claim('pf', (cell) => /^pf\s*\d+$/i.test(cell.text.trim()));
  // Uma data sem rótulo: é a data, ou — se a data já tiver vindo de um rótulo — o dia.
  claim(filled.has('date') ? 'day' : 'date', (cell) => looksLikeDate(cell.text));
  claim('location', (cell) => looksLikePlace(cell.text) && !looksLikeDate(cell.text));
  // O jogo: "EQUIPA A vs EQUIPA B".
  claim('event', (cell) => /\S\s+(vs\.?|x|contra)\s+\S/i.test(cell.text) && countLetters(cell.text) >= 5);
  if (filled.has('event') && !filled.has('competition')) {
    // Acima do jogo, o texto mais destacado é a competição; um texto pequeno por cima dela, o canal.
    const event = layout.cells.find((cell) => used.has(cell) && header.event.bbox && cell.source.bbox === header.event.bbox);
    const titleCandidates = loose.filter(
      (cell) =>
        !used.has(cell) &&
        countLetters(cell.text) >= 4 &&
        !cell.text.includes(':') &&
        !looksLikeDate(cell.text) &&
        bestAliasScore(cell.norm, template.genericTitles) < LABEL_MATCH &&
        (!event || (cell.y1 <= event.y0 + 2 && horizontalOverlap(cell, event) > 0)),
    );
    const competition = [...titleCandidates].sort((a, b) => b.height - a.height)[0];
    if (competition && competition.height >= textHeight * 1.2) {
      header.competition = inferred(competition);
      filled.add('competition');
      used.add(competition);
      const client = titleCandidates
        .filter((cell) => cell !== competition && cell.y1 <= competition.y0 + 2 && competition.y0 - cell.y1 <= rowPitch * 1.5 && horizontalOverlap(cell, competition) > 0)
        .sort((a, b) => b.yc - a.yc)[0];
      if (client && !filled.has('client')) {
        header.client = inferred(client);
        filled.add('client');
        used.add(client);
      }
    }
  }

  if (!filled.has('event')) {
    // O título do evento: o texto mais destacado do cabeçalho que não seja um título genérico.
    const candidates = loose.filter(
      (cell) => !used.has(cell) && countLetters(cell.text) >= 5 && !cell.text.includes(':') && bestAliasScore(cell.norm, template.genericTitles) < LABEL_MATCH,
    );
    const title = candidates.sort((a, b) => b.height - a.height || b.width - a.width)[0];
    if (title && (candidates.length === 1 || title.height >= textHeight * 1.15 || title.text.trim().includes(' '))) {
      header.event = inferred(title);
      used.add(title);
    }
  }

  // Nota de rodapé: a última linha da página, sozinha no fundo.
  const footerField = template.headerFields.find((field) => field.key === 'footer');
  if (footerField && !filled.has('footer')) {
    const last = free
      .filter((cell) => !used.has(cell) && !labelCells.has(cell) && cell.x0 < layout.width * 0.4 && countLetters(cell.text) >= 3)
      .sort((a, b) => b.yc - a.yc)[0];
    // Nada por baixo dela, e nada por cima nas duas linhas anteriores (fica isolada no fundo).
    const crowded = last && layout.cells.some((cell) => cell !== last && cell.x0 < layout.width * 0.4 && cell.y1 > last.y0 - rowPitch * 1.5 && cell.yc < last.yc + rowPitch);
    if (last && !crowded && last.yc > layout.height * 0.85) {
      header.footer = inferred(last);
      used.add(last);
    }
  }

  // 4. Tudo o resto que estiver no cabeçalho é preservado como "outros campos".
  for (const cell of loose) {
    if (used.has(cell) || countLetters(cell.text) < 3 || cell.source.confidence < MIN_EXTRA_CONFIDENCE) continue;
    if (bestAliasScore(cell.norm, template.genericTitles) >= LABEL_MATCH) continue;
    const separator = cell.text.indexOf(':');
    const label = separator > 0 ? cell.text.slice(0, separator).trim() : '';
    const value = separator > 0 ? cell.text.slice(separator + 1).trim() : cell.text;
    if (value === '') continue;
    header.others.push({ id: `extra-${cell.index}`, label, field: { ...cellField(cell), value } });
    used.add(cell);
  }

  return { header, used };
}

/** Células por baixo de um título, na mesma coluna, até um espaço em branco grande ou outro título. */
function collectBelow(layout: PageLayout, label: LayoutCell, free: LayoutCell[], taken: Set<LayoutCell>, labelCells: Set<LayoutCell>): LayoutCell[] {
  const { textHeight, rowPitch } = layout;
  const columnEnd = label.x0 + layout.width / 2;
  const candidates = free
    .filter((cell) => cell.yc > label.y1 && cell.x0 >= label.x0 - textHeight * 2 && cell.x0 < columnEnd && !taken.has(cell))
    .sort((a, b) => a.yc - b.yc || a.x0 - b.x0);
  const lines: LayoutCell[] = [];
  let bottom = label.y1;
  for (const cell of candidates) {
    if (labelCells.has(cell) || cell.y0 - bottom > rowPitch * 2.2) break;
    // A última linha da página é o rodapé, não uma observação.
    if (cell.yc > layout.height * 0.9 && lines.length === 0 && cell.y0 - bottom > rowPitch * 1.2) break;
    lines.push(cell);
    bottom = Math.max(bottom, cell.y1);
    void textHeight;
  }
  return lines;
}
