import { sha256 } from '@noble/hashes/sha2.js';
import manifest from './model-manifest.json';
import type { Progress } from './protocol';

export const MODEL = manifest;
const prefix = `https://huggingface.co/${MODEL.modelId}/resolve/${MODEL.revision}/`;
export const MODEL_CACHE = `aksara-nllb-${MODEL.revision}-${MODEL.dtype}`;
const totalBytes = MODEL.files.reduce((sum, f) => sum + f.bytes, 0);
const urlFor = (path: string) => prefix + path;
const PART_SIZE = 16 * 1024 * 1024;
type ModelFile = (typeof MODEL.files)[number];
function partKeysFor(url: string, bytes: number) {
  return Array.from({ length: Math.ceil(bytes / PART_SIZE) }, (_, index) => `${url}?aksara-part=${index * PART_SIZE}`);
}
async function isCached(cache: Cache, file: ModelFile) {
  const url = urlFor(file.path);
  const response = await cache.match(url);
  if (response?.headers.get('x-aksara-sha256') !== file.sha256) return false;
  if (response.headers.get('x-aksara-virtual') !== '1') return response.headers.get('content-length') === String(file.bytes);
  const keys = partKeysFor(url, file.bytes);
  for (let index = 0; index < keys.length; index++) {
    const part = await cache.match(keys[index]);
    if (part?.headers.get('content-length') !== String(Math.min(PART_SIZE, file.bytes - index * PART_SIZE))) return false;
  }
  return true;
}
function partStream(cache: Cache, keys: string[]) {
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (index < keys.length || reader) {
          reader ??= (await cache.match(keys[index++]))!.body!.getReader();
          const { done, value } = await reader.read();
          if (done) { reader = undefined; continue; }
          controller.enqueue(value); return;
        }
        controller.close();
      } catch (error) { controller.error(error); }
    },
    async cancel() { await reader?.cancel(); },
  });
}

export async function prepareModel(progress: (event: Progress) => void) {
  const cache = await caches.open(MODEL_CACHE);
  const estimate = await navigator.storage.estimate();
  let missingBytes = 0;
  let networkBytes = 0;
  for (const file of MODEL.files) {
    if (!(await isCached(cache, file))) missingBytes += file.bytes;
  }
  if (estimate.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < missingBytes * 2.2) throw new Error('INSUFFICIENT_STORAGE: Free space for the model and temporary files, then retry.');
  let finishedBytes = 0;
  for (const file of MODEL.files) {
    const url = urlFor(file.path);
    if (await isCached(cache, file)) { finishedBytes += file.bytes; continue; }
    const partKeys: string[] = [];
    let response: Response;
    if (file.bytes > 32 * 1024 * 1024) {
      const partSize = PART_SIZE;
      for (let start = 0; start < file.bytes; start += partSize) {
        const end = Math.min(start + partSize, file.bytes) - 1;
        const key = `${url}?aksara-part=${start}`;
        partKeys.push(key);
        let part = await cache.match(key);
        if (part?.headers.get('content-length') !== String(end - start + 1)) {
          let lastError: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const remote = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (remote.status !== 206 || remote.headers.get('content-range') !== `bytes ${start}-${end}/${file.bytes}`) { await remote.body?.cancel(); throw new Error('The model host did not honor the requested byte range.'); }
              // A range is bounded at 16 MiB; never buffer the whole model here.
              const reader = remote.body!.getReader();
              const bytes = new Uint8Array(end - start + 1);
              let count = 0;
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                networkBytes += value.length;
                if (count + value.length > bytes.length) { await reader.cancel(); throw new Error('Model range exceeded its declared size.'); }
                bytes.set(value, count); count += value.length;
              }
              if (count !== bytes.length) throw new Error('Model range was interrupted.');
              await cache.put(key, new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
              lastError = null; break;
            } catch (error) { lastError = error; }
          }
          if (lastError) throw new Error(`MODEL_DOWNLOAD_FAILED: ${file.path} at byte ${start}. ${String(lastError)}`);
        }
        progress({ stage: 'model_download', fraction: (finishedBytes + end + 1) / totalBytes, file: file.path, loadedBytes: finishedBytes + end + 1, totalBytes });
      }
      response = new Response(partStream(cache, partKeys));
    } else response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error(`MODEL_DOWNLOAD_FAILED: ${file.path} (${response.status})`);
    const hash = sha256.create();
    let received = 0;
    let integrityError = '';
    let lastProgress = 0;
    const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.length;
        if (!partKeys.length) networkBytes += chunk.length;
        if (received > file.bytes) { integrityError = 'exceeded its pinned size'; throw new Error(integrityError); }
        hash.update(chunk); controller.enqueue(chunk);
        if (performance.now() - lastProgress > 250) {
          progress({ stage: partKeys.length ? 'model_verify' : 'model_download', fraction: (finishedBytes + received) / totalBytes, file: file.path, loadedBytes: finishedBytes + received, totalBytes });
          lastProgress = performance.now();
        }
      },
      flush() {
        const digest = Array.from(hash.digest(), value => value.toString(16).padStart(2, '0')).join('');
        if (received !== file.bytes || digest !== file.sha256) { integrityError = 'did not match its pinned checksum'; throw new Error(integrityError); }
      },
    }));
    // Cache.put consumes the stream without collecting a second model-sized ArrayBuffer.
    // If checksum validation fails, the stream errors and no complete entry is committed.
    try {
      if (partKeys.length) {
        // Keep large weights as chunks. Re-reading Cache entries while writing a
        // large concatenated entry failed in Chromium; a verified virtual file
        // avoids that cache transaction and a second on-disk model copy.
        const reader = stream.getReader();
        while (!(await reader.read()).done) { /* consume for streaming integrity validation */ }
        await cache.put(url, new Response('', { headers: { 'x-aksara-sha256': file.sha256, 'x-aksara-virtual': '1' } }));
      } else await cache.put(url, new Response(stream, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes), 'x-aksara-sha256': file.sha256 } }));
    } catch (error) {
      if (integrityError) for (const key of partKeys) await cache.delete(key);
      throw new Error(`${integrityError ? 'MODEL_INTEGRITY_FAILED' : 'MODEL_DOWNLOAD_FAILED'}: ${file.path}, received ${received}/${file.bytes} bytes. ${integrityError || String(error)}`);
    }
    finishedBytes += file.bytes;
    progress({ stage: 'model_download', fraction: finishedBytes / totalBytes, loadedBytes: finishedBytes, totalBytes });
  }
  return { cache: MODEL_CACHE, totalBytes, downloadedBytes: networkBytes, revision: MODEL.revision };
}

export async function modelFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  // Only the pinned model can be read. Transformers cannot silently fetch new graphs or code.
  const file = MODEL.files.find(file => url === urlFor(file.path));
  if (!file) return new Response('Asset is not in the pinned model manifest.', { status: 404 });
  const response = await (await caches.open(MODEL_CACHE)).match(url);
  if (response?.headers.get('x-aksara-sha256') !== file.sha256) throw new Error(`MODEL_NOT_READY: ${file.path}`);
  if (response.headers.get('x-aksara-virtual') === '1') {
    const keys = partKeysFor(url, file.bytes);
    return new Response(partStream(await caches.open(MODEL_CACHE), keys), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes) } });
  }
  return response;
}
