import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { build } = await import('vite');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const extensionPath = resolve('.test-extension-hardening');
const profilePath = resolve('.test-profile-hardening');
const report = { generatedAt: new Date().toISOString(), phase: 6, cases: [], errors: [], externalRequests: [], ok: false,
  scope: 'Real Chromium CacheStorage with tiny pinned fixture bytes; GPU-unavailable browser configuration. No NLLB download, physical OOM, or inference-quality claim.' };
let context, bridge, browserSession, extensionId;
const message = (type, fields = {}) => bridge.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type, ...fields }), { type, fields });
const fixtureFiles = [
  { path: 'config.json', data: Buffer.from('{"fixture":"Aksara cache test"}') },
  { path: 'onnx/model.onnx', data: Buffer.from(Array.from({ length: 48 }, (_, index) => index)) },
];
const fixture = { modelId: 'aksara/cache-fixture', revision: 'test-only-pinned-revision', dtype: 'test', files: fixtureFiles.map(file => ({ path: file.path, bytes: file.data.length, sha256: createHash('sha256').update(file.data).digest('hex') })) };

async function until(predicate, description, timeout = 25_000) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${description}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
}
async function check(name, run) {
  const started = Date.now();
  try { const evidence = await run(); report.cases.push({ name, ok: true, elapsedMs: Date.now() - started, ...evidence }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, ok: false, error: error.message }); throw error; }
}
async function launch(disableWebGpu = false) {
  context = await chromium.launchPersistentContext(profilePath, { channel: 'chromium', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extensionPath}`, ...(disableWebGpu ? ['--disable-gpu', '--disable-software-rasterizer'] : [])] });
  report.browser = context.browser().version();
  // The suite never needs remote data. Fail closed even if a browser switch
  // changes behavior and a production preflight unexpectedly succeeds.
  await context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
  context.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol)) report.externalRequests.push({ origin: url.origin, path: url.pathname, method: request.method() });
  });
  context.on('page', surface => {
    surface.on('pageerror', error => report.errors.push(error.message));
    surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text().slice(0, 500)); });
  });
  browserSession = await context.browser().newBrowserCDPSession();
  extensionId = (await browserSession.send('Extensions.loadUnpacked', { path: extensionPath })).id;
  bridge = await context.newPage(); await bridge.goto(`chrome-extension://${extensionId}/popup.html`);
  const ping = await message('PING'); assert.equal(ping.ok, true); report.extensionVersion = ping.version;
  const diagnostics = await context.newCDPSession(bridge);
  diagnostics.on('ServiceWorker.workerErrorReported', event => report.errors.push(`Background: ${event.errorMessage?.errorMessage || JSON.stringify(event)}`));
  await diagnostics.send('ServiceWorker.enable');
}

try {
  await mkdir('test-results', { recursive: true });
  // These two fixed disposable paths are checked before recursive removal.
  assert.equal(extensionPath, resolve('.test-extension-hardening'));
  assert.equal(profilePath, resolve('.test-profile-hardening'));
  await rm(extensionPath, { recursive: true, force: true });
  await rm(profilePath, { recursive: true, force: true });
  await cp(resolve('dist'), extensionPath, { recursive: true });
  // Exercise the production cache core in a test-only extension copy. It is
  // absent from dist and exposes no production test hooks or extra permissions.
  await build({ configFile: false, logLevel: 'error', build: { outDir: extensionPath, emptyOutDir: false,
    lib: { entry: resolve('src/model-cache-core.ts'), formats: ['es'], fileName: () => 'cache-probe.js' } } });
  await launch();
  await check('privacy is keyboard-reachable from the popup and readable across three viewport sizes', async () => {
    const opened = context.waitForEvent('page');
    const link = bridge.getByRole('link', { name: 'Privacy & local data' });
    await link.focus(); await link.press('Enter');
    const privacy = await opened; await privacy.waitForLoadState();
    assert.equal(privacy.url(), `chrome-extension://${extensionId}/privacy.html`);
    const viewports = [];
    try {
      await privacy.emulateMedia({ reducedMotion: 'reduce' });
      for (const width of [375, 768, 1440]) {
        const height = width === 375 ? 812 : 900; await privacy.setViewportSize({ width, height });
        assert.equal(await privacy.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const audit = await new AxeBuilder({ page: privacy }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(audit.violations, []);
        const screenshot = `test-results/privacy-${width}.png`; await privacy.screenshot({ path: screenshot, fullPage: true });
        viewports.push({ width, height, axeViolations: 0, horizontalOverflow: false, screenshot });
      }
      await privacy.getByRole('link', { name: 'Return to translation setup' }).focus();
      await privacy.keyboard.press('Enter'); await privacy.waitForURL(`chrome-extension://${extensionId}/options.html`);
      assert.equal(await privacy.getByRole('link', { name: 'Privacy & local data' }).getAttribute('href'), 'privacy.html');
    } finally { await privacy.close(); }
    await bridge.setViewportSize({ width: 330, height: 760 });
    const audit = await new AxeBuilder({ page: bridge }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(audit.violations, []);
    await bridge.screenshot({ path: 'test-results/hardening-popup.png', fullPage: true });
    return { viewports, keyboardPopupToPrivacyToSetup: true, popupAxeViolations: 0, privacyNetworkRequests: report.externalRequests.length };
  });
  await bridge.evaluate(async ({ fixture, data }) => {
    const { createModelCache } = await import(chrome.runtime.getURL('cache-probe.js'));
    globalThis.__cacheRequests = [];
    const fetchFixture = async (url, init) => {
      const file = fixture.files.find(file => url.endsWith(file.path));
      if (!file) throw new Error('Unexpected fixture URL');
      const bytes = Uint8Array.from(data[file.path]);
      const range = init?.headers?.Range;
      globalThis.__cacheRequests.push({ path: file.path, range: range ?? null });
      if (range) {
        const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
        return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
      }
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close(); } }));
    };
    const dependencies = { fetch: fetchFixture, partSize: 8, largeFileThreshold: 32, estimate: async () => ({ quota: 1_000_000, usage: 0 }) };
    globalThis.__cacheCore = createModelCache(fixture, dependencies);
    globalThis.__quotaCore = createModelCache(fixture, { ...dependencies, estimate: async () => ({ quota: 1, usage: 0 }) });
    globalThis.__fixture = fixture;
  }, { fixture, data: Object.fromEntries(fixtureFiles.map(file => [file.path, [...file.data]])) });

  await check('opening status and verifying an absent model never creates a cache or downloads', async () => {
    const evidence = await bridge.evaluate(async () => {
      const status = await __cacheCore.getModelStatus();
      const error = await __cacheCore.verifyModel().then(() => null, error => error.message);
      return { status, error, caches: await caches.keys(), fixtureRequests: __cacheRequests.length };
    });
    assert.equal(evidence.status.ready, false); assert.equal(evidence.status.cachedBytes, 0);
    assert.match(evidence.error, /MODEL_NOT_READY/); assert.deepEqual(evidence.caches, []); assert.equal(evidence.fixtureRequests, 0);
    return evidence;
  });
  await check('real CacheStorage accepts bounded streams and serves the verified virtual file offline', async () => {
    const evidence = await bridge.evaluate(async () => {
      await __cacheCore.prepareModel(); const status = await __cacheCore.verifyModel();
      const response = await __cacheCore.modelFetch(`https://huggingface.co/${__fixture.modelId}/resolve/${__fixture.revision}/onnx/model.onnx`);
      return { status, requests: [...__cacheRequests], modelBytes: [...new Uint8Array(await response.arrayBuffer())] };
    });
    assert.equal(evidence.status.ready, true); assert.deepEqual(evidence.modelBytes, [...fixtureFiles[1].data]);
    assert.equal(evidence.requests.length, 7); return evidence;
  });
  await check('evicted range is reported missing and explicit repair downloads only that range', async () => {
    const evidence = await bridge.evaluate(async () => {
      const before = __cacheRequests.length, statusBefore = await __cacheCore.getModelStatus();
      const cache = await caches.open(statusBefore.cache);
      await cache.delete(`https://huggingface.co/${__fixture.modelId}/resolve/${__fixture.revision}/onnx/model.onnx?aksara-part=8`);
      const missing = await __cacheCore.getModelStatus();
      const error = await __cacheCore.verifyModel().then(() => null, error => error.message);
      const automaticRequests = __cacheRequests.length - before;
      await __cacheCore.prepareModel(); await __cacheCore.verifyModel();
      return { missing, error, automaticRequests, repairRequests: __cacheRequests.slice(before), repaired: await __cacheCore.getModelStatus() };
    });
    assert.equal(evidence.missing.ready, false); assert.equal(evidence.missing.missingBytes, 8);
    assert.match(evidence.error, /MODEL_NOT_READY/); assert.equal(evidence.automaticRequests, 0);
    assert.deepEqual(evidence.repairRequests, [{ path: 'onnx/model.onnx', range: 'bytes=8-15' }]); assert.equal(evidence.repaired.ready, true); return evidence;
  });
  await check('same-size corrupted range fails SHA verification and removes only its file', async () => {
    const evidence = await bridge.evaluate(async () => {
      const before = __cacheRequests.length, status = await __cacheCore.getModelStatus(), cache = await caches.open(status.cache);
      const url = `https://huggingface.co/${__fixture.modelId}/resolve/${__fixture.revision}/onnx/model.onnx?aksara-part=0`;
      const part = await cache.match(url), bytes = new Uint8Array(await part.arrayBuffer()); bytes[0] ^= 255;
      await cache.put(url, new Response(bytes, { headers: part.headers }));
      const structuralReady = (await __cacheCore.getModelStatus()).ready;
      const error = await __cacheCore.verifyModel().then(() => null, error => error.message);
      return { structuralReady, error, after: await __cacheCore.getModelStatus(), automaticRequests: __cacheRequests.length - before, keys: (await cache.keys()).map(key => key.url) };
    });
    assert.equal(evidence.structuralReady, true); assert.match(evidence.error, /MODEL_INTEGRITY_FAILED/);
    assert.equal(evidence.after.cachedBytes, fixture.files[0].bytes); assert.equal(evidence.keys.length, 1); assert.equal(evidence.automaticRequests, 0); return evidence;
  });
  await check('whole-cache eviction and insufficient quota return recoverable errors without networking', async () => {
    const evidence = await bridge.evaluate(async () => {
      await __cacheCore.clearModel(); const before = __cacheRequests.length;
      const status = await __cacheCore.getModelStatus();
      const quotaError = await __quotaCore.prepareModel().then(() => null, error => error.message);
      return { status, quotaError, caches: await caches.keys(), automaticRequests: __cacheRequests.length - before };
    });
    assert.equal(evidence.status.cachedBytes, 0); assert.equal(evidence.status.ready, false);
    assert.match(evidence.quotaError, /INSUFFICIENT_STORAGE/); assert.deepEqual(evidence.caches, []); assert.equal(evidence.automaticRequests, 0); return evidence;
  });
  await context.close(); context = null;

  await launch(true);
  await check('Chrome with WebGPU disabled rejects model preparation before downloading and releases the gate', async () => {
    const gpuUnavailable = await bridge.evaluate(async () => !navigator.gpu || await navigator.gpu.requestAdapter() === null);
    assert.equal(gpuUnavailable, true, 'Verify no usable adapter before requesting model preparation.');
    const noConsent = await message('START_MODEL_DOWNLOAD'); assert.match(noConsent.error, /CONSENT_REQUIRED/);
    const started = await message('START_MODEL_DOWNLOAD', { consent: true }); assert.equal(started.ok, true);
    let status;
    await until(async () => { status = await message('GET_MODEL_STATUS'); return status.job?.id === started.jobId && status.job.state !== 'running'; }, 'GPU preflight failure');
    assert.equal(status.job.state, 'error'); assert.match(status.job.error, /WEBGPU_UNAVAILABLE/);
    assert.equal(status.model.cachedBytes, 0);
    const next = await message('START_JOB', { operation: 'CHECK_GPU', host: 'service-worker' }); assert.equal(next.ok, true);
    let diagnostic;
    await until(async () => { diagnostic = (await message('GET_JOB')).job; return diagnostic?.id === next.jobId && diagnostic.state !== 'running'; }, 'diagnostic GPU failure');
    assert.equal(diagnostic.state, 'error'); assert.match(diagnostic.error, /WEBGPU_UNAVAILABLE/);
    return { noConsent, modelJob: status.job, nextJobAccepted: true, gpuDiagnostic: diagnostic, caches: await bridge.evaluate(() => caches.keys()) };
  });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.ok = true;
} catch (error) { report.failure = error.stack || error.message; process.exitCode = 1; console.error(report.failure); }
finally {
  await context?.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/hardening-report.json', JSON.stringify(report, null, 2) + '\n');
}
