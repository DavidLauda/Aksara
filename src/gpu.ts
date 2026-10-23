export async function checkGpu() {
  if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE: This browser context has no WebGPU API.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WEBGPU_UNAVAILABLE: No usable GPU adapter was found.');
  const device = await adapter.requestDevice();
  try {
    const output = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const module = device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> value: array<u32>; @compute @workgroup_size(1) fn main() { value[0] = 42u; }' });
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const computeResult = new Uint32Array(readback.getMappedRange())[0];
    readback.unmap(); output.destroy(); readback.destroy();
    if (computeResult !== 42) throw new Error('WebGPU compute validation failed.');
    return {
      available: true, computeResult,
      adapter: { vendor: adapter.info?.vendor ?? 'unknown', architecture: adapter.info?.architecture ?? 'unknown', description: adapter.info?.description ?? '' },
      shaderF16: adapter.features.has('shader-f16'),
      limits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
      storage: await navigator.storage.estimate(),
      userAgent: navigator.userAgent,
    };
  } finally { device.destroy(); }
}
