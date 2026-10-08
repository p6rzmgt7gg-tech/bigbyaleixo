/**
 * Estrutura de tabela a partir da imagem limpa:
 *  1. deteta os traços da grelha, apaga-os e guarda-os como separadores de células;
 *  2. agrupa as letras em segmentos de texto — um segmento corresponde ao conteúdo
 *     de uma célula (ou a uma linha de texto solta).
 */
import { INK_LEVEL } from './imagePreprocessor';
import { componentBoxes, type GrayImage, type PixelBox, type RgbaImage } from './raster';

export interface Rule {
  orientation: 'h' | 'v';
  /** y de um traço horizontal, x de um traço vertical (centro). */
  position: number;
  start: number;
  end: number;
  thickness: number;
}

/**
 * Afastamento ao fundo que conta como parte de um traço. Mede-se antes da normalização
 * de contraste, para que um traço claro tenha a mesma leitura ao longo de todo o comprimento.
 */
const RULE_DEVIATION = 32;
/** Salto de cor que marca a fronteira de uma zona preenchida. */
const FILL_STEP = 40;

/**
 * A mancha de cor a que o píxel (x, y) pertence tem poucos píxeis de espessura na direção
 * (dx, dy)? Mede-se na imagem original, por semelhança de cor: uma borda encostada a uma
 * célula colorida continua a ser fina.
 */
function isThinPixel(source: RgbaImage, x: number, y: number, dx: number, dy: number, maxThickness: number): boolean {
  const { width, height, data } = source;
  const p = (y * width + x) * 4;
  const sameColor = (xx: number, yy: number): boolean => {
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) return false;
    const q = (yy * width + xx) * 4;
    return Math.abs(data[p] - data[q]) <= RULE_DEVIATION && Math.abs(data[p + 1] - data[q + 1]) <= RULE_DEVIATION && Math.abs(data[p + 2] - data[q + 2]) <= RULE_DEVIATION;
  };
  let extent = 1;
  for (let k = 1; sameColor(x - dx * k, y - dy * k); k++) if (++extent > maxThickness) return false;
  for (let k = 1; sameColor(x + dx * k, y + dy * k); k++) if (++extent > maxThickness) return false;
  return true;
}

/** Fração mínima de um traço que tem de ser fina (o resto são cruzamentos com outros traços). */
const THIN_FRACTION = 0.7;
/** Um traço tem cor uniforme: a maior parte dos píxeis fica nesta faixa em torno do valor típico. */
const UNIFORM_LOW = 0.6;
const UNIFORM_HIGH = 1.6;

interface Run {
  /** Coordenada fixa: y nas sequências horizontais, x nas verticais. */
  line: number;
  start: number;
  end: number;
}

/** Sequências de tinta com pelo menos `minLength` píxeis ao longo de uma direção. */
function inkRuns(ink: Uint8Array, width: number, height: number, minLength: number, direction: 'h' | 'v'): Run[] {
  const runs: Run[] = [];
  if (direction === 'h') {
    for (let y = 0; y < height; y++) {
      const offset = y * width;
      let x = 0;
      while (x < width) {
        if (ink[offset + x] === 0) {
          x++;
          continue;
        }
        const start = x;
        while (x < width && ink[offset + x] !== 0) x++;
        if (x - start >= minLength) runs.push({ line: y, start, end: x });
      }
    }
    return runs;
  }
  const runLength = new Int32Array(width);
  for (let y = 0; y <= height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      if (y < height && ink[offset + x] !== 0) {
        runLength[x]++;
        continue;
      }
      if (runLength[x] >= minLength) runs.push({ line: x, start: y - runLength[x], end: y });
      runLength[x] = 0;
    }
  }
  return runs;
}

/**
 * Um traço é comprido, fino e de cor uniforme. Uma linha de texto também dá sequências
 * compridas, mas grossas; e a base das letras, numa imagem pequena, parece um traço fino
 * mas alterna entre tinta forte e fraca. As pontas não contam: é aí que o traço se junta
 * aos perpendiculares.
 */
