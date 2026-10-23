import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';
import { MODEL, modelFetch, prepareModel } from './model-cache';
import { PAIRS, type Pair, type Progress } from './protocol';

let translator: TranslationPipeline | null = null;
export async function translate(text: string, baseUrl: string, progress: (event: Progress) => void, pair: Pair = 'en-id') {
  if (!text.trim() || text.length > 500) throw new Error('INVALID_INPUT: Phase 1 accepts up to 500 characters.');
  const started = performance.now();
  const cache = await prepareModel(progress);
  const cachedAt = performance.now();
  let cold = false;
  if (!translator) {
    cold = true;
    progress({ stage: 'model_prepare', fraction: null });
    env.allowLocalModels = false;
    env.allowRemoteModels = true; // modelFetch below is cache-only; preparation owns network access.
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
  const loadedAt = performance.now();
  progress({ stage: 'translate', fraction: null });
  const languages = PAIRS[pair];
  const result = await translator(text, { src_lang: languages.source, tgt_lang: languages.target, max_new_tokens: 48, num_beams: 1 });
  if (!result[0]?.translation_text.trim()) throw new Error('EMPTY_TRANSLATION: The selected model/backend returned no translated text.');
  return { sourceText: text, translatedText: result[0].translation_text, sourceLanguage: languages.source, targetLanguage: languages.target, dtype: MODEL.dtype, model: MODEL.modelId, cold, cache, timing: { cacheMs: Math.round(cachedAt - started), loadMs: Math.round(loadedAt - cachedAt), inferenceMs: Math.round(performance.now() - loadedAt) } };
}
export async function unload() {
  await translator?.dispose(); translator = null;
  return { released: true };
}
