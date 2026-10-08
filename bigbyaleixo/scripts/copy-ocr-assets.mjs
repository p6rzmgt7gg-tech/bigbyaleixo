// Copia o motor de OCR (worker + WebAssembly + modelo de português) de node_modules para
// public/ocr/<versão>/, para que a aplicação os sirva do próprio domínio. Assim o OCR
// funciona sem depender de nenhum CDN e nada é pedido a terceiros.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const { version } = JSON.parse(readFileSync(join(modules, 'tesseract.js', 'package.json'), 'utf8'));
const target = join(root, 'public', 'ocr');
const destination = join(target, version);

// Só a variante LSTM do motor é usada; o Tesseract.js escolhe o ficheiro conforme o browser suporta SIMD.
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'lang/por.traineddata.gz'],
];

if (existsSync(target)) {
  for (const entry of readdirSync(target)) {
    if (entry !== version) rmSync(join(target, entry), { recursive: true, force: true });
  }
}
let copied = 0;
for (const [from, to] of files) {
  const source = join(modules, from);
  const output = join(destination, to);
  if (!existsSync(source)) {
    console.error(`[ocr] Ficheiro em falta: ${from}. Corra "npm install" primeiro.`);
    process.exit(1);
  }
  if (existsSync(output)) continue;
  mkdirSync(dirname(output), { recursive: true });
  cpSync(source, output);
  copied++;
}
console.log(`[ocr] public/ocr/${version} pronto (${copied} ficheiro(s) copiado(s)).`);