function isRule(source: RgbaImage, deviation: Uint8Array, run: Run, direction: 'h' | 'v', maxThickness: number): boolean {
  const { width } = source;
  const length = run.end - run.start;
  const margin = Math.min(maxThickness + 1, Math.floor(length / 4));
  const core = length - margin * 2;
  const strengths: number[] = [];
  let thin = 0;
  for (let k = run.start + margin; k < run.end - margin; k++) {
    const x = direction === 'h' ? k : run.line;
    const y = direction === 'h' ? run.line : k;
    strengths.push(deviation[y * width + x]);
    if (isThinPixel(source, x, y, direction === 'h' ? 0 : 1, direction === 'h' ? 1 : 0, maxThickness)) thin++;
  }
  if (thin < core * THIN_FRACTION) return false;
  const typical = [...strengths].sort((a, b) => a - b)[strengths.length >> 1];
  const uniform = strengths.filter((value) => value >= typical * UNIFORM_LOW && value <= typical * UNIFORM_HIGH).length;
  return uniform >= core * THIN_FRACTION;
}

function markRun(mask: Uint8Array, width: number, run: Run, direction: 'h' | 'v'): void {
  if (direction === 'h') {
    mask.fill(1, run.line * width + run.start, run.line * width + run.end);
  } else {
    for (let y = run.start; y < run.end; y++) mask[y * width + run.line] = 1;
  }
}

function touches(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
      if (mask[yy * width + xx] !== 0) return true;
    }
  }
  return false;
}

/** Diferença de cor forte entre dois píxeis da imagem original. */
function colorsDiffer(source: RgbaImage, x0: number, y0: number, x1: number, y1: number): boolean {
  const { width, height, data } = source;
  if (x0 < 0 || x1 < 0 || y0 < 0 || y1 < 0 || x0 >= width || x1 >= width || y0 >= height || y1 >= height) return false;
  const p = (y0 * width + x0) * 4;
  const q = (y1 * width + x1) * 4;
  return Math.abs(data[p] - data[q]) > FILL_STEP || Math.abs(data[p + 1] - data[q + 1]) > FILL_STEP || Math.abs(data[p + 2] - data[q + 2]) > FILL_STEP;
}

const SIDE_OFFSETS = [2, 4, 6];

/**
 * Traços curtos (bordas de uma única célula) só contam se forem finos e estiverem
 * ancorados nas duas pontas: num traço perpendicular já detetado, ou na fronteira de
 * uma zona de cor (a barra de título de um bloco). A haste de uma letra pode
 * encostar-se a uma borda, mas nunca liga duas.
 */
function extendWithShortRules(
  ink: Uint8Array,
  deviation: Uint8Array,
  source: RgbaImage,
  horizontal: Uint8Array,
  vertical: Uint8Array,
  minLength: number,
  maxThickness: number,
): void {
  const { width, height } = source;
  const isInk = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] !== 0;

  for (const run of inkRuns(ink, width, height, minLength, 'v')) {
    const x = run.line;
    if (vertical[run.start * width + x] !== 0 || !isRule(source, deviation, run, 'v', maxThickness)) continue;
    // Fronteira de cor: de um dos lados do traço, o fundo muda de cor entre "dentro" e "para lá da ponta".
    const fillBoundary = (inside: number, beyond: number): boolean =>
      [-1, 1].some((side) => SIDE_OFFSETS.every((s) => !isInk(x + side * s, inside) && colorsDiffer(source, x + side * s, inside, x + side * s, beyond)));
    const anchoredTop = touches(horizontal, width, height, x, run.start - 1) || fillBoundary(run.start + 1, run.start - 2);
    const anchoredBottom = touches(horizontal, width, height, x, run.end) || fillBoundary(run.end - 2, run.end + 1);
    if (anchoredTop && anchoredBottom) markRun(vertical, width, run, 'v');
  }

  for (const run of inkRuns(ink, width, height, minLength, 'h')) {
    const y = run.line;
    if (horizontal[y * width + run.start] !== 0 || !isRule(source, deviation, run, 'h', maxThickness)) continue;
    const fillBoundary = (inside: number, beyond: number): boolean =>
      [-1, 1].some((side) => SIDE_OFFSETS.every((s) => !isInk(inside, y + side * s) && colorsDiffer(source, inside, y + side * s, beyond, y + side * s)));
    const anchoredLeft = touches(vertical, width, height, run.start - 1, y) || fillBoundary(run.start + 1, run.start - 2);
    const anchoredRight = touches(vertical, width, height, run.end, y) || fillBoundary(run.end - 2, run.end + 1);
    if (anchoredLeft && anchoredRight) markRun(horizontal, width, run, 'h');
  }
}

