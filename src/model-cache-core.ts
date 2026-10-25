import { sha256 } from '@noble/hashes/sha2.js';
import type { Progress } from './protocol';

type ModelFile = { path: string; bytes: number; sha256: string };
export type ModelManifest = { modelId: string; revision: string; dtype: string; files: ModelFile[] };
export type ModelStatus = {
  ready: boolean; cachedBytes: number; totalBytes: number; missingBytes: number;
  revision: string; modelId: string; dtype: string; cache: string;
};
type CacheDependencies = {
  storage?: () => CacheStorage;
  fetch?: typeof fetch;
  estimate?: () => Promise<StorageEstimate>;
  partSize?: number;
  largeFileThreshold?: number;
  requestTimeoutMs?: number;
};
const noProgress = (_event: Progress) => {};
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('CANCELLED: Model preparation was cancelled. Completed download chunks are kept for retry.');
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isQuota(error: unknown) { return error instanceof Error && error.name === 'QuotaExceededError'; }

/** The caller owns consent and the one-job lock. Only prepareModel may use the network. */
export function createModelCache(model: ModelManifest, dependencies: CacheDependencies = {}) {
  const prefix = `https://huggingface.co/${model.modelId}/resolve/${model.revision}/`;
  const cacheName = `aksara-nllb-${model.revision}-${model.dtype}`;
  const totalBytes = model.files.reduce((sum, file) => sum + file.bytes, 0);
  const partSize = dependencies.partSize ?? 16 * 1024 * 1024;
  const largeFileThreshold = dependencies.largeFileThreshold ?? 32 * 1024 * 1024;
  const timeoutMs = dependencies.requestTimeoutMs ?? 60_000;
  const storage = dependencies.storage ?? (() => caches);
  const remoteFetch = dependencies.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const estimate = dependencies.estimate ?? (() => navigator.storage.estimate());
  const urlFor = (path: string) => prefix + path;
  const partKeysFor = (file: ModelFile) => Array.from({ length: Math.ceil(file.bytes / partSize) }, (_, index) => `${urlFor(file.path)}?aksara-part=${index * partSize}`);
  const expectedPartSize = (file: ModelFile, index: number) => Math.min(partSize, file.bytes - index * partSize);

  async function fileState(cache: Cache, file: ModelFile) {
    const response = await cache.match(urlFor(file.path));
    const marked = response?.headers.get('x-aksara-sha256') === file.sha256;
    if (marked && response.headers.get('x-aksara-virtual') !== '1') {
      const ready = response.headers.get('content-length') === String(file.bytes);
      return { ready, bytes: ready ? file.bytes : 0 };
    }
    if (file.bytes <= largeFileThreshold) return { ready: false, bytes: 0 };
    let bytes = 0;
    const keys = partKeysFor(file);
    for (let index = 0; index < keys.length; index++) {
      const part = await cache.match(keys[index]);
      const size = expectedPartSize(file, index);
      if (part?.headers.get('content-length') === String(size)) bytes += size;
    }
    return { ready: marked && response?.headers.get('x-aksara-virtual') === '1' && bytes === file.bytes, bytes };
  }
  async function getModelStatus(): Promise<ModelStatus> {
    // Do not create a cache as a side effect of opening a popup.
    const exists = await storage().has(cacheName);
    let cachedBytes = 0;
    let ready = exists;
    if (exists) {
      const cache = await storage().open(cacheName);
      for (const file of model.files) {
        const state = await fileState(cache, file);
        cachedBytes += state.bytes; ready = ready && state.ready;
      }
    }
    return { ready, cachedBytes, totalBytes, missingBytes: totalBytes - cachedBytes, revision: model.revision, modelId: model.modelId, dtype: model.dtype, cache: cacheName };
  }
  async function assertModelReady() {
    const status = await getModelStatus();
    if (!status.ready) throw new Error('MODEL_NOT_READY: Open Aksara setup and download or resume the local translation model.');
    return status;
  }
  async function removeFile(cache: Cache, file: ModelFile) {
    await cache.delete(urlFor(file.path));
    for (const key of partKeysFor(file)) await cache.delete(key);
  }
  function partStream(cache: Cache, file: ModelFile, signal?: AbortSignal) {
    const keys = partKeysFor(file);
    let index = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          cancelled(signal);
          while (index < keys.length || reader) {
            if (!reader) {
              const response = await cache.match(keys[index++]);
              if (!response?.body) throw new Error('MODEL_NOT_READY: A cached model chunk is missing. Resume the model download.');
              reader = response.body.getReader();
            }
            const { done, value } = await reader.read();
            cancelled(signal);
            if (done) { reader = undefined; continue; }
            controller.enqueue(value); return;
          }
          controller.close();
        } catch (error) { await reader?.cancel().catch(() => {}); controller.error(error); }
      },
      async cancel() { await reader?.cancel(); },
    });
  }
  async function cachedResponse(cache: Cache, file: ModelFile, signal?: AbortSignal) {
    const response = await cache.match(urlFor(file.path));
    if (!response) throw new Error('MODEL_NOT_READY: A cached model file is missing.');
    return response.headers.get('x-aksara-virtual') === '1'
      ? new Response(partStream(cache, file, signal), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes) } })
      : response;
  }
  async function verifyFile(cache: Cache, file: ModelFile, progress: (event: Progress) => void, finishedBytes: number, signal?: AbortSignal, response?: Response) {
    cancelled(signal);
    const source = response ?? await cachedResponse(cache, file, signal);
    if (!source.body) throw new Error('MODEL_NOT_READY: A cached model file has no bytes.');
    const reader = source.body.getReader();
    const hash = sha256.create();
    let received = 0;
    let lastProgress = 0;
    try {
      for (;;) {
        cancelled(signal);
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > file.bytes) throw new Error('MODEL_INTEGRITY_FAILED: A cached file exceeds its pinned size.');
        hash.update(value);
        if (performance.now() - lastProgress > 250) {
          progress({ stage: 'model_verify', fraction: (finishedBytes + received) / totalBytes, file: file.path, loadedBytes: finishedBytes + received, totalBytes });
          lastProgress = performance.now();
        }
      }
      cancelled(signal);
      const digest = Array.from(hash.digest(), value => value.toString(16).padStart(2, '0')).join('');
      if (received !== file.bytes || digest !== file.sha256) throw new Error(`MODEL_INTEGRITY_FAILED: ${file.path} did not match its pinned checksum. Retry the download to replace this file.`);
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (message(error).startsWith('MODEL_INTEGRITY_FAILED')) await removeFile(cache, file);
      throw error;
    } finally { reader.releaseLock(); }
    progress({ stage: 'model_verify', fraction: (finishedBytes + file.bytes) / totalBytes, file: file.path, loadedBytes: finishedBytes + file.bytes, totalBytes });
  }
  async function verifyModel(progress: (event: Progress) => void = noProgress, signal?: AbortSignal) {
    cancelled(signal);
    await assertModelReady();
    const cache = await storage().open(cacheName);
    let finishedBytes = 0;
    for (const file of model.files) {
      await verifyFile(cache, file, progress, finishedBytes, signal);
      finishedBytes += file.bytes;
    }
    cancelled(signal);
    return getModelStatus();
  }
  async function clearModel() {
    await storage().delete(cacheName);
    return { cleared: true as const, ...await getModelStatus() };
  }
  /** Timeout spans fetch AND body consumption; abort never starts an automatic retry. */
  async function download<T>(url: string, signal: AbortSignal | undefined, headers: HeadersInit | undefined, consume: (response: Response) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      cancelled(signal);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let response: Response | undefined;
      try {
        response = await remoteFetch(url, { headers, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
        // Hugging Face resolves large pinned files through its own CDN. Accept
        // asset bytes only from that host family, then verify the pinned digest.
        if (response.url) {
          const finalUrl = new URL(response.url);
          if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password || finalUrl.port || !(finalUrl.hostname === 'huggingface.co' || finalUrl.hostname.endsWith('.huggingface.co') || finalUrl.hostname.endsWith('.hf.co'))) throw new Error('Unapproved model download host.');
        }
        const result = await consume(response);
        cancelled(signal);
        return result;
      } catch (error) {
        await response?.body?.cancel().catch(() => {});
        cancelled(signal);
        if (isQuota(error)) throw new Error('INSUFFICIENT_STORAGE: The browser could not store another model chunk. Free disk space, then resume.');
        lastError = timedOut ? new Error('The model download timed out. Check the connection and resume.') : error;
        if (message(error).startsWith('MODEL_INTEGRITY_FAILED')) throw error;
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      }
    }
    throw new Error(`MODEL_DOWNLOAD_FAILED: ${message(lastError)}`);
  }
  async function prepareModel(progress: (event: Progress) => void = noProgress, signal?: AbortSignal) {
    cancelled(signal);
    const status = await getModelStatus();
    const available = await estimate();
    // This is a disk estimate, not a promise about RAM/VRAM. Cached chunks are
    // reused; reserve room for remaining bytes plus bounded write overhead.
    if (status.missingBytes > 0 && available.quota !== undefined && available.usage !== undefined && available.quota - available.usage < status.missingBytes * 1.2 + partSize * 2) throw new Error('INSUFFICIENT_STORAGE: Free disk space for the model, then resume the download.');
    const cache = await storage().open(cacheName);
    let networkBytes = 0;
    let finishedBytes = 0;
    for (const file of model.files) {
      cancelled(signal);
      if ((await fileState(cache, file)).ready) {
        // Reusing a prior install still checks actual bytes once during setup.
        await verifyFile(cache, file, progress, finishedBytes, signal);
        finishedBytes += file.bytes; continue;
      }
      const url = urlFor(file.path);
      await cache.delete(url); // A missing chunk must invalidate any old ready marker.
      if (file.bytes > largeFileThreshold) {
        const keys = partKeysFor(file);
        for (let index = 0; index < keys.length; index++) {
          cancelled(signal);
          const start = index * partSize;
          const bytesInPart = expectedPartSize(file, index);
          const end = start + bytesInPart - 1;
          const part = await cache.match(keys[index]);
          if (part?.headers.get('content-length') !== String(bytesInPart)) {
            await download(url, signal, { Range: `bytes=${start}-${end}` }, async response => {
              if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${file.bytes}` || !response.body) throw new Error('The model host did not honor the requested byte range.');
              const reader = response.body.getReader();
              const bytes = new Uint8Array(bytesInPart);
              let received = 0;
              try {
                for (;;) {
                  cancelled(signal);
                  const { done, value } = await reader.read();
                  if (done) break;
                  networkBytes += value.length;
                  if (received + value.length > bytes.length) throw new Error('Model range exceeded its declared size.');
                  bytes.set(value, received); received += value.length;
                }
                if (received !== bytes.length) throw new Error('Model range was interrupted.');
                cancelled(signal);
                await cache.put(keys[index], new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
              } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            });
          }
          progress({ stage: 'model_download', fraction: (finishedBytes + end + 1) / totalBytes, file: file.path, loadedBytes: finishedBytes + end + 1, totalBytes });
        }
        // Verify the virtual concatenation without a model-sized buffer or a
        // second model-sized cache write. The marker is written only afterward.
        await verifyFile(cache, file, progress, finishedBytes, signal, new Response(partStream(cache, file, signal)));
        cancelled(signal);
        try {
          await cache.put(url, new Response('', { headers: { 'x-aksara-sha256': file.sha256, 'x-aksara-virtual': '1' } }));
        } catch (error) {
          if (isQuota(error)) throw new Error('INSUFFICIENT_STORAGE: The browser could not finish storing the model. Free disk space, then resume.');
          throw error;
        }
      } else {
        await download(url, signal, undefined, async response => {
          if (!response.ok || !response.body) throw new Error(`Model file download returned ${response.status}.`);
          const hash = sha256.create();
          let received = 0;
          const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              cancelled(signal);
              networkBytes += chunk.length; received += chunk.length;
              if (received > file.bytes) throw new Error('MODEL_INTEGRITY_FAILED: Model file exceeded its pinned size.');
              hash.update(chunk); controller.enqueue(chunk);
            },
            flush() {
              cancelled(signal);
              const digest = Array.from(hash.digest(), value => value.toString(16).padStart(2, '0')).join('');
              if (received !== file.bytes || digest !== file.sha256) throw new Error(`MODEL_INTEGRITY_FAILED: ${file.path} did not match its pinned checksum. Retry the download.`);
            },
          }));
          try {
            await cache.put(url, new Response(stream, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes), 'x-aksara-sha256': file.sha256 } }));
          } catch (error) { await cache.delete(url); throw error; }
        });
      }
      finishedBytes += file.bytes;
      progress({ stage: 'model_download', fraction: finishedBytes / totalBytes, loadedBytes: finishedBytes, totalBytes });
    }
    cancelled(signal);
    return { cache: cacheName, totalBytes, downloadedBytes: networkBytes, revision: model.revision };
  }
  async function modelFetch(input: string | URL | Request): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const file = model.files.find(file => url === urlFor(file.path));
    if (!file) return new Response('Asset is not in the pinned model manifest.', { status: 404 });
    if (!await storage().has(cacheName)) throw new Error('MODEL_NOT_READY: Download the local translation model in setup.');
    const cache = await storage().open(cacheName);
    if (!(await fileState(cache, file)).ready) throw new Error(`MODEL_NOT_READY: ${file.path}. Resume the model download in setup.`);
    return cachedResponse(cache, file);
  }
  return { getModelStatus, assertModelReady, verifyModel, clearModel, prepareModel, modelFetch };
}
