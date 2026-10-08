/** Relações geométricas entre células de texto e traços da grelha. */
import type { TextCell } from '../ocrEngine';
import type { Rule } from '../tableDetector';
import { normalizeLabel } from './text';

export interface LayoutCell {
  index: number;
  source: TextCell;
  text: string;
  /** Texto normalizado (ver `normalizeLabel`). */
  norm: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  xc: number;
  yc: number;
  width: number;
  height: number;
}

export interface PageLayout {
  cells: LayoutCell[];
  rules: Rule[];
  width: number;
  height: number;
  /** Altura típica das maiúsculas. */
  textHeight: number;
  /** Distância típica entre linhas consecutivas de uma tabela. */
  rowPitch: number;
}

export interface Span {
  start: number;
  end: number;
}

/** Junta fragmentos do mesmo traço (interrompidos por cruzamentos ou falhas de deteção). */
function mergeCollinear(rules: Rule[], maxGap: number): Rule[] {
  const merged: Rule[] = [];
  for (const orientation of ['h', 'v'] as const) {
    const sorted = rules.filter((rule) => rule.orientation === orientation).sort((a, b) => a.position - b.position || a.start - b.start);
    const used = new Array<boolean>(sorted.length).fill(false);
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue;
      const current = { ...sorted[i] };
      let extended = true;
      while (extended) {
        extended = false;
        for (let j = i + 1; j < sorted.length; j++) {
          if (used[j]) continue;
          const other = sorted[j];
          if (other.position - current.position > 2) break;
          if (other.start <= current.end + maxGap && other.end >= current.start - maxGap) {
            current.start = Math.min(current.start, other.start);
            current.end = Math.max(current.end, other.end);
            used[j] = true;
            extended = true;
          }
        }
      }
      merged.push(current);
    }
  }
  return merged;
}

/** "CAM O5" → "CAM 05": um O colado a algarismos é um zero. */
export function fixDigitLookalikes(text: string): string {
  return text.replace(/\b[O0-9]*[0-9][O0-9]*\b/g, (token) => token.replace(/O/g, '0'));
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildLayout(cells: TextCell[], rules: Rule[], width: number, height: number, textHeight: number): PageLayout {
  const layoutCells = cells
    .map((source) => ({ source, text: fixDigitLookalikes(source.text.trim()) }))
    .filter(({ text }) => text !== '')
    .map(({ source, text }, index) => {
      const { x0, y0, x1, y1 } = source.bbox;
      return { index, source, text, norm: normalizeLabel(text), x0, y0, x1, y1, xc: (x0 + x1) / 2, yc: (y0 + y1) / 2, width: x1 - x0, height: y1 - y0 };
    });

  // Distância típica entre uma célula e a que está imediatamente por baixo.
  const pitches: number[] = [];
  for (const cell of layoutCells) {
    let nearest = Infinity;
    for (const other of layoutCells) {
      if (other.yc <= cell.yc || other.x1 < cell.x0 || other.x0 > cell.x1) continue;
      const distance = other.yc - cell.yc;
      if (distance > cell.height * 0.8 && distance < nearest) nearest = distance;
    }
    if (nearest < textHeight * 6) pitches.push(nearest);
  }

  return {
    cells: layoutCells,
    rules: mergeCollinear(rules, Math.max(6, textHeight * 0.6)),
    width,
    height,
    textHeight,
    rowPitch: median(pitches, textHeight * 2.2),
  };
}

export function verticalOverlap(a: LayoutCell, b: LayoutCell): number {
  return Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
}

export function horizontalOverlap(a: { x0: number; x1: number }, b: { x0: number; x1: number }): number {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

/** As duas células estão na mesma linha de texto? */
export function sameRow(a: LayoutCell, b: LayoutCell): boolean {
  return verticalOverlap(a, b) >= Math.min(a.height, b.height) * 0.5;
}

/** Células na mesma linha que `cell`, à sua direita, da esquerda para a direita. */
export function rowToTheRight(layout: PageLayout, cell: LayoutCell): LayoutCell[] {
  return layout.cells.filter((other) => other !== cell && other.x0 >= cell.x1 - 2 && sameRow(cell, other)).sort((a, b) => a.x0 - b.x0);
}

const RULE_TOLERANCE = 3;

function covers(rule: Rule, coordinate: number): boolean {
  return rule.start - RULE_TOLERANCE <= coordinate && rule.end + RULE_TOLERANCE >= coordinate;
}

/** Posições dos traços verticais que atravessam a altura `y`, por ordem. */
export function verticalRulesAt(layout: PageLayout, y: number): number[] {
  return layout.rules
    .filter((rule) => rule.orientation === 'v' && covers(rule, y))
    .map((rule) => rule.position)
    .sort((a, b) => a - b);
}

/** Limites (esquerdo e direito) da célula da grelha onde `cell` está; `null` se não houver traço desse lado. */
export function columnBounds(layout: PageLayout, cell: LayoutCell): { left: number | null; right: number | null } {
  let left: number | null = null;
  let right: number | null = null;
  for (const position of verticalRulesAt(layout, cell.yc)) {
    if (position <= cell.x0 + RULE_TOLERANCE) left = position;
    else if (position >= cell.x1 - RULE_TOLERANCE && right === null) right = position;
  }
  return { left, right };
}

/** Quantos traços verticais separam `a` de `b` (na altura de `a`)? */
export function rulesBetween(layout: PageLayout, a: LayoutCell, b: LayoutCell): number {
  const from = Math.min(a.x1, b.x1);
  const to = Math.max(a.x0, b.x0);
  return verticalRulesAt(layout, a.yc).filter((position) => position >= from - RULE_TOLERANCE && position <= to + RULE_TOLERANCE).length;
}

/**
 * O traço horizontal mais próximo por baixo (ou por cima) de `cell` que passa pela sua
 * posição x: dá a largura da tabela a que a célula pertence.
 */
export function nearestHorizontalRule(layout: PageLayout, cell: LayoutCell, side: 'below' | 'above', maxDistance: number): Rule | null {
  let best: Rule | null = null;
  let bestDistance = maxDistance;
  for (const rule of layout.rules) {
    // O traço tem de passar por baixo (ou por cima) da célula inteira.
    if (rule.orientation !== 'h' || !covers(rule, cell.x0) || !covers(rule, cell.x1)) continue;
    const distance = side === 'below' ? rule.position - cell.y1 : cell.y0 - rule.position;
    if (distance >= -RULE_TOLERANCE && distance < bestDistance) {
      best = rule;
      bestDistance = distance;
    }
  }
  return best;
}

/** Largura da tabela onde `cell` está, se estiver dentro de uma grelha. */
export function tableSpan(layout: PageLayout, cell: LayoutCell): Span | null {
  const reach = layout.rowPitch * 1.3;
  const rule = nearestHorizontalRule(layout, cell, 'below', reach) ?? nearestHorizontalRule(layout, cell, 'above', reach);
  return rule ? { start: rule.start, end: rule.end } : null;
}

/** Há um traço horizontal entre as duas células (uma por cima da outra)? */
export function ruleSeparatesVertically(layout: PageLayout, upper: LayoutCell, lower: LayoutCell): boolean {
  const x = (Math.max(upper.x0, lower.x0) + Math.min(upper.x1, lower.x1)) / 2;
  return layout.rules.some((rule) => rule.orientation === 'h' && rule.position > upper.yc && rule.position < lower.yc && covers(rule, x));
}
