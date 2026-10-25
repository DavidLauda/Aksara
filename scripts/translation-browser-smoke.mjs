import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: sharp } = await import('sharp');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const extensionPath = resolve('dist');
const emptyProfile = resolve('.test-profile-translation-empty');
const cachedProfile = resolve('.test-profile-current');
const downloadProfile = resolve('.test-profile-translation-download');
const fixtureOrigin = 'http://page.aksara-fixture.net';
const emptyOnly = process.argv.includes('--empty-only');
const cachedOnly = process.argv.includes('--cached-only');
const hostSwitchOnly = process.argv.includes('--host-switch-only');
const downloadProbe = process.argv.includes('--download-probe');
assert.ok([emptyOnly, cachedOnly, hostSwitchOnly, downloadProbe].filter(Boolean).length <= 1, 'Choose only one scoped test mode.');
const report = {
  generatedAt: new Date().toISOString(), phase: 4, browser: null,
  hardware: { platform: os.platform(), cpu: os.cpus()[0].model, totalMemoryBytes: os.totalmem() },
  cases: [], errors: [], externalRequests: [], screenshots: [], ok: false,
  note: 'Real packaged OCR and NLLB q8/WebGPU inference. Existing .test-profile-current model cache is preserved. No remote inference API or model-download stub is used.',
};
let context, page, bridge, browserSession, extensionId;

const pngFor = async text => sharp({ create: { width: 900, height: 300, channels: 3, background: '#fbfaf4' } })
  .composite([{ input: Buffer.from(`<svg width="900" height="300"><text x="55" y="175" font-family="Arial" font-size="62" fill="#19251f">${text}</text></svg>`) }]).png().toBuffer();
const englishImage = `data:image/png;base64,${(await pngFor('Open the door.')).toString('base64')}`;
const indonesianImage = `data:image/png;base64,${(await pngFor('Buka pintunya.')).toString('base64')}`;
const multilineImage = `data:image/png;base64,${(await sharp({ create: { width: 900, height: 440, channels: 3, background: '#fbfaf4' } })
  .composite([{ input: Buffer.from('<svg width="900" height="440"><g font-family="Arial" font-size="62" fill="#19251f"><text x="55" y="150">Open the door.</text><text x="55" y="310">Good morning.</text></g></svg>') }]).png().toBuffer()).toString('base64')}`;
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Aksara local translation preview</title><style>
  body{margin:32px;background:#edf1eb;color:#263d30;font:17px/1.5 system-ui}main{max-width:1040px;margin:auto}h1{font-size:28px;margin-bottom:8px}p{max-width:60ch}img{display:block;max-width:100%;height:auto;margin-top:28px;border:1px solid #c5d2c5}small{display:block;margin-top:22px;color:#476050}
  </style></head><body><main><h1>Read images in your language</h1><p>Aksara recognizes and translates this image on your device.</p><img id="sample" width="900" height="300" alt="Open the door" src="${englishImage}"><small>Local preview · No image or text is uploaded</small></main></body></html>`);
});

async function until(predicate, description, timeout = 30_000, interval = 120) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${description}`);
    await new Promise(resolveWait => setTimeout(resolveWait, interval));
  }
}
const message = (type, fields = {}) => bridge.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type, ...fields }), { type, fields });
const button = () => page.locator('#aksara-root button[aria-label="Translate image"]');
const translatedText = () => page.locator('#aksara-root textarea[aria-label="Translated text"]:visible');
const status = () => page.locator('#aksara-root [role="status"]');

