/**
 * Primitivas de imagem sobre typed arrays. Não dependem do DOM, por isso correm
 * tanto no browser como em testes (Node).
 */

export interface GrayImage {
  /** 0 = preto, 255 = branco. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Caixa em píxeis; x1/y1 são exclusivos. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

/**
 * Componentes ligados (conectividade 8) de uma máscara binária, devolvidos como
 * caixas envolventes. Trabalha por segmentos horizontais, pelo que o custo
 * depende do número de segmentos e não do número de píxeis.
 */
export function componentBoxes(mask: Uint8Array, width: number, height: number): PixelBox[] {
  const parent: number[] = [];
  const x0: number[] = [];
  const y0: number[] = [];
  const x1: number[] = [];
  const y1: number[] = [];
  const area: number[] = [];

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

  const union = (a: number, b: number): number => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    parent[rb] = ra;
    if (x0[rb] < x0[ra]) x0[ra] = x0[rb];
    if (y0[rb] < y0[ra]) y0[ra] = y0[rb];
    if (x1[rb] > x1[ra]) x1[ra] = x1[rb];
    if (y1[rb] > y1[ra]) y1[ra] = y1[rb];
    area[ra] += area[rb];
    return ra;
  };

  let prevStarts: number[] = [];
  let prevEnds: number[] = [];
  let prevLabels: number[] = [];

  for (let y = 0; y < height; y++) {
    const starts: number[] = [];
    const ends: number[] = [];
    const labels: number[] = [];
    const offset = y * width;
    let pointer = 0;
    let x = 0;
    while (x < width) {
      if (mask[offset + x] === 0) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && mask[offset + x] !== 0) x++;
      const end = x;

      let label = -1;
      while (pointer < prevStarts.length && prevEnds[pointer] < start) pointer++;
      for (let k = pointer; k < prevStarts.length && prevStarts[k] <= end; k++) {
        label = label === -1 ? find(prevLabels[k]) : union(label, prevLabels[k]);
      }
      if (label === -1) {
        label = parent.length;
        parent.push(label);
        x0.push(start);
        y0.push(y);
        x1.push(end);
        y1.push(y + 1);
        area.push(end - start);
      } else {
        if (start < x0[label]) x0[label] = start;
        if (end > x1[label]) x1[label] = end;
        y1[label] = y + 1;
        area[label] += end - start;
      }
      starts.push(start);
      ends.push(end);
      labels.push(label);
    }
    prevStarts = starts;
    prevEnds = ends;
    prevLabels = labels;
  }

  const boxes: PixelBox[] = [];
  for (let label = 0; label < parent.length; label++) {
    if (parent[label] === label) {
      boxes.push({ x0: x0[label], y0: y0[label], x1: x1[label], y1: y1[label], area: area[label] });
    }
  }
  return boxes;
}

interface Taps {
  index: Int32Array;
  weight: Float32Array;
  count: number;
}

/** Pesos de reamostragem: Catmull-Rom ao ampliar, média de área ao reduzir. */
function buildTaps(sourceLength: number, targetLength: number): Taps {
  const scale = targetLength / sourceLength;
  if (scale >= 1) {
    const count = 4;
    const index = new Int32Array(targetLength * count);
    const weight = new Float32Array(targetLength * count);
    for (let i = 0; i < targetLength; i++) {
      const center = (i + 0.5) / scale - 0.5;
      const base = Math.floor(center);
      const t = center - base;
      const w0 = ((-0.5 * t + 1) * t - 0.5) * t;
      const w1 = (1.5 * t - 2.5) * t * t + 1;
      const w2 = ((-1.5 * t + 2) * t + 0.5) * t;
      const w3 = (0.5 * t - 0.5) * t * t;
      const weights = [w0, w1, w2, w3];
      for (let k = 0; k < count; k++) {
        const position = base - 1 + k;
        index[i * count + k] = position < 0 ? 0 : position >= sourceLength ? sourceLength - 1 : position;
        weight[i * count + k] = weights[k];
      }
    }
    return { index, weight, count };
  }

  const span = 1 / scale;
  const count = Math.ceil(span) + 1;
  const index = new Int32Array(targetLength * count);
  const weight = new Float32Array(targetLength * count);
  for (let i = 0; i < targetLength; i++) {
    const from = i * span;
    const to = from + span;
    let total = 0;
    for (let k = 0; k < count; k++) {
      const position = Math.floor(from) + k;
      const overlap = Math.max(0, Math.min(to, position + 1) - Math.max(from, position));
      index[i * count + k] = position >= sourceLength ? sourceLength - 1 : position;
      weight[i * count + k] = overlap;
      total += overlap;
    }
    for (let k = 0; k < count; k++) weight[i * count + k] /= total;
  }
  return { index, weight, count };
}

/** Redimensiona uma imagem de cinzentos (bicúbico ao ampliar). */
export function resizeGray(source: GrayImage, scale: number): GrayImage {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  if (width === source.width && height === source.height) {
    return { data: source.data.slice(), width, height };
  }

  const horizontal = buildTaps(source.width, width);
  const temp = new Float32Array(width * source.height);
  for (let y = 0; y < source.height; y++) {
    const sourceOffset = y * source.width;
    const targetOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      const tap = x * horizontal.count;
      for (let k = 0; k < horizontal.count; k++) {
        sum += source.data[sourceOffset + horizontal.index[tap + k]] * horizontal.weight[tap + k];
      }
      temp[targetOffset + x] = sum;
    }
  }

  const vertical = buildTaps(source.height, height);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const tap = y * vertical.count;
    const targetOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = 0; k < vertical.count; k++) {
        sum += temp[vertical.index[tap + k] * width + x] * vertical.weight[tap + k];
      }
      data[targetOffset + x] = sum <= 0 ? 0 : sum >= 255 ? 255 : (sum + 0.5) | 0;
    }
  }
  return { data, width, height };
}

