import type { PipelineErrorCode, PipelineStage } from '../ocr/pipeline';

/** Mensagens mostradas ao utilizador. Erros técnicos nunca chegam ao ecrã. */
export const ERROR_MESSAGES: Record<PipelineErrorCode, { title: string; hint: string }> = {
  unsupported_format: {
    title: 'Formato não suportado.',
    hint: 'Carregue uma imagem JPG, JPEG, PNG ou HEIC.',
  },
  heic_unsupported: {
    title: 'Este browser não abre fotografias HEIC.',
    hint: 'Abra a aplicação no Safari, ou exporte a imagem como JPG (no iPhone: Definições › Câmara › Formatos › Mais compatível).',
  },
  file_too_large: {
    title: 'Ficheiro demasiado grande.',
    hint: 'O limite é 20 MB. Exporte a imagem com menos resolução ou em JPG.',
  },
  image_too_small: {
    title: 'Imagem demasiado pequena.',
    hint: 'O texto não tem resolução suficiente para ser lido. Use a imagem original, sem redução.',
  },
  unreadable: {
    title: 'Não foi possível ler o documento.',
    hint: 'Confirme que a imagem está nítida, direita e completa, e tente novamente.',
  },
  not_a_call_sheet: {
    title: 'Não foram encontrados campos suficientes para identificar um Call Sheet.',
    hint: 'Pode carregar outra imagem ou continuar e preencher os dados à mão.',
  },
};

export const STAGE_LABELS: Record<PipelineStage, string> = {
  prepare: 'Preparar imagem…',
  tables: 'Identificar tabelas…',
  ocr: 'OCR…',
  fields: 'Organizar campos…',
  done: 'Concluído.',
};

export const NEEDS_REVIEW_MESSAGE = 'Alguns campos precisam de confirmação.';
