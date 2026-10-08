/**
 * Acentos em maiúsculas: em letra pequena o OCR perde muitas vezes o til e o acento
 * ("JOAO", "SIMOES"). Repõe-se a grafia quando a palavra sem acento só pode ser uma
 * palavra portuguesa acentuada conhecida — e o campo fica para confirmar.
 */
import type { Field } from '../../types/callSheet';
import { INFERRED_CONFIDENCE } from './values';

/** Nomes, apelidos e palavras frequentes em call sheets que levam acento. */
const ACCENTED = [
  'JOÃO', 'ANDRÉ', 'JOSÉ', 'MÁRIO', 'LUÍS', 'INÊS', 'ANTÓNIO', 'GONÇALO', 'VÍTOR', 'SÉRGIO', 'CLÁUDIA', 'PATRÍCIA', 'LÚCIA', 'JÚLIA',
  'SÓNIA', 'ÂNGELA', 'BÁRBARA', 'FÁBIO', 'MÁRCIO', 'MÁRCIA', 'NÉLSON', 'RÚBEN', 'TOMÁS', 'ESTÊVÃO', 'SALOMÃO', 'SEBASTIÃO', 'CONCEIÇÃO',
  'ASSUNÇÃO', 'NAZARÉ', 'MÓNICA', 'ÁLVARO', 'ÓSCAR', 'ÍRIS', 'NOÉMIA', 'GLÓRIA', 'VALÉRIA', 'LETÍCIA', 'NATÁLIA', 'VITÓRIA', 'SIMÃO',
  'SIMÕES', 'GONÇALVES', 'MAGALHÃES', 'GUIMARÃES', 'LOURENÇO', 'BRANDÃO', 'ROMÃO', 'LEITÃO', 'FALCÃO', 'MOURÃO', 'ARAÚJO', 'GALVÃO',
  'FRAZÃO', 'SERRÃO', 'ANTÃO', 'BARÃO', 'ABRAÃO', 'ADÃO', 'JORDÃO', 'BRAGANÇA', 'FONSECA', 'PROENÇA', 'VALÉRIO', 'DAMIÃO', 'CRISTÓVÃO',
  'ESTÁDIO', 'PAVILHÃO', 'SÁBADO', 'TÉCNICO', 'TÉCNICA', 'VÍDEO', 'CÂMARA', 'CÂMARAS', 'PRODUÇÃO', 'REALIZAÇÃO', 'LOGÍSTICA', 'FÓRUM',
];

const strip = (word: string): string => word.normalize('NFD').replace(/[̀-ͯ]/g, '');

const LOOKUP = new Map<string, string>();
for (const word of ACCENTED) if (strip(word) !== word) LOOKUP.set(strip(word), word);

/** Devolve o texto com os acentos repostos, ou `null` se não houver nada a mudar. */
export function restoreAccents(text: string): string | null {
  let changed = false;
  const out = text.replace(/\p{L}+/gu, (word) => {
    // Só palavras em maiúsculas sem nenhum acento (em caixa mista o OCR lê bem os acentos).
    if (word !== word.toUpperCase() || strip(word) !== word) return word;
    const fixed = LOOKUP.get(word);
    if (!fixed) return word;
    changed = true;
    return fixed;
  });
  return changed ? out : null;
}

export function withRestoredAccents(field: Field): Field {
  const fixed = restoreAccents(field.value);
  return fixed === null ? field : { ...field, value: fixed, confidence: Math.min(field.confidence ?? 1, INFERRED_CONFIDENCE) };
}
