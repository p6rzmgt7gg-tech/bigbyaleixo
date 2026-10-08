/**
 * Motor de OCR: uma camada fina sobre o Tesseract.js que lê uma zona da imagem
 * (o conteúdo de uma célula) e devolve o texto com posição e confiança.
 * O reconhecimento corre num Web Worker, no próprio browser — a imagem nunca sai
 * do computador.
 */
import Tesseract from 'tesseract.js';
import type { BBox } from '../types/callSheet';
import { cropGray, encodePgm, resizeGray, type GrayImage, type PixelBox } from './raster';

export interface OcrWord {
  text: string;
  /** 0..1 */
  confidence: number;
  bbox: BBox;
}

/** O texto de uma célula (ou de uma linha solta), em coordenadas da imagem original. */
export interface TextCell {
  text: string;
  /** 0..1 */
  confidence: number;
  bbox: BBox;
  words: OcrWord[];
}

export interface OcrAssetPaths {
  workerPath?: string;
  corePath?: string;
  langPath: string;
}

export type OcrProgress = (fraction: number) => void;

const LANGUAGE = 'por';
/** Modos sem análise de layout: a imagem é uma única linha de texto, ou uma única palavra. */
const PSM_SINGLE_LINE = '7';
const PSM_SINGLE_WORD = '8';

/** Altura das maiúsculas (px) com que o Tesseract lê melhor. */
const TARGET_TEXT_HEIGHT = 30;
const MAX_UPSCALE = 4;
/** Margem branca (px, já à escala final) à volta do recorte. */
const CROP_MARGIN = 12;
/** Abaixo desta confiança a célula é relida a outras escalas e decide-se por maioria. */
const RETRY_BELOW = 0.9;
const RETRY_SCALES = [0.8, 1.25];
const RETRY_NUMERIC_BELOW = 0.97;
/** Textos até este comprimento (um número, "ok", "Lx") são também relidos como palavra isolada. */
const SHORT_TEXT = 3;

function parseTsv(tsv: string | null): OcrWord[] {
  if (!tsv) return [];
  const words: OcrWord[] = [];
  for (const line of tsv.split('\n')) {
    const columns = line.split('\t');
    if (columns.length < 12 || columns[0] !== '5') continue;
    const text = columns.slice(11).join(' ').trim();
    if (!text) continue;
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    words.push({
      text,
      confidence: Math.max(0, Math.min(1, Number(columns[10]) / 100)),
      bbox: { x0: left, y0: top, x1: left + Number(columns[8]), y1: top + Number(columns[9]) },
    });
  }
  return words;
}

interface Reading {
  text: string;
  confidence: number;
  words: OcrWord[];
}

/** Confiança de um conjunto de palavras: média ponderada pelo número de caracteres. */
export function combinedConfidence(words: OcrWord[]): number {
  let characters = 0;
  let weighted = 0;
  for (const word of words) {
    characters += word.text.length;
    weighted += word.confidence * word.text.length;
  }
  return characters === 0 ? 0 : weighted / characters;
}

/** Entre várias leituras da mesma célula, ganha o texto mais repetido; em caso de empate, o mais confiante. */
function electReading(readings: Reading[]): Reading {
  const tally = new Map<string, { votes: number; best: Reading }>();
  for (const reading of readings) {
    const entry = tally.get(reading.text);
    if (!entry) {
      tally.set(reading.text, { votes: 1, best: reading });
    } else {
      entry.votes++;
      if (reading.confidence > entry.best.confidence) entry.best = reading;
    }
  }
  return [...tally.values()].sort((a, b) => b.votes - a.votes || b.best.confidence - a.best.confidence)[0].best;
}

export class OcrEngine {
  private constructor(private readonly worker: Tesseract.Worker) {}

