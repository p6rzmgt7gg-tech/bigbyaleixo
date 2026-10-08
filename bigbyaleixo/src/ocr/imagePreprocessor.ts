/**
 * Pré-processamento da imagem antes do OCR.
 *
 * Um call sheet é quase sempre um ecrã/exportação de folha de cálculo: zonas de cor
 * lisa (células) com texto por cima. Em vez de um threshold global — que falha com
 * células coloridas e com texto claro sobre fundo escuro — estimamos o fundo local
 * a partir das zonas lisas e medimos, píxel a píxel, o quanto cada um se afasta
 * desse fundo. O resultado é sempre texto escuro sobre branco.
 *
 * Fotografias (sem zonas lisas) usam um caminho alternativo baseado em luminância.
 */
import { boxExtreme, componentBoxes, longRuns, percentile, type GrayImage, type RgbaImage } from './raster';

export type NormalizationMode = 'flat' | 'photo';

export interface NormalizedImage {
  /** Escala original. 255 = fundo, 0 = tinta. */
  clean: GrayImage;
  /** Afastamento de cada píxel em relação ao fundo local (0..255), antes de normalizar o contraste. */
  deviation: Uint8Array;
  /** Altura das maiúsculas usada na normalização, em píxeis da imagem original. */
  textHeight: number;
  mode: NormalizationMode;
}

/** Diferença máxima entre vizinhos para um píxel contar como "liso" (tolera ruído JPEG). */
const FLAT_TOLERANCE = 10;
/**
 * Custos da propagação do fundo. Avançar é barato enquanto o píxel se parece com o
 * fundo que está a ser propagado; custa mais entrar em píxeis de outra cor (tinta, ou
 * a célula vizinha) e atravessar uma aresta forte (um traço, o contorno de uma letra).
 */
const SIMILAR_TOLERANCE = 28;
const DISSIMILAR_PENALTY = 6;
const EDGE_STEP = 40;
const EDGE_PENALTY = 12;
/** Um traço fino nunca herda o fundo de uma zona da mesma cor a que esteja ligado. */
const THIN_PENALTY = DISSIMILAR_PENALTY + EDGE_PENALTY;
const PROPAGATION_SWEEPS = 2;
/** Abaixo desta fração de espaço aberto tratamos a imagem como fotografia. */
const MIN_OPEN_COVERAGE = 0.2;
/** Afastamento ao fundo a partir do qual há tinta, e contraste mínimo assumido. */
const INK_FLOOR = 20;
const MIN_LOCAL_CONTRAST = 70;
/** Nível de cinzento abaixo do qual um píxel da imagem limpa conta como tinta. */
export const INK_LEVEL = 160;
export const DEFAULT_TEXT_HEIGHT = 12;

export const MIN_IMAGE_LONG_SIDE = 640;
export const MIN_IMAGE_SHORT_SIDE = 320;
/** Limite de píxeis na descodificação; imagens maiores são reduzidas pelo browser. */
const MAX_DECODE_PIXELS = 12_000_000;

function differs(data: RgbaImage['data'], p: number, q: number, tolerance: number): boolean {
  const dr = data[p] - data[q];
  const dg = data[p + 1] - data[q + 1];
  const db = data[p + 2] - data[q + 2];
  return dr > tolerance || dr < -tolerance || dg > tolerance || dg < -tolerance || db > tolerance || db < -tolerance;
}

/** 1 onde o píxel tem a mesma cor (dentro da tolerância) que os quatro vizinhos. */
function flatMask(source: RgbaImage): Uint8Array {
  const { width, height, data } = source;
  const flat = new Uint8Array(width * height).fill(1);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    let p = y * rowBytes;
    let i = y * width;
    for (let x = 0; x < width - 1; x++, p += 4, i++) {
      if (differs(data, p, p + 4, FLAT_TOLERANCE)) {
        flat[i] = 0;
        flat[i + 1] = 0;
      }
    }
  }
  for (let y = 0; y < height - 1; y++) {
    let p = y * rowBytes;
    let i = y * width;
    for (let x = 0; x < width; x++, p += 4, i++) {
      if (differs(data, p, p + rowBytes, FLAT_TOLERANCE)) {
        flat[i] = 0;
        flat[i + width] = 0;
      }
    }
  }
  return flat;
}