async function captured(type) {
  return bridge.evaluate(async ({ url, type }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    if (!tab?.id) throw new Error('The fixture tab is unavailable.');
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: type => globalThis.__aksaraTestMessages.filter(message => !type || message.type === type), args: [type] }))[0].result;
  }, { url: page.url(), type: type ?? null });
}
async function clearCaptured() {
  await bridge.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__aksaraTestMessages = []; } });
  }, page.url());
}
async function launch(profile) {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1060, height: 860 },
    args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`],
  });
  report.browser = context.browser().version();
  context.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== fixtureOrigin) report.externalRequests.push({ origin: url.origin, path: url.pathname, method: request.method(), range: request.headers().range || null, bodyBytes: Buffer.byteLength(request.postData() || '') });
    // Independent guard: even on an unexpectedly fast connection this probe
    // must never finish the 912 MB model. At most a few bounded ranges may land.
    const rangeStart = Number(/^bytes=(\d+)-/.exec(request.headers().range || '')?.[1]);
    if (downloadProbe && url.hostname === 'huggingface.co' && rangeStart >= 64 * 1024 * 1024) {
      report.downloadSafetyStop = true;
      void message('CANCEL_MODEL_JOB').catch(() => {});
    }
  });
  context.on('page', surface => {
    surface.on('pageerror', error => report.errors.push(error.message));
    surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text().slice(0, 500)); });
  });
  browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Target.setDiscoverTargets', { discover: true, filter: [{}] });
  const loaded = await browserSession.send('Extensions.loadUnpacked', { path: extensionPath });
  extensionId = loaded.id;
  bridge = await context.newPage();
  await bridge.goto(`chrome-extension://${extensionId}/popup.html`);
  const ping = await message('PING');
  assert.equal(ping.ok, true); report.extensionVersion = ping.version;
  const diagnostics = await context.newCDPSession(bridge);
  diagnostics.on('ServiceWorker.workerErrorReported', event => report.errors.push(`Background: ${event.errorMessage?.errorMessage || JSON.stringify(event)}`));
  await diagnostics.send('ServiceWorker.enable');
  page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__aksaraVitals = { lcpMs: null, cumulativeLayoutShift: 0, maxEventTimingMs: null };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) globalThis.__aksaraVitals.lcpMs = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__aksaraVitals.cumulativeLayoutShift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    if (PerformanceObserver.supportedEntryTypes.includes('event')) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.interactionId) globalThis.__aksaraVitals.maxEventTimingMs = Math.max(globalThis.__aksaraVitals.maxEventTimingMs || 0, entry.duration);
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  });
  await page.goto(fixtureOrigin);
  await page.locator('#sample').evaluate(image => image.decode());
  await page.bringToFront();
  const tabs = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos;
  const targetInfo = tabs.find(target => target.url === page.url());
  assert.ok(targetInfo, `The Chromium tab target is unavailable: ${JSON.stringify(tabs)}`);
  // This invokes the real extension action and grants activeTab; no fixture host
  // permissions are added to the production manifest or cache-preserving profile.
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
  await inject();
}
async function inject() {
  await bridge.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    if (!tab?.id) throw new Error('Fixture tab is unavailable.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      globalThis.__aksaraTestMessages = [];
      if (globalThis.__aksaraCaptureInstalled) return;
      globalThis.__aksaraCaptureInstalled = true;
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = (...args) => {
        const port = connect(...args);
        port.onMessage.addListener(message => globalThis.__aksaraTestMessages.push(message));
        return port;
      };
    } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  }, page.url());
  await until(async () => await button().count() === 1, 'one eligible image control');
}
async function setLanguages(sourceLanguage, targetLanguage) {
  await bridge.evaluate(languageSettings => chrome.storage.local.set({ languageSettings }), { sourceLanguage, targetLanguage });
}
async function setImage(source) {
  await page.locator('#sample').evaluate(async (image, source) => { image.src = source; await image.decode(); }, source);
}
async function startImage(keyboard = false) {
  await clearCaptured();
  await page.locator('#sample').hover({ position: { x: 8, y: 8 } });
  if (keyboard) { await button().focus(); await button().press('Enter'); } else await button().click();
}
async function imageResult() {
  let reply, previous = '';
  await until(async () => {
    const messages = await captured();
    reply = messages.findLast(message => ['IMAGE_READY', 'IMAGE_ERROR'].includes(message.type));
    const progress = messages.findLast(message => message.type === 'IMAGE_PROGRESS');
    if (progress?.stage !== previous) { previous = progress?.stage; console.log(`Image stage: ${previous}`); }
    return Boolean(reply);
  }, 'image translation result', 390_000, 500);
  assert.equal(reply.type, 'IMAGE_READY', `${reply.code}: ${reply.userMessage}`);
  return reply.image;
}
async function assertNoStagedImage() {
  await until(async () => bridge.evaluate(async () => {
    const db = await new Promise((resolveDb, reject) => { const request = indexedDB.open('aksara-image-transfers'); request.onsuccess = () => resolveDb(request.result); request.onerror = () => reject(request.error); });
    try {
      if (!db.objectStoreNames.contains('images')) return true;
      return await new Promise((resolveCount, reject) => {
        const transaction = db.transaction('images', 'readonly'), request = transaction.objectStore('images').count();
        transaction.oncomplete = () => resolveCount(request.result === 0); transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }), 'temporary image pixels released');
}
async function check(name, operation) {
  const started = Date.now();
  try {
    const evidence = await operation();
    await assertNoStagedImage();
    report.cases.push({ name, ok: true, elapsedMs: Date.now() - started, ...evidence });
    console.log(`PASS ${name}`);
  } catch (error) { report.cases.push({ name, ok: false, elapsedMs: Date.now() - started, error: error.message }); throw error; }
}
async function capture(name, surface = page) {
  await surface.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  report.screenshots.push(`${name}.png`);
}
async function modelOperation(type) {
  const response = await message(type);
  assert.equal(response.ok, true, response.error);
  let job, previous = '';
  await until(async () => {
    ({ job } = await message('GET_MODEL_STATUS'));
    if (!job || job.id !== response.jobId) return false;
    const progress = `${job.progress?.stage} ${Math.round((job.progress?.fraction || 0) * 100)}%`;
    if (progress !== previous) { previous = progress; console.log(`${type}: ${progress}`); }
    return job.state !== 'running';
  }, type, 390_000, 500);
  assert.equal(job.state, 'done', job.error);
  return job;
}
async function diagnostic(operation, host = 'offscreen-worker') {
  const accepted = await message('START_JOB', { operation, host });
  assert.equal(accepted.ok, true, accepted.error);
  let job;
  await until(async () => { ({ job } = await message('GET_JOB')); return job?.id === accepted.jobId && job.state !== 'running'; }, `${operation} diagnostic`, 390_000, 500);
  assert.equal(job.state, 'done', job.error);
  return job;
}
const releaseModel = () => diagnostic('UNLOAD_MODEL');
function assertTranslation(image, sourceLanguage, targetLanguage, pattern) {
  const result = image.translation;
  assert.ok(result, JSON.stringify(image.translationError));
  assert.equal(result.sourceLanguage, sourceLanguage); assert.equal(result.targetLanguage, targetLanguage);
  assert.match(result.text, pattern); assert.equal(result.partial, false); assert.equal(result.skippedSegments, 0);
  assert.equal(result.segments.length, image.ocr.lines.length);
  for (const segment of result.segments) {
    const original = image.ocr.lines.find(line => line.segmentId === segment.segmentId);
    assert.ok(original); assert.deepEqual(segment.box, original.box);
    assert.equal(segment.sourceText, original.text); assert.equal(segment.lowConfidence, original.lowConfidence);
    assert.ok(segment.translatedText.trim());
  }
  return result;
}

try {
  await mkdir('test-results', { recursive: true });
  await new Promise((resolveServer, reject) => { server.once('error', reject); server.listen(80, '127.0.0.1', resolveServer); });
  if (downloadProbe) {
    assert.equal(downloadProfile, resolve('.test-profile-translation-download'));
    await rm(downloadProfile, { recursive: true, force: true });
    await launch(downloadProfile);
    await bridge.goto(`chrome-extension://${extensionId}/options.html`);
    await check('explicit setup download preserves completed chunks through cancel and resume, then removes them', async () => {
      const manifest = JSON.parse(await readFile(resolve('src/model-manifest.json'), 'utf8'));
      const firstWeight = manifest.files.findIndex(file => file.bytes > 32 * 1024 * 1024);
      const smallBytes = manifest.files.slice(0, firstWeight).reduce((sum, file) => sum + file.bytes, 0);
      const partBytes = 16 * 1024 * 1024;
      const weightPath = `/${manifest.modelId}/resolve/${manifest.revision}/${manifest.files[firstWeight].path}`;
      const before = await message('GET_MODEL_STATUS');
      assert.equal(before.model.ready, false); assert.equal(before.model.cachedBytes, 0);
      await bridge.locator('#model-download:not([disabled])').waitFor();
      assert.equal(report.externalRequests.length, 0, 'Opening Setup must not start a download.');
      await bridge.locator('#model-download').click();
      let first, previous = '';
      await until(async () => {
        first = await message('GET_MODEL_STATUS');
        if (first.job?.state === 'error') throw new Error(first.job.error);
        const stage = `${first.job?.progress?.stage}: ${first.model.cachedBytes} bytes cached`;
        if (stage !== previous) { previous = stage; console.log(stage); }
        return first.model.cachedBytes >= smallBytes + partBytes;
      }, 'one real verified tokenizer and complete model range', 180_000, 120);
      await capture('translation-download-running', bridge);
      await bridge.locator('#model-cancel').click();
      await until(async () => { first = await message('GET_MODEL_STATUS'); return first.job?.state === 'cancelled'; }, 'download cancellation', 30_000);
      assert.equal(first.model.ready, false); assert.ok(first.model.cachedBytes < first.model.totalBytes);
      await until(async () => (await bridge.locator('#model-download').textContent()).includes('Resume'), 'resume UI is available');
      await capture('translation-download-partial', bridge);
      const storedParts = Math.floor((first.model.cachedBytes - smallBytes) / partBytes);
      assert.ok(storedParts >= 1);
      const resumeRequestStart = report.externalRequests.length;
      await bridge.locator('#model-download').click();
      let resumed;
      await until(async () => {
        resumed = await message('GET_MODEL_STATUS');
        if (resumed.job?.state === 'error') throw new Error(resumed.job.error);
        return resumed.model.cachedBytes >= first.model.cachedBytes + partBytes;
      }, 'resumed download stores the next missing real range', 180_000, 120);
      await bridge.locator('#model-cancel').click();
      await until(async () => { resumed = await message('GET_MODEL_STATUS'); return resumed.job?.state === 'cancelled'; }, 'resumed download cancellation');
      const resumedRanges = report.externalRequests.slice(resumeRequestStart).filter(request => request.origin === 'https://huggingface.co' && request.path === weightPath && request.range);
      assert.ok(resumedRanges.length > 0, 'Resume must request the next missing range.');
      for (const request of resumedRanges) {
        const start = Number(/^bytes=(\d+)-/.exec(request.range)?.[1]);
        assert.ok(start >= storedParts * partBytes, 'Completed ranges must be reused without another download.');
      }
      await until(async () => (await bridge.locator('#model-download').textContent()).includes('Resume'), 'resumed job shows retained partial state');
      await capture('translation-download-resumed', bridge);
      const partialAudit = await new AxeBuilder({ page: bridge }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(partialAudit.violations.map(item => item.id), []);
      await bridge.locator('#model-delete').click();
      let removed;
      await until(async () => { removed = await message('GET_MODEL_STATUS'); return removed.job?.operation === 'DELETE_MODEL' && removed.job.state === 'done' && removed.model.cachedBytes === 0; }, 'partial download removed');
      await until(async () => (await bridge.locator('#model-status').textContent()).includes('Model removed'), 'removed state is visible');
      await capture('translation-download-removed', bridge);
      return { explicitButtonClick: true, initialPartialBytes: first.model.cachedBytes, resumedPartialBytes: resumed.model.cachedBytes, completedPartsReused: storedParts, resumedRanges, finalCachedBytes: removed.model.cachedBytes, totalBytes: first.model.totalBytes, partialAxeViolations: 0 };
    });
  }
  if (!cachedOnly && !hostSwitchOnly && !downloadProbe) {
    assert.equal(emptyProfile, resolve('.test-profile-translation-empty'));
    await rm(emptyProfile, { recursive: true, force: true });
    await launch(emptyProfile);
    await check('first-use model status and declined consent make no network request', async () => {
      const before = await message('GET_MODEL_STATUS');
      assert.equal(before.ok, true); assert.equal(before.model.ready, false); assert.equal(before.model.cachedBytes, 0);
      const denied = await message('START_MODEL_DOWNLOAD', { consent: false });
      assert.equal(denied.ok, false); assert.match(denied.error, /CONSENT/i);
      const unauthorized = await bridge.evaluate(async url => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
        return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'START_MODEL_DOWNLOAD', consent: true }) }))[0].result;
      }, page.url());
      assert.equal(unauthorized.ok, false); assert.match(unauthorized.error, /UNAUTHORIZED/);
      assert.equal(report.externalRequests.length, 0);
      await capture('translation-setup-empty', bridge);
      return { model: before.model, declinedConsent: denied.error, contentRequest: unauthorized.error, remoteRequests: 0 };
    });
    await check('page click without a model preserves OCR and requests setup without downloading', async () => {
      await setLanguages('eng_Latn', 'ind_Latn'); await startImage(true);
      const image = await imageResult();
      assert.match(image.ocr.text, /Open the door/i); assert.equal(image.translationError.code, 'MODEL_NOT_READY');
      assert.equal(image.translation, undefined); assert.equal(await translatedText().count(), 0);
      assert.equal(report.externalRequests.length, 0);
      await capture('translation-model-required');
      return { result: image, remoteRequests: 0, keyboard: 'Enter' };
    });
    await check('same-language image needs no model or network', async () => {
      await setLanguages('eng_Latn', 'eng_Latn'); await startImage();
      const image = await imageResult();
      const result = assertTranslation(image, 'eng_Latn', 'eng_Latn', /Open the door/i);
      assert.equal(result.sameLanguage, true); assert.equal(result.model, null);
      assert.equal(report.externalRequests.length, 0);
      return { result, remoteRequests: 0 };
    });
    await context.close(); context = null;
  }

  if (!emptyOnly && !downloadProbe) {
    await launch(cachedProfile);
    if (hostSwitchOnly) {
      await check('host switch after idle background restart releases the previous dedicated model worker', async () => {
        await setImage(multilineImage); await setLanguages('eng_Latn', 'ind_Latn'); await startImage();
        const image = await imageResult();
        assertTranslation(image, 'eng_Latn', 'ind_Latn', /buka|pintu/i);
        assert.equal(image.translation.segments.length, 2, 'Both OCR lines are translated separately with their original boxes.');
        assert.match(image.translation.segments[1].translatedText, /selamat|pagi/i);
        const allTargets = (await browserSession.send('Target.getTargets', { filter: [{}] })).targetInfos;
        const hostTarget = allTargets.find(target => target.type === 'background_page' && target.url === `chrome-extension://${extensionId}/offscreen.html`);
        assert.ok(hostTarget, 'The offscreen host target is available.');
        // Chromium 156 reports dedicated workers with an empty URL. Their
        // parentId identifies the host; OCR has already terminated at this point.
        const workerTargets = allTargets.filter(target => target.type === 'worker' && target.parentId === hostTarget.targetId);
        assert.equal(workerTargets.length, 1, 'One dedicated inference worker should be warm before the restart.');
        const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(target => target.type === 'service_worker' && target.url === `chrome-extension://${extensionId}/background.js`);
        assert.ok(targets.length > 0);
        for (const target of targets) await browserSession.send('Target.closeTarget', { targetId: target.targetId });
        const sample = await diagnostic('TRANSLATE_SAMPLE', 'service-worker');
        assert.match(sample.result.translatedText, /buka|pintu/i);
        const remainingWorkers = (await browserSession.send('Target.getTargets', { filter: [{}] })).targetInfos.filter(target => target.type === 'worker' && target.parentId === hostTarget.targetId);
        assert.equal(remainingWorkers.length, 0, 'The old dedicated worker must be terminated before service-worker inference.');
        await releaseModel();
        return { pageTranslation: image.translation, serviceWorkerTranslation: sample.result, previousDedicatedWorkers: workerTargets.length, remainingDedicatedWorkers: remainingWorkers.length };
      });
    } else {
    await check('existing pinned q8 assets pass full SHA-256 verification', async () => {
      const before = await message('GET_MODEL_STATUS');
      assert.equal(before.model.ready, true, 'Run the explicit model download in Setup for this isolated profile before the cached suite.');
      assert.equal(before.model.cachedBytes, before.model.totalBytes);
      const job = await modelOperation('VERIFY_MODEL');
      assert.equal((await message('GET_MODEL_STATUS')).model.ready, true);
      return { model: before.model, job };
    });
    await check('cold English-to-Indonesian page translation returns matching OCR coordinates', async () => {
      await setLanguages('eng_Latn', 'ind_Latn'); await startImage(true);
      const image = await imageResult();
      const result = assertTranslation(image, 'eng_Latn', 'ind_Latn', /buka|pintu/i);
      assert.equal(result.cold, true); assert.equal(result.sameLanguage, false);
      assert.match(await translatedText().inputValue(), /buka|pintu/i);
      await capture('translation-success');
      return { result, ocr: image.ocr };
    });
    await check('warm page translation reuses one model worker', async () => {
      await startImage(); const image = await imageResult();
      const result = assertTranslation(image, 'eng_Latn', 'ind_Latn', /buka|pintu/i);
      assert.equal(result.cold, false);
      return { result };
    });
    await check('Indonesian-to-English uses captured source and target', async () => {
      await setImage(indonesianImage); await setLanguages('ind_Latn', 'eng_Latn'); await startImage();
      const image = await imageResult(); const result = assertTranslation(image, 'ind_Latn', 'eng_Latn', /door/i);
      assert.match(image.ocr.text, /Buka pintunya/i);
      return { result, ocr: image.ocr };
    });
    await check('English-to-French translates with the same cached model', async () => {
      await setImage(englishImage); await setLanguages('eng_Latn', 'fra_Latn'); await startImage();
      const image = await imageResult(); const result = assertTranslation(image, 'eng_Latn', 'fra_Latn', /porte/i);
      await capture('translation-french');
      return { result };
    });
    await check('cold local translation works offline after the worker is released', async () => {
      await releaseModel(); await setLanguages('eng_Latn', 'ind_Latn');
      await context.setOffline(true);
      let image;
      try { await startImage(); image = await imageResult(); }
      finally { await context.setOffline(false); }
      const result = assertTranslation(image, 'eng_Latn', 'ind_Latn', /buka|pintu/i);
      assert.equal(result.cold, true);
      return { result, offline: true };
    });
    await check('cancelling model initialization closes the host and permits retry', async () => {
      await releaseModel(); await startImage();
      await until(async () => (await captured('IMAGE_PROGRESS')).some(event => event.stage === 'model_prepare'), 'model initialization', 120_000);
      const busy = await message('START_JOB', { operation: 'OCR_SAMPLE', host: 'offscreen-worker' });
      assert.equal(busy.ok, false); assert.match(busy.error, /BUSY/);
      const deleteWhileBusy = await message('DELETE_MODEL');
      assert.equal(deleteWhileBusy.ok, false); assert.match(deleteWhileBusy.error, /BUSY/);
      await capture('translation-loading');
      await page.locator('#aksara-root button[aria-label="Cancel image preparation"]').press('Enter');
      await until(async () => (await bridge.evaluate(() => chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }))).length === 0, 'cancelled inference host closed');
      assert.match((await status().allTextContents()).join(' '), /cancel/i);
      assert.equal((await message('GET_MODEL_STATUS')).model.ready, true);
      await startImage(); const image = await imageResult();
      assertTranslation(image, 'eng_Latn', 'ind_Latn', /buka|pintu/i);
      return { hostClosed: true, cachedWeightsRetained: true, busy: busy.error, deleteWhileBusy: deleteWhileBusy.error, retrySucceeded: true };
    });
    await check('actual service-worker restart reclaims orphaned translation and permits retry', async () => {
      await releaseModel(); await startImage();
      await until(async () => (await captured('IMAGE_PROGRESS')).some(event => event.stage === 'model_prepare'), 'model initialization before restart', 120_000);
      const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(target => target.type === 'service_worker' && target.url === `chrome-extension://${extensionId}/background.js`);
      assert.ok(targets.length > 0);
      for (const target of targets) await browserSession.send('Target.closeTarget', { targetId: target.targetId });
      await until(async () => /interrupted/i.test((await status().allTextContents()).join(' ')), 'page receives interrupted status');
      await message('PING');
      await until(async () => !(await bridge.evaluate(() => chrome.storage.session.get('activeImageJob'))).activeImageJob, 'orphan recovery');
      await startImage(); const image = await imageResult();
      assertTranslation(image, 'eng_Latn', 'ind_Latn', /buka|pintu/i);
      return { closedBackgroundTargets: targets.length, orphanReclaimed: true, retrySucceeded: true };
    });
    }
    await check('translation preview fits three widths and has no automated accessibility violations', async () => {
      const viewports = [];
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const [width, height] of [[375, 812], [768, 900], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await until(async () => page.locator('#aksara-root .card').evaluate(card => { const rect = card.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; }), `translation card fits ${width}px`);
        await translatedText().focus();
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const violations = audit.violations.map(item => ({ id: item.id, impact: item.impact, description: item.description }));
        assert.deepEqual(violations, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await capture(`translation-${width}`);
        viewports.push({ width, height, violations, screenshot: `translation-${width}.png` });
      }
      await bridge.reload(); await bridge.setViewportSize({ width: 375, height: 900 });
      const popupAudit = await new AxeBuilder({ page: bridge }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(popupAudit.violations.map(item => item.id), []);
      await capture('translation-popup-ready', bridge);
      const setup = await context.newPage(); await setup.goto(`chrome-extension://${extensionId}/options.html`);
      const setupViewports = [];
      for (const [width, height] of [[375, 812], [768, 900], [1440, 900]]) {
        await setup.setViewportSize({ width, height });
        const setupAudit = await new AxeBuilder({ page: setup }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const violations = setupAudit.violations.map(item => ({ id: item.id, impact: item.impact, description: item.description }));
        assert.deepEqual(violations, []);
        assert.equal(await setup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await capture(`translation-setup-${width}`, setup);
        setupViewports.push({ width, height, violations, screenshot: `translation-setup-${width}.png` });
      }
      await setup.close();
      report.fixturePerformance = { ...await page.evaluate(() => globalThis.__aksaraVitals), note: 'Local synthetic fixture measurements. Event Timing is not field INP; null means no qualifying event was recorded.' };
      return { viewports, popupAxeViolations: 0, setupViewports, visualRegression: 'INCONCLUSIVE: no approved baseline', manualScreenReader: 'not run' };
    });
  }
  if (downloadProbe) {
    assert.ok(report.externalRequests.length > 0, 'The explicit download probe uses the real asset host.');
    for (const request of report.externalRequests) {
      const url = new URL(request.origin);
      assert.equal(url.protocol, 'https:');
      assert.ok(url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co') || url.hostname.endsWith('.hf.co'));
      assert.ok(['GET', 'HEAD'].includes(request.method)); assert.equal(request.bodyBytes, 0, 'No images or recognized text are uploaded.');
    }
    report.note = 'Explicit user-interface clicks downloaded real pinned Hugging Face assets into a separate disposable profile. The probe cancels after complete 16 MiB ranges, resumes missing ranges, cancels again and removes its partial cache. It does not redownload the whole model or touch .test-profile-current.';
  } else assert.deepEqual(report.externalRequests, [], 'OCR, existing-cache verification and inference must make no remote request.');
  assert.deepEqual(report.errors, [], 'No unhandled page or extension UI errors.');
  report.ok = true;
} catch (error) {
  report.failure = error.stack || error.message; process.exitCode = 1;
  console.error(report.failure);
  if (downloadProbe && bridge && !bridge.isClosed()) { await message('CANCEL_MODEL_JOB').catch(() => {}); await capture('translation-download-failure', bridge).catch(() => {}); }
  if (page && !page.isClosed()) { await capture('translation-failure').catch(() => {}); report.failureStatuses = await status().allTextContents().catch(() => []); }
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
  await writeFile(`test-results/translation${emptyOnly ? '-empty' : cachedOnly ? '-cached' : hostSwitchOnly ? '-host-switch' : downloadProbe ? '-download' : ''}-report.json`, JSON.stringify(report, null, 2) + '\n');
}