/** Recorta uma zona, acrescentando uma margem branca à volta. */
export function cropGray(source: GrayImage, box: { x0: number; y0: number; x1: number; y1: number }, margin: number): GrayImage {
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;
  const width = boxWidth + margin * 2;
  const height = boxHeight + margin * 2;
  const data = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < boxHeight; y++) {
    const sourceY = box.y0 + y;
    if (sourceY < 0 || sourceY >= source.height) continue;
    const from = Math.max(0, box.x0);
    const to = Math.min(source.width, box.x1);
    if (to <= from) continue;
    data.set(source.data.subarray(sourceY * source.width + from, sourceY * source.width + to), (y + margin) * width + margin + (from - box.x0));
  }
  return { data, width, height };
}

/** Marca os píxeis que pertencem a sequências (horizontais ou verticais) com pelo menos `minLength`. */
export function longRuns(mask: Uint8Array, width: number, height: number, minLength: number, direction: 'h' | 'v'): Uint8Array {
  const out = new Uint8Array(width * height);
  if (direction === 'h') {
    for (let y = 0; y < height; y++) {
      const offset = y * width;
      let x = 0;
      while (x < width) {
        if (mask[offset + x] === 0) {
          x++;
          continue;
        }
        const start = x;
        while (x < width && mask[offset + x] !== 0) x++;
        if (x - start >= minLength) out.fill(1, offset + start, offset + x);
      }
    }
    return out;
  }
  const runLength = new Int32Array(width);
  for (let y = 0; y <= height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      if (y < height && mask[offset + x] !== 0) {
        runLength[x]++;
        continue;
      }
      const length = runLength[x];
      if (length >= minLength) {
        for (let k = 1; k <= length; k++) out[(y - k) * width + x] = 1;
      }
      runLength[x] = 0;
    }
  }
  return out;
}

/**
 * Máximo (ou mínimo) numa janela quadrada de raio `radius` — dilatação/erosão morfológica.
 * Algoritmo de van Herk: custo independente do tamanho da janela. As duas passagens
 * (horizontal e vertical) percorrem a memória sempre em sequência.
 */
export function boxExtreme(source: Uint8Array, width: number, height: number, radius: number, kind: 'max' | 'min'): Uint8Array {
  const isMax = kind === 'max';
  const window = radius * 2 + 1;
  const total = width * height;

  // Horizontal: por blocos de `window`, máximo acumulado da esquerda e da direita.
  const forward = new Uint8Array(total);
  const backward = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    let running = 0;
    for (let x = 0; x < width; x++) {
      const value = source[offset + x];
      running = x % window === 0 ? value : isMax ? (value > running ? value : running) : value < running ? value : running;
      forward[offset + x] = running;
    }
    for (let x = width - 1; x >= 0; x--) {
      const value = source[offset + x];
      running = x === width - 1 || (x + 1) % window === 0 ? value : isMax ? (value > running ? value : running) : value < running ? value : running;
      backward[offset + x] = running;
    }
  }
  const rows = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      const left = backward[offset + (x - radius < 0 ? 0 : x - radius)];
      const right = forward[offset + (x + radius >= width ? width - 1 : x + radius)];
      rows[offset + x] = isMax ? (left > right ? left : right) : left < right ? left : right;
    }
  }

  // Vertical: o mesmo, linha a linha, reutilizando os dois buffers.
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    const restart = y % window === 0;
    for (let x = 0; x < width; x++) {
      const value = rows[offset + x];
      if (restart) {
        forward[offset + x] = value;
      } else {
        const above = forward[offset - width + x];
        forward[offset + x] = isMax ? (value > above ? value : above) : value < above ? value : above;
      }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    const offset = y * width;
    const restart = y === height - 1 || (y + 1) % window === 0;
    for (let x = 0; x < width; x++) {
      const value = rows[offset + x];
      if (restart) {
        backward[offset + x] = value;
      } else {
        const below = backward[offset + width + x];
        backward[offset + x] = isMax ? (value > below ? value : below) : value < below ? value : below;
      }
    }
  }
  const out = rows;
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    const top = (y - radius < 0 ? 0 : y - radius) * width;
    const bottom = (y + radius >= height ? height - 1 : y + radius) * width;
    for (let x = 0; x < width; x++) {
      const up = backward[top + x];
      const down = forward[bottom + x];
      out[offset + x] = isMax ? (up > down ? up : down) : up < down ? up : down;
    }
  }
  return out;
}

/** PGM binário (P5): o formato mais barato de entregar ao Tesseract. */
export function encodePgm(image: GrayImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${image.width} ${image.height}\n255\n`);
  const bytes = new Uint8Array(header.length + image.data.length);
  bytes.set(header, 0);
  bytes.set(image.data, header.length);
  return bytes;
}

/** Percentil (0..1) de uma lista de números; devolve `fallback` se estiver vazia. */
export function percentile(values: number[], fraction: number, fallback = 0): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[position];
}
