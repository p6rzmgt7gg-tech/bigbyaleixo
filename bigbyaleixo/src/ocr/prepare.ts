/**
 * Preparação da imagem: tudo o que acontece antes do OCR.
 * É trabalho pesado sobre píxeis; no browser corre num Web Worker (prepare.worker.ts)
 * para a interface nunca ficar parada.
 */
import { estimateTextHeight, normalizeImage, renormalizeLargeText, type NormalizationMode } from './imagePreprocessor';
import { removeAnnotations } from './annotations';
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
  removeAnnotations(source, estimate);
  // A primeira passagem estima o tamanho do texto a olho; se a medição feita na imagem
  // limpa (letras isoladas, sem grelha) for muito diferente, repete-se com o valor certo.
  let pass = prepareOnce(source);
  const measured = estimateTextHeight(inkMask(pass.clean), source.width, source.height, 0);
  if (measured !== null && Math.abs(measured - pass.textHeight) > pass.textHeight * TEXT_HEIGHT_TOLERANCE) {
    pass = prepareOnce(source, measured);
  }
  const { glyphs, ...prepared } = pass;
  return { ...prepared, segments: findTextSegments(glyphs, prepared.rules, prepared.textHeight) };
}
