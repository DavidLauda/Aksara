// Development diagnostic: real local Tesseract, no inference or downloads.
// Annotation rectangles isolate layout behavior here only; production code
// must derive candidate regions from pixels and never receive annotations.
import { createWorker, OEM, PSM } from 'tesseract.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import sharp from 'sharp';
import { findLightRegions, lightRegionMask, lightRegionCrop, applyLightRegionMask } from '../src/light-regions.ts';

const corpusPath = resolve('benchmarks/corpus.json');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const results = [];
await mkdir('test-results', { recursive: true });
const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath: resolve('node_modules/@tesseract.js-data/eng/4.0.0'), cacheMethod: 'none', gzip: true });
try {
  for (const id of ['idiom', 'wrapped-parcel', 'real-two-bubbles']) {
    const item = corpus.cases.find(item => item.id === id), bytes = await readFile(resolve(dirname(corpusPath), item.file));
    for (const [name, psm, rectangle] of [['auto', PSM.AUTO], ['sparse', PSM.SPARSE_TEXT], ['block', PSM.SINGLE_BLOCK], ['annotated-rectangle-block', PSM.SINGLE_BLOCK, item.regions[0].box]]) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const options = rectangle ? { rectangle: { left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height } } : {};
      const { data } = await worker.recognize(bytes, options, { text: true, blocks: true });
      results.push({ id, mode: name, text: data.text.trim(), confidence: data.confidence,
        blocks: data.blocks?.map(block => ({ bbox: block.bbox, paragraphs: block.paragraphs.map(paragraph => ({ bbox: paragraph.bbox, lines: paragraph.lines.map(line => ({ text: line.text.trim(), bbox: line.bbox, confidence: line.confidence })) })) })) });
      console.log(`${id} ${name}: ${JSON.stringify(data.text.trim())}`);
    }
    const { data: grid, info } = await sharp(bytes).resize({ width: Math.min(1024, item.width), height: Math.min(1024, item.height), fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const map = findLightRegions(new Uint8ClampedArray(grid), info.width, info.height, item.width, item.height);
    for (const region of map.regions.slice(0, 4)) {
      const mask = lightRegionMask(map, region), crop = lightRegionCrop(map, mask);
      const raw = new Uint8ClampedArray(await sharp(bytes).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).ensureAlpha().raw().toBuffer());
      applyLightRegionMask(raw, crop, map, mask);
      const png = await sharp(raw, { raw: { width: crop.width, height: crop.height, channels: 4 } }).png().toBuffer();
      await writeFile(`test-results/probe-${id}-${region.id}.png`, png);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
      results.push({ id, mode: 'pixel-mask-block', region, crop, text: data.text.trim(), confidence: data.confidence, lines: data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({ text: line.text.trim(), bbox: line.bbox })))) });
      console.log(`${id} pixel-mask-block ${region.id}: ${JSON.stringify(data.text.trim())}`);
    }
  }
} finally { await worker.terminate(); }
await mkdir('test-results', { recursive: true });
await writeFile('test-results/ocr-layout-probe.json', JSON.stringify({ note: 'Node local WASM diagnostic, not a browser latency measurement. Rectangles come from annotations for diagnosis only.', results }, null, 2) + '\n');