function toRules(mask: Uint8Array, width: number, height: number, orientation: 'h' | 'v'): Rule[] {
  return componentBoxes(mask, width, height).map((box) =>
    orientation === 'h'
      ? { orientation, position: (box.y0 + box.y1) / 2, start: box.x0, end: box.x1, thickness: box.y1 - box.y0 }
      : { orientation, position: (box.x0 + box.x1) / 2, start: box.y0, end: box.y1, thickness: box.x1 - box.x0 },
  );
}

/**
 * Deteta os traços da grelha e apaga-os da imagem limpa (in-place).
 * `textHeight` é a altura das maiúsculas, em píxeis da imagem.
 */
export function detectAndEraseRules(
  clean: GrayImage,
  deviation: Uint8Array,
  source: RgbaImage,
  textHeight: number,
  exclude: { x0: number; y0: number; x1: number; y1: number }[] = [],
): Rule[] {
  const { width, height, data } = clean;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = deviation[i] >= RULE_DEVIATION ? 1 : 0;
  for (const box of exclude) {
    for (let y = Math.max(0, box.y0); y < Math.min(height, box.y1); y++) ink.fill(0, y * width + Math.max(0, box.x0), y * width + Math.min(width, box.x1));
  }

  const maxThickness = Math.max(3, Math.round(textHeight * 0.3));
  const horizontal = new Uint8Array(width * height);
  const vertical = new Uint8Array(width * height);
  for (const run of inkRuns(ink, width, height, Math.max(24, Math.round(textHeight * 3)), 'h')) {
    if (isRule(source, deviation, run, 'h', maxThickness)) markRun(horizontal, width, run, 'h');
  }
  for (const run of inkRuns(ink, width, height, Math.max(20, Math.round(textHeight * 2.6)), 'v')) {
    if (isRule(source, deviation, run, 'v', maxThickness)) markRun(vertical, width, run, 'v');
  }
  extendWithShortRules(ink, deviation, source, horizontal, vertical, Math.max(8, Math.round(textHeight * 1.2)), maxThickness);

  const rules = [...toRules(horizontal, width, height, 'h'), ...toRules(vertical, width, height, 'v')];

  // Apaga os traços e o halo de um píxel à volta (anti-aliasing / artefactos JPEG).
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      const i = offset + x;
      if (horizontal[i] === 0 && vertical[i] === 0) continue;
      const fromY = y > 0 ? y - 1 : y;
      const toY = y < height - 1 ? y + 1 : y;
      const fromX = x > 0 ? x - 1 : x;
      const toX = x < width - 1 ? x + 1 : x;
      for (let yy = fromY; yy <= toY; yy++) {
        for (let xx = fromX; xx <= toX; xx++) data[yy * width + xx] = 255;
      }
    }
  }
  return rules;
}

/** Máscara binária da tinta de uma imagem limpa. */
export function inkMask(image: GrayImage): Uint8Array {
  const mask = new Uint8Array(image.data.length);
  for (let i = 0; i < mask.length; i++) mask[i] = image.data[i] < INK_LEVEL ? 1 : 0;
  return mask;
}

/** Há um traço vertical entre x = left e x = right que atravesse a altura y? */
export function verticalRuleBetween(rules: Rule[], left: number, right: number, y: number): boolean {
  for (const rule of rules) {
    if (rule.orientation !== 'v') continue;
    if (rule.position >= left - 1 && rule.position <= right + 1 && rule.start <= y && rule.end >= y) return true;
  }
  return false;
}

