/**
 * Anotações à mão (traços de caneta de um screenshot anotado): traços longos, finos e
 * numa cor saturada que atravessam o documento. São apagados antes do OCR. Os títulos
 * a cor (ex.: vermelho) não são afetados: as letras são componentes pequenas, e só as
 * cores usadas em traços longos são removidas.
 */
import { componentBoxes, type RgbaImage } from './raster';

const MIN_SATURATION = 0.35;
/** As canetas de anotação são cores vivas; tons escuros (azul-marinho, bordô) são do documento. */
const MIN_VALUE = 0.45;
const HUE_TOLERANCE = 22;

function hueAndSaturation(r: number, g: number, b: number): { hue: number; saturation: number; value: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const value = max / 255;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation, value };
}

const hueDistance = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Apaga (pinta de branco) os traços de anotação. Devolve o número de píxeis apagados. */
export function removeAnnotations(image: RgbaImage, textHeight: number): number {
  const { width, height, data } = image;
  const total = width * height;
  const saturated = new Uint8Array(total);
  const hues = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const { hue, saturation, value } = hueAndSaturation(data[p], data[p + 1], data[p + 2]);
    if (saturation >= MIN_SATURATION && value >= MIN_VALUE) {
      saturated[i] = 1;
      hues[i] = hue;
    }
  }

  // Traços: componentes compridas e pouco preenchidas (uma letra é pequena; uma barra de cor é cheia).
  const strokeHues: number[] = [];
  for (const box of componentBoxes(saturated, width, height)) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (Math.max(w, h) < textHeight * 8 || box.area / (w * h) > 0.12) continue;
    // Uma moldura (caixa) tem quase todos os píxeis junto às bordas; um traço à mão não.
    const margin = Math.max(3, Math.round(Math.min(w, h) * 0.06));
    let onBorder = 0;
    let inside = 0;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        if (!saturated[y * width + x]) continue;
        if (x - box.x0 < margin || box.x1 - 1 - x < margin || y - box.y0 < margin || box.y1 - 1 - y < margin) onBorder++;
        else inside++;
      }
    }
    if (onBorder / Math.max(1, onBorder + inside) > 0.6) continue;
    // Cor típica do traço: amostra ao longo da caixa.
    const sample: number[] = [];
    for (let y = box.y0; y < box.y1 && sample.length < 400; y += Math.max(1, Math.floor(h / 40))) {
      for (let x = box.x0; x < box.x1; x += Math.max(1, Math.floor(w / 40))) {
        const i = y * width + x;
        if (saturated[i]) sample.push(hues[i]);
      }
    }
    if (sample.length === 0) continue;
    sample.sort((a, b) => a - b);
    strokeHues.push(sample[sample.length >> 1]);
  }
  if (strokeHues.length === 0) return 0;

  const nearStroke = (hue: number): boolean => strokeHues.some((stroke) => hueDistance(stroke, hue) <= HUE_TOLERANCE);
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (saturated[i] && nearStroke(hues[i])) mask[i] = 1;

  // Orla do traço (anti-aliasing): vizinhos claros, ou ligeiramente tingidos da mesma cor.
  for (let pass = 0; pass < 2; pass++) {
    const grow: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (mask[i]) continue;
        const touches = (x > 0 && mask[i - 1]) || (x < width - 1 && mask[i + 1]) || (y > 0 && mask[i - width]) || (y < height - 1 && mask[i + width]);
        if (!touches) continue;
        const p = i * 4;
        const { hue, saturation, value } = hueAndSaturation(data[p], data[p + 1], data[p + 2]);
        if ((saturation >= 0.1 && nearStroke(hue)) || (value > 0.72 && saturation < 0.35)) grow.push(i);
      }
    }
    for (const i of grow) mask[i] = 1;
  }

  let removed = 0;
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    if (!mask[i]) continue;
    data[p] = 255;
    data[p + 1] = 255;
    data[p + 2] = 255;
    removed++;
  }
  return removed;
}
