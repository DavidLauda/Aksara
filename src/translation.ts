import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';
import { MODEL, modelFetch, assertModelReady, verifyModel } from './model-cache';
import { PAIRS, type Pair, type Progress } from './protocol';
import { checkGpu } from './gpu';
import { planTranslation, TRANSLATION_LIMITS, type ImageTranslation, type TranslationSegment } from './translation-result';
import type { OcrResult } from './ocr-result';

let translator: TranslationPipeline | null = null;
async function loadTranslator(baseUrl: string, progress: (event: Progress) => void) {
  const status = await assertModelReady();
  let cold = false;
  if (!translator) {
    cold = true;
    progress({ stage: 'model_prepare', fraction: null });
    await verifyModel(progress);
    await checkGpu();
    env.allowLocalModels = false;
    env.allowRemoteModels = true; // URL discovery only: modelFetch is strictly cache-only.
    // v4 pipeline file discovery does not forward revision on its first config lookup.
    // Fix the entire model URL template to the approved revision, including discovery.
    env.remotePathTemplate = `{model}/resolve/${MODEL.revision}/`;
    env.useBrowserCache = false;
    env.useWasmCache = false; // No blob-backed JS factories: all executable code is packaged.
    env.fetch = modelFetch;
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.proxy = false;
    env.backends.onnx.wasm!.wasmPaths = {
      // Keep ORT's JS factory embedded in the bundle. An mjs override forces a
      // dynamic import, which Chrome does not support inside service workers.
      wasm: `${baseUrl}vendor/ort/ort-wasm-simd-threaded.asyncify.wasm`,
    };
    translator = await pipeline('translation', MODEL.modelId, {
      revision: MODEL.revision, device: 'webgpu', dtype: MODEL.dtype as 'q4f16' | 'q8',
      session_options: { enableCpuMemArena: false, enableMemPattern: false, graphOptimizationLevel: 'disabled' },
    });
  }
  return { cold, cache: { cache: status.cache, totalBytes: status.totalBytes, downloadedBytes: 0, revision: MODEL.revision } };
}

export async function translate(text: string, baseUrl: string, progress: (event: Progress) => void, pair: Pair = 'en-id') {
  if (!text.trim() || text.length > 500) throw new Error('INVALID_INPUT: Samples accept up to 500 characters.');
  const started = performance.now();
  const { cold, cache } = await loadTranslator(baseUrl, progress);
  const loadedAt = performance.now();
  progress({ stage: 'translate', fraction: null });
  const languages = PAIRS[pair];
  const result = await translator!(text, { src_lang: languages.source, tgt_lang: languages.target, max_new_tokens: 48, num_beams: 1 });
  if (!result[0]?.translation_text.trim()) throw new Error('EMPTY_TRANSLATION: The selected model/backend returned no translated text.');
  return { sourceText: text, translatedText: result[0].translation_text, sourceLanguage: languages.source, targetLanguage: languages.target, dtype: MODEL.dtype, model: MODEL.modelId, cold, cache, timing: { loadMs: Math.round(loadedAt - started), inferenceMs: Math.round(performance.now() - loadedAt) } };
}

export async function translateImage(ocr: OcrResult, baseUrl: string, progress: (event: Progress) => void): Promise<ImageTranslation> {
  const started = performance.now();
  const plan = planTranslation(ocr);
  const sameLanguage = ocr.sourceLanguage === ocr.targetLanguage;
  if (!plan.segments.length) throw new Error('TRANSLATION_LIMIT');
  const { cold } = sameLanguage ? { cold: false } : await loadTranslator(baseUrl, progress);
  const segments: TranslationSegment[] = [];
  let skippedSegments = plan.skippedSegments;
  let completed = 0;
  const total = plan.segments.reduce((count, segment) => count + segment.chunks.length, 0);
  for (const segment of plan.segments) {
    const translated: string[] = [];
    for (const chunk of segment.chunks) {
      progress({ stage: 'translate', fraction: completed / total });
      if (sameLanguage) translated.push(chunk);
      else {
        // Reject oversized token sequences rather than silently truncating OCR.
        const tokens = translator!.tokenizer(chunk);
        if (tokens.input_ids.dims.at(-1)! > TRANSLATION_LIMITS.inputTokens) break;
        const output = await translator!(chunk, { src_lang: ocr.sourceLanguage, tgt_lang: ocr.targetLanguage, max_new_tokens: TRANSLATION_LIMITS.outputTokens, num_beams: 1 });
        const text = output[0]?.translation_text.trim();
        if (!text) throw new Error('EMPTY_TRANSLATION');
        // Very long outputs near the generation ceiling are not presented as complete.
        if (translator!.tokenizer(text).input_ids.dims.at(-1)! >= TRANSLATION_LIMITS.outputTokens - 4) break;
        translated.push(text);
      }
      completed++;
    }
    if (translated.length !== segment.chunks.length) { skippedSegments++; continue; }
    const { chunks, ...source } = segment;
    segments.push({ ...source, translatedText: sameLanguage ? segment.sourceText : translated.join(' ') });
  }
  if (!segments.length) throw new Error('TRANSLATION_LIMIT');
  progress({ stage: 'translate', fraction: 1 });
  return { sourceLanguage: ocr.sourceLanguage, targetLanguage: ocr.targetLanguage, text: segments.map(segment => segment.translatedText).join('\n'), segments, partial: plan.partial || skippedSegments > 0, skippedSegments, sameLanguage, cold, model: sameLanguage ? null : MODEL.modelId, elapsedMs: Math.round(performance.now() - started) };
}
export async function unload() {
  await translator?.dispose(); translator = null;
  return { released: true };
}