  /**
   * Arranca o worker e carrega o modelo de português. `onLoad` recebe o progresso
   * do arranque (descarga do motor e do modelo na primeira utilização).
   */
  static async create(paths: OcrAssetPaths, onLoad?: OcrProgress): Promise<OcrEngine> {
    const stages: Record<string, [number, number]> = {
      'loading tesseract core': [0, 0.45],
      'initializing tesseract': [0.45, 0.1],
      'loading language traineddata': [0.55, 0.35],
      'initializing api': [0.9, 0.1],
    };
    const worker = await Tesseract.createWorker(LANGUAGE, Tesseract.OEM.LSTM_ONLY, {
      ...paths,
      // O modelo fica na cache HTTP normal do browser; nada é guardado em IndexedDB.
      cacheMethod: 'none',
      gzip: true,
      // O worker é carregado diretamente do próprio domínio (sem blob:), o que permite uma CSP restrita.
      workerBlobURL: false,
      logger: (message) => {
        const stage = stages[message.status];
        if (stage) onLoad?.(stage[0] + stage[1] * message.progress);
      },
    });
    await worker.setParameters({ user_defined_dpi: '300' });
    onLoad?.(1);
    return new OcrEngine(worker);
  }

  private async recognize(image: GrayImage, pageSegMode: string): Promise<OcrWord[]> {
    // O tipo ImageLike não lista Uint8Array, mas o Tesseract.js aceita os bytes de uma imagem diretamente.
    const input = encodePgm(image) as unknown as Tesseract.ImageLike;
    const options = { tessedit_pageseg_mode: pageSegMode } as Partial<Tesseract.RecognizeOptions>;
    const result = await this.worker.recognize(input, options, { text: false, tsv: true });
    return parseTsv(result.data.tsv);
  }

  private async read(clean: GrayImage, box: PixelBox, scale: number, pageSegMode = PSM_SINGLE_LINE): Promise<Reading> {
    const margin = Math.ceil(CROP_MARGIN / scale);
    const crop = resizeGray(cropGray(clean, box, margin), scale);
    const words = (await this.recognize(crop, pageSegMode)).map((word) => ({
      ...word,
      bbox: {
        x0: box.x0 - margin + word.bbox.x0 / scale,
        y0: box.y0 - margin + word.bbox.y0 / scale,
        x1: box.x0 - margin + word.bbox.x1 / scale,
        y1: box.y0 - margin + word.bbox.y1 / scale,
      },
    }));
    return { text: words.map((word) => word.text).join(' '), confidence: combinedConfidence(words), words };
  }

  /**
   * Lê um segmento de texto da imagem limpa. Devolve `null` se não houver nada legível.
   * `textHeight` é a altura típica das maiúsculas no documento.
   */
  async readCell(clean: GrayImage, box: PixelBox, textHeight: number): Promise<TextCell | null> {
    // O texto corrente é ampliado até à altura ideal; títulos grandes são reduzidos para caber.
    const scale = Math.min(MAX_UPSCALE, TARGET_TEXT_HEIGHT / textHeight, (TARGET_TEXT_HEIGHT * 1.6) / (box.y1 - box.y0));

    let reading = await this.read(clean, box, scale);
    // Números curtos (horas, nº de câmara) não têm dicionário que ajude: confirmam-se sempre.
    const numeric = /^[\d:.,\s-]{1,8}$/.test(reading.text);
    if (reading.confidence < (numeric ? RETRY_NUMERIC_BELOW : RETRY_BELOW)) {
      // Leitura duvidosa: repete a outras escalas e decide por maioria. Um texto muito
      // curto, isolado numa célula, é o caso mais difícil — vota também como palavra única.
      const readings = [reading];
      for (const factor of RETRY_SCALES) readings.push(await this.read(clean, box, scale * factor));
      if (reading.text.length <= SHORT_TEXT) {
        for (const factor of [1, ...RETRY_SCALES]) readings.push(await this.read(clean, box, scale * factor, PSM_SINGLE_WORD));
      }
      const legible = readings.filter((candidate) => candidate.text !== '');
      if (legible.length === 0) return null;
      reading = electReading(legible);
    }
    if (reading.text === '') return null;
    return { text: reading.text, confidence: reading.confidence, bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }, words: reading.words };
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}
