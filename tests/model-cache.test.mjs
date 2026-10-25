import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createModelCache } from '../src/model-cache-core.ts';

class MemoryCache {
  entries = new Map();
  async match(key) {
    const entry = this.entries.get(key);
    return entry ? new Response(entry.bytes, { headers: entry.headers, status: entry.status }) : undefined;
  }
  async put(key, response) {
    // Match Cache.put's important guarantee: a failing body is never committed.
    const bytes = await response.arrayBuffer();
    this.entries.set(key, { bytes, headers: new Headers(response.headers), status: response.status });
  }
  async delete(key) { return this.entries.delete(key); }
}
class MemoryStorage {
  caches = new Map();
  opens = 0;
  async has(key) { return this.caches.has(key); }
  async open(key) {
    this.opens++;
    if (!this.caches.has(key)) this.caches.set(key, new MemoryCache());
    return this.caches.get(key);
  }
  async delete(key) { return this.caches.delete(key); }
}
function fixture(overrides = {}) {
  const bodies = new Map([
    ['config.json', new TextEncoder().encode('{x}')],
    ['onnx/weights.onnx', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
    ['tokenizer.json', new TextEncoder().encode('hello')],
  ]);
  const model = { modelId: 'tests/model', revision: 'pinned-test-revision', dtype: 'q8', files: [...bodies].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  const prefix = `https://huggingface.co/${model.modelId}/resolve/${model.revision}/`;
  const storage = new MemoryStorage();
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const bytes = bodies.get(url.slice(prefix.length));
    assert.ok(bytes, 'Only a pinned asset can be downloaded');
    const range = new Headers(options.headers).get('range');
    if (!range) return new Response(bytes);
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
  };
  const api = createModelCache(model, { storage: () => storage, fetch, estimate: async () => ({ quota: 100_000, usage: 0 }), partSize: 4, largeFileThreshold: 8, ...overrides });
  const cacheName = `aksara-nllb-${model.revision}-${model.dtype}`;
  return { api, bodies, model, storage, calls, prefix, cacheName, cache: () => storage.open(cacheName) };
}

test('status, cache-only inference and missing-model checks never fetch or create a cache', async () => {
  const f = fixture();
  const status = await f.api.getModelStatus();
  assert.equal(status.ready, false); assert.equal(status.cachedBytes, 0); assert.equal(status.totalBytes, 21); assert.equal(status.missingBytes, 21);
  await assert.rejects(f.api.assertModelReady(), /MODEL_NOT_READY/);
  await assert.rejects(f.api.modelFetch(`${f.prefix}config.json`), /MODEL_NOT_READY/);
  assert.equal((await f.api.modelFetch(`${f.prefix}remote-code.js`)).status, 404);
  assert.equal(f.calls.length, 0); assert.equal(f.storage.opens, 0);
});
test('download commits verified small assets and virtual range chunks, with pinned-only offline reads', async () => {
  const f = fixture(); const progress = [];
  const result = await f.api.prepareModel(event => progress.push(event));
  assert.equal(result.downloadedBytes, 21); assert.equal(result.totalBytes, 21);
  assert.deepEqual(f.calls.map(call => new Headers(call.options.headers).get('range')), [null, 'bytes=0-3', 'bytes=4-7', 'bytes=8-11', 'bytes=12-12', null]);
  assert.ok(f.calls.every(call => call.options.credentials === 'omit' && call.options.referrerPolicy === 'no-referrer' && call.options.cache === 'no-store'));
  assert.ok(progress.some(event => event.stage === 'model_verify'));
  assert.equal((await f.api.assertModelReady()).cachedBytes, 21);
  for (const [path, bytes] of f.bodies) assert.deepEqual(new Uint8Array(await (await f.api.modelFetch(`${f.prefix}${path}`)).arrayBuffer()), bytes);
  const cache = await f.cache();
  const marker = await cache.match(`${f.prefix}onnx/weights.onnx`);
  assert.equal(marker.headers.get('x-aksara-virtual'), '1'); assert.equal((await marker.arrayBuffer()).byteLength, 0);
  assert.equal((await f.api.verifyModel()).ready, true);
  assert.equal((await f.api.prepareModel()).downloadedBytes, 0);
  assert.equal(f.calls.length, 6, 'Verification and cached preparation never fetch');
});
test('cancel preserves completed ranges and retry fetches only the missing ranges', async () => {
  const f = fixture(); const controller = new AbortController();
  await assert.rejects(f.api.prepareModel(event => {
    if (event.stage === 'model_download' && event.file === 'onnx/weights.onnx' && event.loadedBytes === 7) controller.abort();
  }, controller.signal), /CANCELLED/);
  const partial = await f.api.getModelStatus();
  assert.equal(partial.ready, false); assert.equal(partial.cachedBytes, 7); assert.equal(partial.missingBytes, 14);
  assert.equal((await f.cache()).entries.has(`${f.prefix}onnx/weights.onnx`), false);
  assert.equal((await f.api.prepareModel()).downloadedBytes, 14);
  assert.equal((await f.api.assertModelReady()).ready, true);
  assert.equal(f.calls.filter(call => new Headers(call.options.headers).get('range') === 'bytes=0-3').length, 1);
});
test('abort interrupts an in-flight fetch without automatic retry', async () => {
  const controller = new AbortController(); let calls = 0;
  const f = fixture({ fetch: async (_url, options) => {
    calls++;
    queueMicrotask(() => controller.abort());
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  await assert.rejects(f.api.prepareModel(undefined, controller.signal), /CANCELLED/);
  assert.equal(calls, 1); assert.equal((await f.api.getModelStatus()).cachedBytes, 0);
});
test('a stalled request is bounded and retried only once', async () => {
  let calls = 0;
  const f = fixture({ requestTimeoutMs: 5, fetch: async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true }));
  } });
  await assert.rejects(f.api.prepareModel(), /MODEL_DOWNLOAD_FAILED.*timed out/);
  assert.equal(calls, 2);
});
test('the request deadline also covers a stalled body after response headers arrive', async () => {
  let calls = 0;
  const f = fixture({ requestTimeoutMs: 5, fetch: async (_url, options) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      options.signal.addEventListener('abort', () => controller.error(new DOMException('Timeout', 'AbortError')), { once: true });
    } }));
  } });
  await assert.rejects(f.api.prepareModel(), /MODEL_DOWNLOAD_FAILED.*timed out/);
  assert.equal(calls, 2); assert.equal((await f.api.getModelStatus()).cachedBytes, 0);
});
test('full SHA verification detects same-size corruption, removes only that file and allows repair', async () => {
  const f = fixture(); await f.api.prepareModel();
  const cache = await f.cache();
  await cache.put(`${f.prefix}onnx/weights.onnx?aksara-part=4`, new Response(new Uint8Array([4, 0, 6, 7]), { headers: { 'content-length': '4' } }));
  assert.equal((await f.api.getModelStatus()).ready, true, 'Fast status checks structure, not full file hashes');
  await assert.rejects(f.api.verifyModel(), /MODEL_INTEGRITY_FAILED/);
  assert.equal((await f.api.getModelStatus()).cachedBytes, 8);
  assert.equal([...cache.entries.keys()].some(key => key.includes('weights.onnx')), false);
  assert.equal((await f.api.prepareModel()).downloadedBytes, 13);
  assert.equal((await f.api.verifyModel()).ready, true);
});
test('a missing range invalidates a ready marker and resumes without redownloading other chunks', async () => {
  const f = fixture(); await f.api.prepareModel();
  await (await f.cache()).delete(`${f.prefix}onnx/weights.onnx?aksara-part=4`);
  assert.equal((await f.api.getModelStatus()).ready, false);
  assert.equal((await f.api.getModelStatus()).missingBytes, 4);
  await assert.rejects(f.api.modelFetch(`${f.prefix}onnx/weights.onnx`), /MODEL_NOT_READY/);
  assert.equal((await f.api.prepareModel()).downloadedBytes, 4);
  assert.equal(f.calls.length, 7);
});
test('short or oversized cached bodies cannot pass full verification even with forged length metadata', async () => {
  for (const bytes of [new Uint8Array([1]), new Uint8Array([0, 1, 2, 3, 4])]) {
    const f = fixture(); await f.api.prepareModel();
    await (await f.cache()).put(`${f.prefix}onnx/weights.onnx?aksara-part=0`, new Response(bytes, { headers: { 'content-length': '4' } }));
    await assert.rejects(f.api.verifyModel(), /MODEL_INTEGRITY_FAILED/);
    assert.equal((await f.api.getModelStatus()).ready, false);
  }
});
test('wrong ranges, oversized responses and checksum mismatches never create a ready entry', async () => {
  const wrongChecksum = fixture({ fetch: async () => new Response('bad') });
  await assert.rejects(wrongChecksum.api.prepareModel(), /MODEL_INTEGRITY_FAILED/);
  assert.equal((await wrongChecksum.cache()).entries.size, 0);
  const oversized = fixture({ fetch: async () => new Response('too large') });
  await assert.rejects(oversized.api.prepareModel(), /MODEL_INTEGRITY_FAILED/);
  assert.equal((await oversized.cache()).entries.size, 0);
  const f = fixture();
  // Fill only config first, then point the next preparation at a server ignoring ranges.
  const controller = new AbortController();
  await assert.rejects(f.api.prepareModel(event => { if (event.stage === 'model_download' && event.loadedBytes === 3) controller.abort(); }, controller.signal), /CANCELLED/);
  let calls = 0;
  const api = createModelCache(f.model, { storage: () => f.storage, fetch: async () => { calls++; return new Response(new Uint8Array(13)); }, estimate: async () => ({}), partSize: 4, largeFileThreshold: 8 });
  await assert.rejects(api.prepareModel(), /MODEL_DOWNLOAD_FAILED.*byte range/);
  assert.equal(calls, 2); assert.equal((await api.getModelStatus()).cachedBytes, 3);
});
test('insufficient disk estimate blocks before fetch, and actual quota failure has an actionable error', async () => {
  const f = fixture({ estimate: async () => ({ quota: 10, usage: 9 }) });
  await assert.rejects(f.api.prepareModel(), /INSUFFICIENT_STORAGE/);
  assert.equal(f.calls.length, 0); assert.equal(f.storage.opens, 0);
  const g = fixture(); const cache = await g.cache();
  cache.put = async () => { throw new DOMException('Disk full', 'QuotaExceededError'); };
  await assert.rejects(g.api.prepareModel(), /INSUFFICIENT_STORAGE/);
  assert.equal(g.calls.length, 1);
});
test('cancelled verification preserves files and clearing deletes only the current model cache', async () => {
  const f = fixture(); await f.api.prepareModel();
  const controller = new AbortController();
  await assert.rejects(f.api.verifyModel(() => controller.abort(), controller.signal), /CANCELLED/);
  assert.equal((await f.api.getModelStatus()).ready, true);
  const unrelated = await f.storage.open('unrelated-extension-data');
  await unrelated.put('https://example.net/data', new Response('keep'));
  const cleared = await f.api.clearModel();
  assert.equal(cleared.cleared, true); assert.equal(cleared.ready, false); assert.equal(cleared.cachedBytes, 0);
  assert.equal(await f.storage.has(f.cacheName), false); assert.equal(await f.storage.has('unrelated-extension-data'), true);
});
