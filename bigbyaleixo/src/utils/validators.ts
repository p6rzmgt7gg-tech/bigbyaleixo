/** Limite de tamanho do ficheiro carregado. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];

/** Fotografias de iPhone. Só alguns browsers (Safari) as conseguem abrir. */
export function isHeic(file: { name: string; type: string }): boolean {
  return /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
}

export type FileProblem = 'unsupported_format' | 'file_too_large';

/** Verifica formato e tamanho antes de qualquer processamento. */
export function checkImageFile(file: { name: string; type: string; size: number }): FileProblem | null {
  const name = file.name.toLowerCase();
  const byExtension = ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
  // Alguns sistemas não preenchem o tipo MIME; nesse caso vale a extensão.
  const byType = file.type === '' ? byExtension : ACCEPTED_TYPES.includes(file.type);
  if (!byType || !byExtension) return 'unsupported_format';
  if (file.size > MAX_FILE_BYTES) return 'file_too_large';
  return null;
}
