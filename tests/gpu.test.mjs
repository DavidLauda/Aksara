import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGpu, GPU_PROBE_TIMEOUT_MS } from '../src/gpu.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function installNavigator(t, gpu) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu, storage: { estimate: async () => ({ quota: 100, usage: 1 }) }, userAgent: 'lifecycle-test' } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; });
}
function installGpuConstants(t) {
  for (const [name, value] of [['GPUBufferUsage', { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 }], ['GPUMapMode', { READ: 1 }]]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('pre-aborted GPU check never requests an adapter', async t => {
  let requested = false;
  installNavigator(t, { requestAdapter: async () => { requested = true; return null; } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(checkGpu(controller.signal), /CANCELLED/);
  assert.equal(requested, false);
});
test('abort settles immediately while requestAdapter is stalled, and late adapter cannot request a device', async t => {
  const adapterRequest = deferred(); let deviceRequested = false;
  installNavigator(t, { requestAdapter: () => adapterRequest.promise });
  const controller = new AbortController();
  const checking = checkGpu(controller.signal);
  controller.abort();
  await assert.rejects(checking, /CANCELLED/);
  adapterRequest.resolve({ requestDevice: async () => { deviceRequested = true; } });
  await nextTurn();
  assert.equal(deviceRequested, false);
});
test('probe deadline rejects a stalled adapter without waiting for the GPU driver', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  installNavigator(t, { requestAdapter: () => new Promise(() => {}) });
  const checking = checkGpu();
  const rejected = assert.rejects(checking, /WEBGPU_UNAVAILABLE.*timed out/);
  t.mock.timers.tick(GPU_PROBE_TIMEOUT_MS);
  await rejected;
});
test('device arriving after abort is destroyed once and never used', async t => {
  const requested = deferred(), acquired = deferred(); let destroyed = 0, used = false;
  const device = { destroy: () => { destroyed++; }, createBuffer: () => { used = true; } };
  installNavigator(t, { requestAdapter: async () => ({ requestDevice: () => { requested.resolve(); return acquired.promise; } }) });
  const controller = new AbortController();
  const checking = checkGpu(controller.signal);
  await requested.promise;
  controller.abort();
  await assert.rejects(checking, /CANCELLED/);
  acquired.resolve(device);
  await nextTurn();
  assert.equal(destroyed, 1); assert.equal(used, false);
});
test('late device rejection after timeout is handled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requested = deferred(), acquired = deferred();
  installNavigator(t, { requestAdapter: async () => ({ requestDevice: () => { requested.resolve(); return acquired.promise; } }) });
  const checking = checkGpu();
  await requested.promise;
  const rejected = assert.rejects(checking, /WEBGPU_UNAVAILABLE.*timed out/);
  t.mock.timers.tick(GPU_PROBE_TIMEOUT_MS);
  await rejected;
  acquired.reject(new Error('Driver completed with a late failure'));
  // node:test itself fails if this becomes an unhandled rejection.
  await nextTurn();
});
test('abort during mapping destroys the device immediately and never reads a late mapped buffer', async t => {
  installGpuConstants(t);
  const mapping = deferred(), mapStarted = deferred();
  let destroyed = 0, mappedRead = false, bufferIndex = 0;
  const readback = { mapAsync: () => { mapStarted.resolve(); return mapping.promise; }, getMappedRange: () => { mappedRead = true; return new ArrayBuffer(4); } };
  const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
  const device = {
    destroy: () => { destroyed++; },
    createBuffer: () => bufferIndex++ ? readback : {},
    createShaderModule: () => ({}),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginComputePass: () => pass, copyBufferToBuffer() {}, finish: () => ({}) }),
    queue: { submit() {} },
  };
  installNavigator(t, { requestAdapter: async () => ({ requestDevice: async () => device }) });
  const controller = new AbortController();
  const checking = checkGpu(controller.signal);
  await mapStarted.promise;
  controller.abort();
  await assert.rejects(checking, /CANCELLED/);
  assert.equal(destroyed, 1);
  mapping.resolve();
  await nextTurn();
  assert.equal(destroyed, 1); assert.equal(mappedRead, false);
});
