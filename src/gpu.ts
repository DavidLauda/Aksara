export const GPU_PROBE_TIMEOUT_MS = 15_000;

/** A GPU driver must never hold the extension's one-job lock indefinitely. */
export async function checkGpu(signal?: AbortSignal) {
  const cancellation = () => new Error('CANCELLED: GPU capability check was cancelled.');
  if (signal?.aborted) throw cancellation();
  let device: GPUDevice | undefined;
  let stopped: Error | undefined;
  const destroyDevice = () => {
    const current = device; device = undefined;
    try { current?.destroy(); } catch { /* A lost device can already be released. */ }
  };
  let rejectStop!: (error: Error) => void;
  const stopPromise = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (error: Error) => {
    if (stopped) return;
    stopped = error; destroyDevice(); rejectStop(error);
  };
  const abort = () => stop(cancellation());
  const timer = setTimeout(() => stop(new Error('WEBGPU_UNAVAILABLE: GPU capability check timed out. Restart Chrome or check hardware acceleration, then retry.')), GPU_PROBE_TIMEOUT_MS);
  signal?.addEventListener('abort', abort, { once: true });
  const assertActive = () => { if (stopped) throw stopped; };
  const probe = (async () => {
    if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE: This browser context has no WebGPU API.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    assertActive();
    if (!adapter) throw new Error('WEBGPU_UNAVAILABLE: No usable GPU adapter was found.');
    const acquired = await adapter.requestDevice();
    // requestDevice cannot be aborted. Its result still needs disposal when it
    // arrives after the caller has already received cancellation or timeout.
    device = acquired;
    try {
      assertActive();
      const output = acquired.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = acquired.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const module = acquired.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> value: array<u32>; @compute @workgroup_size(1) fn main() { value[0] = 42u; }' });
      const pipeline = await acquired.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      assertActive();
      const binding = acquired.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] });
      const encoder = acquired.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(1); pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, 4);
      acquired.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      assertActive();
      const computeResult = new Uint32Array(readback.getMappedRange())[0];
      readback.unmap(); output.destroy(); readback.destroy();
      if (computeResult !== 42) throw new Error('WEBGPU_UNAVAILABLE: WebGPU compute validation failed.');
      const storage = await navigator.storage.estimate();
      assertActive();
      return {
        available: true, computeResult,
        adapter: { vendor: adapter.info?.vendor ?? 'unknown', architecture: adapter.info?.architecture ?? 'unknown', description: adapter.info?.description ?? '' },
        shaderF16: adapter.features.has('shader-f16'),
        limits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
        storage,
        userAgent: navigator.userAgent,
      };
    } finally { destroyDevice(); }
  })();
  // Promise.race retains rejection handlers on the unfinished probe, including
  // a late requestDevice/mapAsync failure after cancellation has been returned.
  try { return await Promise.race([probe, stopPromise]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