/**
 * Altura típica do texto a partir de uma máscara em que cada letra é um "blob":
 * percentil alto das alturas (as maiúsculas e ascendentes dominam esse percentil).
 */
export function estimateTextHeight(mask: Uint8Array, width: number, height: number, haloPixels: number): number | null {
  const maxHeight = Math.min(160, height * 0.25);
  const heights: number[] = [];
  for (const box of componentBoxes(mask, width, height)) {
    const h = box.y1 - box.y0;
    const w = box.x1 - box.x0;
    if (h < 5 || h > maxHeight || w < 2 || w > h * 8 || box.area < 8) continue;
    heights.push(h);
  }
  if (heights.length < 12) return null;
  return Math.max(5, percentile(heights, 0.7) - haloPixels);
}

/**
 * Alarga o espaço aberto a toda a zona lisa que lhe está ligada: a célula inteira
 * fica com a sua própria cor de fundo, e não só as faixas compridas das margens.
 */
function growThroughFlat(open: Uint8Array, flat: Uint8Array, width: number, height: number): void {
  const parent: number[] = [];
  const reachesOpen: boolean[] = [];
  const runOffset: number[] = [];
  const runLength: number[] = [];
  const runLabel: number[] = [];

  const find = (label: number): number => {
    let root = label;
    while (parent[root] !== root) root = parent[root];
    while (parent[label] !== root) {
      const next = parent[label];
      parent[label] = root;
      label = next;
    }
    return root;
  };

  let previousFrom = 0;
  let previousTo = 0;
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    const rowFrom = runOffset.length;
    let pointer = previousFrom;
    let x = 0;
    while (x < width) {
      if (flat[offset + x] === 0) {
        x++;
        continue;
      }
      const start = x;
      let touchesOpen = false;
      while (x < width && flat[offset + x] !== 0) {
        if (open[offset + x] !== 0) touchesOpen = true;
        x++;
      }

      let label = -1;
      const previousOffset = offset - width;
      while (pointer < previousTo && runOffset[pointer] + runLength[pointer] - previousOffset <= start) pointer++;
      for (let k = pointer; k < previousTo && runOffset[k] - previousOffset < x; k++) {
        const other = find(runLabel[k]);
        if (label === -1) {
          label = other;
        } else if (other !== label) {
          parent[other] = label;
          if (reachesOpen[other]) reachesOpen[label] = true;
        }
      }
      if (label === -1) {
        label = parent.length;
        parent.push(label);
        reachesOpen.push(false);
      }
      if (touchesOpen) reachesOpen[label] = true;
      runOffset.push(offset + start);
      runLength.push(x - start);
      runLabel.push(label);
    }
    previousFrom = rowFrom;
    previousTo = runOffset.length;
  }

  for (let k = 0; k < runOffset.length; k++) {
    if (reachesOpen[find(runLabel[k])]) open.fill(1, runOffset[k], runOffset[k] + runLength[k]);
  }
}

/** Converte "afastamento ao fundo" em tinta, normalizando pelo contraste local. */
function deviationToInk(deviation: Uint8Array, width: number, height: number, textHeight: number): GrayImage {
  const radius = Math.max(4, Math.round(textHeight));
  const localMax = boxExtreme(deviation, width, height, radius, 'max');
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const d = deviation[i];
    if (d <= INK_FLOOR) {
      data[i] = 255;
      continue;
    }
    const contrast = localMax[i] < MIN_LOCAL_CONTRAST ? MIN_LOCAL_CONTRAST : localMax[i];
    const strength = (d - INK_FLOOR) / (contrast * 0.9 - INK_FLOOR);
    data[i] = strength >= 1 ? 0 : 255 - ((strength * 255) | 0);
  }
  return { data, width, height };
}

/**
 * Uma célula pequena e muito preenchida pode não ter espaço aberto próprio e herdar o
 * fundo da vizinha: fica inteira com um afastamento constante (um "planalto"). Texto e
 * traços são finos; tudo o que for largo nas duas direções é fundo e é subtraído.
 */
