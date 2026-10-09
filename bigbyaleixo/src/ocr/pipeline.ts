/**
 * Pipeline completo, do original aos dados estruturados:
 *
 *   ORIGINAL → imagem limpa → traços e células → OCR célula a célula → campos do template
 *
 * A imagem original nunca é alterada nem enviada para fora do browser.
 */
import type { CallSheetTemplate } from '../templates';
import type { OcrEngine, TextCell } from './ocrEngine';
import { prepareImage, type PreparedImage } from './prepare';
import type { RgbaImage } from './raster';
import { isCallSheet, parseCallSheet, type ParseResult } from './textParser';

export type PipelineStage = 'prepare' | 'tables' | 'ocr' | 'fields' | 'done';

export interface PipelineProgress {
  stage: PipelineStage;
  /** 0..100 */
  percent: number;
}

export type PipelineErrorCode = 'unsupported_format' | 'heic_unsupported' | 'file_too_large' | 'image_too_small' | 'unreadable' | 'not_a_call_sheet';

export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    /** O que foi possível ler, quando o documento não parece um call sheet. */
    readonly partial?: AnalysisResult,
  ) {
    super(code);
    this.name = 'PipelineError';
  }
}

export interface AnalysisResult extends ParseResult {
  imageWidth: number;
  imageHeight: number;
}

export interface AnalysisOptions {
  onProgress?: (progress: PipelineProgress) => void;
  signal?: AbortSignal;
  /** Como preparar a imagem; por omissão, na própria thread. O browser usa um Web Worker. */
  prepare?: (source: RgbaImage) => PreparedImage | Promise<PreparedImage>;
}

/** Percentagem em que cada fase começa. */
export const STAGE_START: Record<PipelineStage, number> = { prepare: 0, tables: 12, ocr: 25, fields: 92, done: 100 };
const STAGES = Object.keys(STAGE_START) as PipelineStage[];
/** Um documento com mais zonas de texto do que isto não é uma folha de equipa (ou é ruído). */
const MAX_SEGMENTS = 1500;

export function stagePercent(stage: PipelineStage, fraction = 0): number {
  const start = STAGE_START[stage];
  const end = STAGE_START[STAGES[Math.min(STAGES.indexOf(stage) + 1, STAGES.length - 1)]];
  return Math.round(start + (end - start) * Math.max(0, Math.min(1, fraction)));
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Processamento cancelado', 'AbortError');
}

/** Analisa uma imagem já descodificada. Não depende do DOM: corre no browser e em testes. */
export async function analyzeImage(source: RgbaImage, engine: OcrEngine, template: CallSheetTemplate, options: AnalysisOptions = {}): Promise<AnalysisResult> {
  const { onProgress, signal, prepare = prepareImage } = options;
  const report = (stage: PipelineStage, fraction = 0): void => onProgress?.({ stage, percent: stagePercent(stage, fraction) });
  const { width, height } = source;

  // 1 e 2. Imagem limpa e estrutura: cada zona de texto é o conteúdo de uma célula.
  report('tables');
  const prepared = await prepare(source);
  throwIfAborted(signal);
  const { clean, rules, segments, textHeight } = prepared;
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) throw new PipelineError('unreadable');

  // 3. OCR célula a célula.
  const cells: TextCell[] = [];
  for (let i = 0; i < segments.length; i++) {
    throwIfAborted(signal);
    report('ocr', i / segments.length);
    const cell = await engine.readCell(clean, segments[i], textHeight);
    if (cell) cells.push(cell);
  }
  if (cells.length === 0) throw new PipelineError('unreadable');

  // 4. Campos segundo o template.
  report('fields');
  const parsed = parseCallSheet({ image: source, cells, rules, width, height, textHeight }, template);
  const result: AnalysisResult = { ...parsed, imageWidth: width, imageHeight: height };
  if (!isCallSheet(parsed)) throw new PipelineError('not_a_call_sheet', result);
  report('done');
  return result;
}
