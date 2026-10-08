/** Normalização e comparação de rótulos lidos pelo OCR. */

/** Minúsculas, sem acentos, sem pontuação: "Ass. Realização" → "ass realizacao", "Nº elementos:" → "n elementos". */
export function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[º°ª]/g, '')
    .replace(/[^a-z0-9#?]+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Semelhança (0..1) entre um texto normalizado e um rótulo conhecido, tolerando os
 * erros típicos do OCR. Rótulos curtos exigem correspondência quase exata.
 */
export function labelSimilarity(text: string, alias: string): number {
  if (text === alias) return 1;
  const compactText = text.replace(/ /g, '');
  const compactAlias = alias.replace(/ /g, '');
  if (compactText === compactAlias) return 0.97;
  const length = compactAlias.length;
  if (length < 3 || Math.abs(compactText.length - length) > 2) return 0;
  const allowed = length >= 8 ? 2 : 1;
  const distance = editDistance(compactText, compactAlias);
  return distance <= allowed ? 1 - distance / length : 0;
}

/** Melhor correspondência entre um texto normalizado e uma lista de rótulos. */
export function bestAliasScore(text: string, aliases: string[]): number {
  let best = 0;
  for (const alias of aliases) {
    const score = labelSimilarity(text, alias);
    if (score > best) best = score;
  }
  return best;
}

const LETTER = /\p{L}/gu;

export function countLetters(text: string): number {
  return text.match(LETTER)?.length ?? 0;
}

/** Texto que pode ser o nome de uma pessoa: sobretudo letras, com pelo menos três. */
export function looksLikeName(text: string): boolean {
  const letters = countLetters(text);
  const digits = text.match(/\d/g)?.length ?? 0;
  return letters >= 3 && letters >= digits * 2;
}

/** Só algarismos (um número de câmara, uma contagem). */
export function isPlainNumber(text: string): boolean {
  return /^\d{1,3}$/.test(text.trim());
}