function removePlateaus(deviation: Uint8Array, width: number, height: number, textHeight: number): void {
  const radius = Math.max(3, Math.round(textHeight * 0.45));
  const plateau = boxExtreme(boxExtreme(deviation, width, height, radius, 'min'), width, height, radius, 'max');
  for (let i = 0; i < deviation.length; i++) deviation[i] -= plateau[i];
}

function normalizeFlat(source: RgbaImage, flat: Uint8Array, textHeight: number): Pick<NormalizedImage, 'clean' | 'deviation'> | null {
  const { width, height, data } = source;
  const total = width * height;

  // "Espaço aberto": faixas lisas compridas (as margens das células). O interior do
  // traço de uma letra nunca é comprido e largo o suficiente para contar.
  const runLength = Math.max(12, Math.round(textHeight * 1.7));
  const thickness = Math.max(2, Math.round(textHeight * 0.2));
  const open = longRuns(longRuns(flat, width, height, runLength, 'h'), width, height, thickness, 'v');
  const vertical = longRuns(longRuns(flat, width, height, runLength, 'v'), width, height, thickness, 'h');
  for (let i = 0; i < total; i++) if (vertical[i] !== 0) open[i] = 1;
  growThroughFlat(open, flat, width, height);

  // Cada píxel restante herda a cor do espaço aberto mais próximo
  // (distância de Manhattan, calculada em duas passagens).
  const FAR = 0xffff;
  const distance = new Uint16Array(total);
  const background = new Uint8Array(total * 3);
  let openCount = 0;
  for (let i = 0; i < total; i++) {
    if (open[i] !== 0) {
      openCount++;
      background[i * 3] = data[i * 4];
      background[i * 3 + 1] = data[i * 4 + 1];
      background[i * 3 + 2] = data[i * 4 + 2];
    } else {
      distance[i] = FAR;
    }
  }
  if (openCount / total < MIN_OPEN_COVERAGE) return null;

  // Píxeis "finos": têm uma cor bem diferente a poucos píxeis de distância dos dois lados
  // (o interior de um traço da grelha ou de uma letra).
  const reach = Math.max(3, Math.round(textHeight * 0.3));
  const thin = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      const p = i * 4;
      let before = false;
      let after = false;
      for (let k = 1; k <= reach && !(before && after); k++) {
        if (!before && x - k >= 0 && differs(data, p, p - k * 4, EDGE_STEP)) before = true;
        if (!after && x + k < width && differs(data, p, p + k * 4, EDGE_STEP)) after = true;
      }
      if (before && after) {
        thin[i] = 1;
        continue;
      }
      before = false;
      after = false;
      for (let k = 1; k <= reach && !(before && after); k++) {
        if (!before && y - k >= 0 && differs(data, p, p - k * width * 4, EDGE_STEP)) before = true;
        if (!after && y + k < height && differs(data, p, p + k * width * 4, EDGE_STEP)) after = true;
      }
      if (before && after) thin[i] = 1;
    }
  }

  const relax = (target: number, from: number): void => {
    if (distance[from] === FAR) return;
    const p = target * 4;
    const b = from * 3;
    let cost = distance[from] + 1;
    if (thin[target] !== 0) {
      cost += THIN_PENALTY;
    } else {
      const dr = data[p] - background[b];
      const dg = data[p + 1] - background[b + 1];
      const db = data[p + 2] - background[b + 2];
      if (
        dr > SIMILAR_TOLERANCE || dr < -SIMILAR_TOLERANCE || dg > SIMILAR_TOLERANCE || dg < -SIMILAR_TOLERANCE || db > SIMILAR_TOLERANCE || db < -SIMILAR_TOLERANCE
      ) {
        cost += DISSIMILAR_PENALTY;
      }
    }
    if (cost >= distance[target]) return;
    if (differs(data, p, from * 4, EDGE_STEP)) {
      cost += EDGE_PENALTY;
      if (cost >= distance[target]) return;
    }
    distance[target] = cost;
    background[target * 3] = background[b];
    background[target * 3 + 1] = background[b + 1];
    background[target * 3 + 2] = background[b + 2];
  };
  for (let sweep = 0; sweep < PROPAGATION_SWEEPS; sweep++) {
    for (let y = 0; y < height; y++) {
      let i = y * width;
      for (let x = 0; x < width; x++, i++) {
        if (distance[i] === 0) continue;
        if (x > 0) relax(i, i - 1);
        if (y > 0) relax(i, i - width);
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      let i = y * width + width - 1;
      for (let x = width - 1; x >= 0; x--, i--) {
        if (distance[i] === 0) continue;
        if (x < width - 1) relax(i, i + 1);
        if (y < height - 1) relax(i, i + width);
      }
    }
  }

  const deviation = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (distance[i] === 0) continue;
    const p = i * 4;
    const b = i * 3;
    const dr = Math.abs(data[p] - background[b]);
    const dg = Math.abs(data[p + 1] - background[b + 1]);
    const db = Math.abs(data[p + 2] - background[b + 2]);
    deviation[i] = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
  }
  removePlateaus(deviation, width, height, textHeight);
  return { clean: deviationToInk(deviation, width, height, textHeight), deviation };
}

