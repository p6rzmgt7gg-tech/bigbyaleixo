/**
 * Preparação da imagem: tudo o que acontece antes do OCR.
 * É trabalho pesado sobre píxeis; no browser corre num Web Worker (prepare.worker.ts)
 * para a interface nunca ficar parada.
 */
import { estimateTextHeight, normalizeImage, renormalizeLargeText, type NormalizationMode } from './imagePreprocessor';
import { removeAnnotations } from './annotations';
import { findBars } from './parsing/sheetGrid';
import { componentBoxes, type GrayImage, type PixelBox, type RgbaImage } from './raster';
import { detectAndEraseRules, findTextSegments, inkMask, type Rule } from './tableDetector';

export interface PreparedImage {
  /** Imagem limpa, à escala original e já sem os traços da grelha. */
  clean: GrayImage;
  /** Traços da grelha: separadores de células. */
  rules: Rule[];
  /** Zonas de texto: cada uma é o conteúdo de uma célula. */
  segments: PixelBox[];
  /** Altura típica das maiúsculas, em píxeis. */
  textHeight: number;
  mode: NormalizationMode;
}

/** Tolerância entre a altura de texto estimada à partida e a medida na imagem limpa. */
const TEXT_HEIGHT_TOLERANCE = 0.25;

function prepareOnce(source: RgbaImage, textHeight?: number): Omit<PreparedImage, 'segments'> & { glyphs: PixelBox[] } {
  const normalized = normalizeImage(source, textHeight);
  // Nas zonas de letra grande, as hastes das letras parecem traços: não se procuram traços aí.
  const large = renormalizeLargeText(source, normalized);
  const rules = detectAndEraseRules(normalized.clean, normalized.deviation, source, normalized.textHeight, large);
  const glyphs = componentBoxes(inkMask(normalized.clean), source.width, source.height);
  return { clean: normalized.clean, rules, glyphs, textHeight: normalized.textHeight, mode: normalized.mode };
}

export function prepareImage(original: RgbaImage): PreparedImage {
  // Trabalha sobre uma cópia: o original nunca é alterado.
  const source: RgbaImage = { data: new Uint8ClampedArray(original.data), width: original.width, height: original.height };
  const estimate = normalizeImage(source).textHeight;
  // Riscos à mão só existem em fotografias; numa folha em grelha (captura da folha de cálculo)
  // o texto colorido é conteúdo (nomes a laranja) e não se apaga.
  const bars = findBars(source, estimate);
  if (bars.length < 6) removeAnnotations(source, estimate);
  else darkenColoredText(source, bars);
  // A primeira passagem estima o tamanho do texto a olho; se a medição feita na imagem
  // limpa (letras isoladas, sem grelha) for muito diferente, repete-se com o valor certo.
  let pass = prepareOnce(source);
  const measured = estimateTextHeight(inkMask(pass.clean), source.width, source.height, 0);
  if (measured !== null && Math.abs(measured - pass.textHeight) > pass.textHeight * TEXT_HEIGHT_TOLERANCE) {
    pass = prepareOnce(source, measured);
  }
  const { glyphs, ...prepared } = pass;
  // Folha em grelha: as arestas das barras dos títulos separam o título da primeira linha do bloco.
  if (bars.length >= 6) {
    for (const bar of bars) {
      for (const y of [bar.y0 - 0.5, bar.y1 + 0.5]) prepared.rules.push({ orientation: 'h', position: y, start: bar.x0, end: bar.x1, thickness: 1 });
    }
  }
  const segments = findTextSegments(glyphs, prepared.rules, prepared.textHeight);
  if (bars.length >= 6) removeStrikethrough(prepared.clean, segments, prepared.textHeight);
  return { ...prepared, segments };
}

/**
 * Nomes riscados (folhas em grelha): o traço horizontal que atravessa a palavra estraga a
 * leitura. Uma linha de píxeis quase toda preenchida de ponta a ponta dentro de uma zona
 * de texto é o risco, e é apagada.
 */
function removeStrikethrough(clean: GrayImage, segments: PixelBox[], textHeight: number): void {
  const { data, width } = clean;
  for (const box of segments) {
    const w = box.x1 - box.x0;
    if (w < textHeight * 3) continue;
    const struck: number[] = [];
    for (let y = box.y0 + 1; y < box.y1 - 1; y++) {
      let ink = 0;
      for (let x = box.x0; x < box.x1; x++) if (data[y * width + x] < 128) ink++;
      if (ink >= w * 0.85) struck.push(y);
    }
    if (!struck.length || struck.length > 3) continue;
    const up = Math.min(...struck) - 1;
    const down = Math.max(...struck) + 1;
    for (let x = box.x0; x < box.x1; x++) {
      // Mantém as hastes das letras: só apaga onde não há tinta por cima e por baixo do risco.
      if (data[up * width + x] < 128 && data[down * width + x] < 128) continue;
      for (const y of struck) data[y * width + x] = 255;
    }
  }
}

/** Folha em grelha: texto a laranja/vermelho (nomes riscados) passa a escuro, para ser lido como o resto. */
function darkenColoredText(image: RgbaImage, bars: { y0: number }[]): void {
  const top = Math.min(...bars.map((bar) => bar.y0));
  const { data, width, height } = image;
  // Só por baixo do cabeçalho colorido.
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r - b > 70 && r > 140 && g < r - 20) {
        const ink = Math.round(Math.max(0, 255 - (r - b) * 2.2));
        data[i] = data[i + 1] = data[i + 2] = Math.min(ink, 90);
      }
    }
  }
}
