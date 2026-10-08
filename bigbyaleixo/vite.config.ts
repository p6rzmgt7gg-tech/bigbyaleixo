import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const tesseract = JSON.parse(readFileSync(new URL('./node_modules/tesseract.js/package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    // No browser usa-se o bundle ESM do Tesseract.js; nos testes (Node) usa-se a entrada normal do pacote.
    alias: (mode === 'test' ? {} : { 'tesseract.js': 'tesseract.js/dist/tesseract.esm.min.js' }) as Record<string, string>,
  },
  define: {
    // Os ficheiros do OCR são servidos de /ocr/<versão>/ (ver scripts/copy-ocr-assets.mjs).
    __OCR_ASSETS_VERSION__: JSON.stringify(tesseract.version),
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
}));