/** Fotografias: texto escuro sobre um fundo de iluminação irregular. */
function normalizePhoto(source: RgbaImage, textHeight: number): Pick<NormalizedImage, 'clean' | 'deviation'> {
  const { width, height, data } = source;
  const total = width * height;
  const gray = new Uint8Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  const radius = Math.max(8, Math.round(textHeight * 1.5));
  const background = boxExtreme(gray, width, height, radius, 'max');
  const deviation = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const bg = background[i];
    // Normaliza pela iluminação local, para que as sombras não contem como tinta.
    deviation[i] = bg > gray[i] ? Math.min(255, ((bg - gray[i]) * 255) / Math.max(bg, 60)) : 0;
  }
  return { clean: deviationToInk(deviation, width, height, textHeight), deviation };
}

/**
 * Devolve a imagem "limpa" (fundo branco, tinta escura) à escala original.
 * `textHeight` é opcional: sem ele, é estimado a partir da própria imagem.
 */
export function normalizeImage(source: RgbaImage, textHeight?: number): NormalizedImage {
  const { width, height } = source;
  const flat = flatMask(source);
  let size = textHeight;
  if (size === undefined) {
    const activity = new Uint8Array(flat.length);
    for (let i = 0; i < flat.length; i++) activity[i] = flat[i] === 0 ? 1 : 0;
    // Os blobs de atividade incluem um píxel de transição de cada lado da letra.
    size = estimateTextHeight(activity, width, height, 2) ?? DEFAULT_TEXT_HEIGHT;
  }
  const flatResult = normalizeFlat(source, flat, size);
  if (flatResult) return { ...flatResult, textHeight: size, mode: 'flat' };
  return { ...normalizePhoto(source, size), textHeight: size, mode: 'photo' };
}

export function isImageTooSmall(width: number, height: number): boolean {
  return Math.max(width, height) < MIN_IMAGE_LONG_SIDE || Math.min(width, height) < MIN_IMAGE_SHORT_SIDE;
}

/** Descodifica um ficheiro de imagem para RGBA (apenas browser). O ficheiro não é alterado. */
export async function decodeImageFile(file: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const shrink = Math.min(1, Math.sqrt(MAX_DECODE_PIXELS / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * shrink));
    const height = Math.max(1, Math.round(bitmap.height * shrink));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D indisponível');
    // PNG com transparência: assume papel branco por baixo.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
  } finally {
    bitmap.close();
  }
}

export interface LargeTextRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  textHeight: number;
}

/** Escala (em alturas de texto) da limpeza grosseira usada para encontrar letras grandes. */
const COARSE_SCALE = 3;

/**
 * Zonas com letras muito maiores do que o texto corrente (títulos, "PF1"). Num título a
 * negrito, o interior das hastes é largo o suficiente para parecer fundo à escala do texto
 * corrente e as letras ficam "ocas"; estas zonas são limpas outra vez, à escala delas.
 * Molduras e caixas (muito pouco preenchidas) não contam.
 */
