import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';

const files = [];
async function copy(source, target) {
  const destination = resolve('dist', target);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  files.push({ path: target, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await copy('node_modules/tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js');
for (const file of await readdir('node_modules/tesseract.js-core')) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(file)) await copy(`node_modules/tesseract.js-core/${file}`, `vendor/tesseract/${file}`);
}
for (const language of ['eng', 'ind']) await copy(`node_modules/@tesseract.js-data/${language}/4.0.0/${language}.traineddata.gz`, `vendor/tesseract/lang/${language}.traineddata.gz`);
for (const extension of ['mjs', 'wasm']) await copy(`node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.${extension}`, `vendor/ort/ort-wasm-simd-threaded.asyncify.${extension}`);
await copy('node_modules/tesseract.js/LICENSE.md', 'licenses/tesseract.txt');
await copy('node_modules/tesseract.js-core/LICENSE', 'licenses/tesseract-core.txt');
await copy('node_modules/@huggingface/transformers/LICENSE', 'licenses/transformers.txt');
await copy('node_modules/onnxruntime-web/README.md', 'licenses/onnxruntime-readme.md');
await copy('third_party/onnxruntime-LICENSE.txt', 'licenses/onnxruntime.txt');
await copy('third_party/onnxruntime-NOTICES.txt', 'licenses/onnxruntime-notices.txt');
await copy('node_modules/@noble/hashes/LICENSE', 'licenses/noble-hashes.txt');
await writeFile('dist/asset-manifest.json', JSON.stringify({ files }, null, 2) + '\n');
console.log(`Packaged ${files.length} local runtime/language assets.`);
