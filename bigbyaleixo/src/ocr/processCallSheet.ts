/**
 * Ponto de entrada no browser: do ficheiro escolhido pelo utilizador aos dados estruturados.
 * O ficheiro é lido em memória e processado localmente; não é enviado para lado nenhum.
 */
import type { CallSheetTemplate } from '../templates';
import { checkImageFile, isHeic } from '../utils/validators';
import { decodeImageFile, isImageTooSmall } from './imagePreprocessor';
import { OcrEngine, type OcrAssetPaths } from './ocrEngine';
import { analyzeImage, PipelineError, stagePercent, throwIfAborted, type AnalysisOptions, type AnalysisResult } from './pipeline';
import { prepareImage, type PreparedImage } from './prepare';
import type { PrepareResponse } from './prepare.worker';
import type { RgbaImage } from './raster';

/** O motor de OCR é servido pela própria aplicação (ver scripts/copy-ocr-assets.mjs). */
function ocrAssetPaths(): OcrAssetPaths {
  const base = `${import.meta.env.BASE_URL}ocr/${__OCR_ASSETS_VERSION__}`;
  return { workerPath: `${base}/worker.min.js`, corePath: `${base}/core`, langPath: `${base}/lang` };
}

/** Prepara a imagem num Web Worker, para a interface continuar a responder. */
function prepareInWorker(source: RgbaImage): Promise<PreparedImage> {
  if (typeof Worker === 'undefined') return Promise.resolve(prepareImage(source));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' });
    const finish = (action: () => void): void => {
      worker.terminate();
      action();
    };
    worker.onmessage = (event: MessageEvent<PrepareResponse>) => {
      const response = event.data;
      finish(() => (response.ok ? resolve(response.prepared) : reject(new PipelineError('unreadable'))));
    };
    worker.onerror = () => finish(() => reject(new PipelineError('unreadable')));
    // Envia uma cópia: o original continua disponível para ler as cores e as barras da folha.
    const copy = { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height };
    worker.postMessage(copy, [copy.data.buffer]);
  });
}

export async function processCallSheet(file: File, template: CallSheetTemplate, options: Pick<AnalysisOptions, 'onProgress' | 'signal'> = {}): Promise<AnalysisResult> {
  const { onProgress, signal } = options;
  const problem = checkImageFile(file);
  if (problem) throw new PipelineError(problem);

  onProgress?.({ stage: 'prepare', percent: stagePercent('prepare', 0.1) });
  // O motor arranca em paralelo com a leitura da imagem (na primeira vez descarrega o modelo).
  const enginePromise = OcrEngine.create(ocrAssetPaths(), (fraction) => {
    onProgress?.({ stage: 'prepare', percent: stagePercent('prepare', 0.2 + fraction * 0.8) });
  });
  // Evita um aviso de promessa rejeitada sem tratamento se a descodificação falhar primeiro.
  enginePromise.catch(() => undefined);

  let engine: OcrEngine | null = null;
  try {
    let source: RgbaImage;
    try {
      source = await decodeImageFile(file);
    } catch {
      throw new PipelineError(isHeic(file) ? 'heic_unsupported' : 'unreadable');
    }
    if (isImageTooSmall(source.width, source.height)) throw new PipelineError('image_too_small');
    throwIfAborted(signal);

    const preparing = prepareInWorker(source);
    preparing.catch(() => undefined);
    try {
      engine = await enginePromise;
    } catch {
      throw new PipelineError('unreadable');
    }
    return await analyzeImage(source, engine, template, { onProgress, signal, prepare: () => preparing });
  } finally {
    // Liberta o worker do OCR (e a memória do modelo) mesmo em caso de erro ou cancelamento.
    void (engine ? engine.terminate() : enginePromise.then((created) => created.terminate()).catch(() => undefined));
  }
}