export function findLargeTextRegions(source: RgbaImage, textHeight: number): LargeTextRegion[] {
  // À escala de um título, as hastes deixam de parecer fundo e as letras grandes saem cheias.
  const coarse = normalizeImage(source, textHeight * COARSE_SCALE).clean;
  const { width, height, data } = coarse;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = data[i] < INK_LEVEL ? 1 : 0;
  // Uma caixa tem moldura: os quatro lados do retângulo estão quase todos preenchidos.
  // Numa letra há sempre pelo menos um lado aberto (até no "E" ou no "D").
  const isFramed = (box: { x0: number; y0: number; x1: number; y1: number }): boolean => {
    const side = (x0: number, y0: number, dx: number, dy: number, length: number): number => {
      let filled = 0;
      for (let k = 0; k < length; k++) filled += ink[(y0 + dy * k) * width + (x0 + dx * k)];
      return filled / length;
    };
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    return (
      Math.min(side(box.x0, box.y0, 1, 0, w), side(box.x0, box.y1 - 1, 1, 0, w), side(box.x0, box.y0, 0, 1, h), side(box.x1 - 1, box.y0, 0, 1, h)) >= 0.8
    );
  };
  const glyphs = componentBoxes(ink, width, height).filter((box) => {
    const h = box.y1 - box.y0;
    const w = box.x1 - box.x0;
    const fill = box.area / (w * h);
    if (h <= textHeight * 1.9 || h >= textHeight * 9 || w >= h * 6 || w <= h * 0.12 || fill <= 0.15) return false;
    return !(w > h * 0.7 && isFramed(box));
  });
  // Junta letras vizinhas da mesma linha.
  const regions: (LargeTextRegion & { heights: number[] })[] = [];
  for (const glyph of glyphs.sort((a, b) => a.x0 - b.x0)) {
    const h = glyph.y1 - glyph.y0;
    const region = regions.find((candidate) => {
      const overlap = Math.min(candidate.y1, glyph.y1) - Math.max(candidate.y0, glyph.y0);
      return overlap > h * 0.5 && glyph.x0 - candidate.x1 < h * 1.5;
    });
    if (region) {
      region.x0 = Math.min(region.x0, glyph.x0);
      region.y0 = Math.min(region.y0, glyph.y0);
      region.x1 = Math.max(region.x1, glyph.x1);
      region.y1 = Math.max(region.y1, glyph.y1);
      region.heights.push(h);
    } else {
      regions.push({ x0: glyph.x0, y0: glyph.y0, x1: glyph.x1, y1: glyph.y1, textHeight: h, heights: [h] });
    }
  }
  return regions
    .filter((region) => region.heights.length >= 2)
    .map((region) => {
      const size = Math.max(5, percentile(region.heights, 0.7));
      const pad = Math.round(size * 0.6);
      return {
        x0: Math.max(0, region.x0 - pad),
        y0: Math.max(0, region.y0 - pad),
        x1: Math.min(width, region.x1 + pad),
        y1: Math.min(height, region.y1 + pad),
        textHeight: size,
      };
    });
}

/** Volta a limpar as zonas de letra grande, à escala delas, e cola o resultado na imagem limpa. */
export function renormalizeLargeText(source: RgbaImage, normalized: NormalizedImage): LargeTextRegion[] {
  const regions = findLargeTextRegions(source, normalized.textHeight);
  for (const region of regions) {
    const w = region.x1 - region.x0;
    const h = region.y1 - region.y0;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const from = ((region.y0 + y) * source.width + region.x0) * 4;
      data.set(source.data.subarray(from, from + w * 4), y * w * 4);
    }
    const local = normalizeImage({ data, width: w, height: h }, region.textHeight);
    for (let y = 0; y < h; y++) {
      const target = (region.y0 + y) * normalized.clean.width + region.x0;
      normalized.clean.data.set(local.clean.data.subarray(y * w, (y + 1) * w), target);
      normalized.deviation.set(local.deviation.subarray(y * w, (y + 1) * w), target);
    }
  }
  return regions;
}