/** Há um traço horizontal entre y = top e y = bottom que atravesse a posição x? */
export function horizontalRuleBetween(rules: Rule[], top: number, bottom: number, x: number): boolean {
  for (const rule of rules) {
    if (rule.orientation !== 'h') continue;
    if (rule.position >= top - 1 && rule.position <= bottom + 1 && rule.start <= x && rule.end >= x) return true;
  }
  return false;
}

/**
 * Agrupa as letras (componentes de tinta) em segmentos de texto.
 * Duas letras ficam no mesmo segmento se estiverem na mesma linha, próximas, e sem
 * traço vertical pelo meio; acentos e pontos juntam-se à letra que têm por baixo.
 */
export function findTextSegments(glyphs: PixelBox[], rules: Rule[], textHeight: number): PixelBox[] {
  const maxGap = Math.max(5, textHeight);
  const boxes = glyphs
    .filter((box) => {
      const w = box.x1 - box.x0;
      const h = box.y1 - box.y0;
      if (box.area <= 2) return false;
      if (h > textHeight * 6 || w > textHeight * 40) return false;
      // Restos de traços que escaparam à deteção.
      if ((w >= textHeight * 3 && h <= textHeight * 0.25) || (h >= textHeight * 2.5 && w <= textHeight * 0.25)) return false;
      return true;
    })
    .sort((a, b) => a.x0 - b.x0);

  const parent = boxes.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    const heightA = a.y1 - a.y0;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (b.x0 > a.x1 + maxGap) break;
      const heightB = b.y1 - b.y0;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const smaller = Math.min(heightA, heightB);
      const larger = Math.max(heightA, heightB);

      let linked = false;
      if (overlap >= smaller * 0.3 && !(larger > textHeight * 2.4 && smaller < larger * 0.5)) {
        // Mesma linha de texto.
        const middle = (Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) / 2;
        linked = b.x0 <= a.x1 || !verticalRuleBetween(rules, a.x1, b.x0, middle);
      } else if (overlap < smaller * 0.3) {
        // Acento ou ponto por cima (ou por baixo) de uma letra.
        const small = heightA <= heightB ? a : b;
        const big = small === a ? b : a;
        const smallWidth = small.x1 - small.x0;
        const shared = Math.min(small.x1, big.x1) - Math.max(small.x0, big.x0);
        const gap = Math.max(small.y0, big.y0) - Math.min(small.y1, big.y1);
        if (
          small.y1 - small.y0 <= textHeight * 0.5 &&
          smallWidth <= textHeight * 1.2 &&
          shared >= smallWidth * 0.5 &&
          gap <= textHeight * 0.35
        ) {
          const top = Math.min(small.y1, big.y1);
          const bottom = Math.max(small.y0, big.y0);
          linked = !horizontalRuleBetween(rules, top, bottom, (small.x0 + small.x1) / 2);
        }
      }
      if (linked) parent[find(j)] = find(i);
    }
  }

  const merged = new Map<number, PixelBox>();
  boxes.forEach((box, index) => {
    const root = find(index);
    const segment = merged.get(root);
    if (!segment) {
      merged.set(root, { ...box });
      return;
    }
    segment.x0 = Math.min(segment.x0, box.x0);
    segment.y0 = Math.min(segment.y0, box.y0);
    segment.x1 = Math.max(segment.x1, box.x1);
    segment.y1 = Math.max(segment.y1, box.y1);
    segment.area += box.area;
  });

  return [...merged.values()]
    .filter((segment) => {
      const w = segment.x1 - segment.x0;
      const h = segment.y1 - segment.y0;
      // Marcas soltas (pontos, hífenes, restos de acentos).
      if (h < textHeight * 0.45) return false;
      // Barra vertical maciça: é um resto de traço, não é texto.
      if (h >= w * 5 && segment.area >= w * h * 0.8) return false;
      return true;
    })
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}
