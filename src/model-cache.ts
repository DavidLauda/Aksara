import manifest from './model-manifest.json';
import { createModelCache } from './model-cache-core';

export const MODEL = manifest;
export const MODEL_CACHE = `aksara-nllb-${MODEL.revision}-${MODEL.dtype}`;
export type { ModelStatus } from './model-cache-core';
export const { getModelStatus, assertModelReady, verifyModel, clearModel, prepareModel, modelFetch } = createModelCache(MODEL);
