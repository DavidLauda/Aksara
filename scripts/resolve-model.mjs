import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const modelId = 'Xenova/nllb-200-distilled-600M';
const revision = '261c31d1a5732c67cdd16d80e8d6088507c7ccea';
const dtype = process.argv[2] || 'q8';
if (!['q4f16', 'q8'].includes(dtype)) throw new Error('Supported feasibility variants: q4f16, q8');
const suffix = dtype === 'q8' ? 'quantized' : dtype;
const paths = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', `onnx/encoder_model_${suffix}.onnx`, `onnx/decoder_model_merged_${suffix}.onnx`];
const response = await fetch(`https://huggingface.co/api/models/${modelId}/revision/${revision}?blobs=true`);
if (!response.ok) throw new Error(`Model metadata: ${response.status}`);
const metadata = await response.json();
const files = [];
for (const path of paths) {
  const file = metadata.siblings.find(f => f.rfilename === path);
  if (!file) throw new Error(`Missing model asset: ${path}`);
  let sha256 = file.lfs?.sha256;
  if (!sha256) {
    const data = await fetch(`https://huggingface.co/${modelId}/resolve/${revision}/${path}`);
    if (!data.ok) throw new Error(`Asset metadata: ${data.status}`);
    sha256 = createHash('sha256').update(new Uint8Array(await data.arrayBuffer())).digest('hex');
  }
  files.push({ path, bytes: file.size, sha256 });
}
await mkdir(new URL('../src/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/model-manifest.json', import.meta.url), JSON.stringify({ modelId, revision, dtype, license: 'CC-BY-NC-4.0', files }, null, 2) + '\n');
console.log(`Pinned ${files.length} assets (${files.reduce((n,f) => n + f.bytes, 0)} bytes).`);
