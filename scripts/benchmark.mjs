import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { evaluateCase } from './benchmark/metrics.mjs';
import { saveReport } from './benchmark/report.mjs';

const args = process.argv.slice(2), selected = [];
let repeats = 1, sampleMemory = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--case' && args[index + 1]) selected.push(args[++index]);
  else if (args[index] === '--repeats' && args[index + 1]) repeats = Number(args[++index]);
  else if (args[index] === '--memory') sampleMemory = true;
  else throw new Error(`Unknown/incomplete benchmark argument: ${args[index]}`);
}
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5, 'Choose 1–5 cold/warm pairs per case.');
const root = resolve('.'), corpusPath = resolve('benchmarks/corpus.json');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
assert.equal(corpus.schemaVersion, 1);
assert.ok(new Set(corpus.cases.map(item => item.id)).size === corpus.cases.length, 'Case IDs must be unique.');
for (const id of selected) assert.ok(corpus.cases.some(item => item.id === id), `Unknown case: ${id}`);
corpus.cases = corpus.cases.filter(item => !selected.length || selected.includes(item.id));
const images = new Map();
for (const item of corpus.cases) {
  const path = resolve(dirname(corpusPath), item.file);
  assert.ok(!relative(root, path).startsWith('..') && !relative(root, path).startsWith('.git'), 'Fixture must stay in the workspace.');
  const bytes = await readFile(path);
  assert.ok(bytes.length <= 8 * 1024 * 1024, 'Fixture exceeds image byte limit.');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `${item.id}: fixture hash changed; review annotations before updating the corpus.`);
  for (const region of item.regions) {
    const box = region.box;
    assert.ok(region.text.trim() && region.referenceTranslation.trim());
    assert.ok([box.x, box.y, box.width, box.height].every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= item.width && box.y + box.height <= item.height, `${item.id}: invalid region bounds`);
  }
  images.set(item.id, `data:image/png;base64,${bytes.toString('base64')}`);
}
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const id = new Date().toISOString().replace(/[:.]/g, '-'), directory = resolve('test-results/benchmark', id);
await mkdir(directory, { recursive: true });
const report = { schemaVersion: 1, id, generatedAt: new Date().toISOString(), corpus, runs: [], errors: [], externalRequests: [], ok: false,
  host: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  memorySampling: { enabled: sampleMemory && process.platform === 'win32', intervalMs: 2000, note: 'Optional aggregate task-browser private bytes / summed working sets. Excludes dedicated GPU VRAM; shared resident pages may be double-counted. Sampling perturbs timing; no allocation ceiling is established.' } };
const extensionPath = resolve('dist'), origin = 'http://page.aksara-fixture.net';
let context, page, bridge, browserSession, extensionId, server;
const execute = promisify(execFile);
const message = (type, fields = {}) => bridge.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type, ...fields }), { type, fields });
async function until(predicate, description, timeout = 30_000) {
  const started = Date.now();
  while (!await predicate()) { if (Date.now() - started > timeout) throw new Error(`Timed out: ${description}`); await new Promise(resolveWait => setTimeout(resolveWait, 200)); }
}
async function diagnostic(operation) {
  const accepted = await message('START_JOB', { operation, host: 'offscreen-worker' }); assert.equal(accepted.ok, true, accepted.error);
  let job; await until(async () => { job = (await message('GET_JOB')).job; return job?.id === accepted.jobId && job.state !== 'running'; }, operation, 40_000);
  assert.equal(job.state, 'done', job.error); return job.result;
}
async function inPage(operation) {
  return bridge.evaluate(async ({ url, operation }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url); if (!tab) throw new Error('Benchmark document is unavailable.');
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: operation => {
      if (operation === 'install') {
        globalThis.__aksaraBenchmarkMessages = [];
        const connect = chrome.runtime.connect.bind(chrome.runtime);
        chrome.runtime.connect = (...args) => {
          const port = connect(...args); port.onMessage.addListener(message => globalThis.__aksaraBenchmarkMessages.push(message)); return port;
        };
      } else if (operation === 'clear') globalThis.__aksaraBenchmarkMessages = [];
      else return globalThis.__aksaraBenchmarkMessages;
    }, args: [operation] }))[0].result;
  }, { url: page.url(), operation });
}
async function memoryObserver() {
  if (!report.memorySampling.enabled) return { stop: async () => ({ status: 'not-measured' }) };
  const evidence = { status: 'sampled', samples: 0, peakPrivateBytes: 0, peakSummedWorkingSetBytes: 0, errors: [] };
  let pending;
  const sample = () => pending ??= (async () => {
    try {
      const ids = (await browserSession.send('SystemInfo.getProcessInfo')).processInfo.map(process => Number(process.id)).filter(Number.isSafeInteger);
      assert.ok(ids.length);
      const command = `$aksaraBenchmarkProcesses = Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; @{privateBytes=($aksaraBenchmarkProcesses | Measure-Object PrivateMemorySize64 -Sum).Sum; workingSetBytes=($aksaraBenchmarkProcesses | Measure-Object WorkingSet64 -Sum).Sum} | ConvertTo-Json -Compress`;
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10_000 });
      const result = JSON.parse(stdout); evidence.samples++;
      evidence.peakPrivateBytes = Math.max(evidence.peakPrivateBytes, Number(result.privateBytes) || 0);
      evidence.peakSummedWorkingSetBytes = Math.max(evidence.peakSummedWorkingSetBytes, Number(result.workingSetBytes) || 0);
    } catch (error) { evidence.errors.push(error.message.slice(0, 200)); }
  })().finally(() => { pending = undefined; });
  await sample(); const timer = setInterval(() => { void sample(); }, report.memorySampling.intervalMs);
  return { stop: async () => { clearInterval(timer); await pending; await sample(); return evidence; } };
}
try {
  const sourceFiles = ['scripts/benchmark.mjs', 'scripts/benchmark/metrics.mjs', 'benchmarks/corpus.json', 'src/light-regions.ts', 'src/ocr-result.ts', 'src/translation-result.ts', 'src/translation.ts', 'src/model-cache-core.ts', 'src/gpu.ts', 'dist/background.js', 'dist/offscreen.js', 'dist/content.js', 'dist/manifest.json'];
  report.fingerprints = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
  report.modelManifest = JSON.parse(await readFile('src/model-manifest.json', 'utf8'));
  report.gitCommit = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Aksara local benchmark</title><style>body{margin:24px;font:16px Arial;background:#edf1eb;color:#253c34}img{display:block;width:640px;max-width:90vw;height:auto;margin-top:18px}</style><main><h1>Aksara local benchmark</h1><p>Development fixtures · local OCR and translation</p><img id="sample" alt="Benchmark fixture"></main></html>');
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(80, '127.0.0.1', yes); });
  context = await chromium.launchPersistentContext(resolve('.test-profile-current'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 },
    args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`] });
  report.browser = context.browser().version();
  await context.route(/^https:\/\//, route => route.abort('blockedbyclient'));
  context.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.origin !== origin) report.externalRequests.push({ origin: url.origin, path: url.pathname, method: request.method() }); });
  context.on('page', surface => { surface.on('pageerror', error => report.errors.push(error.message)); surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text().slice(0, 300)); }); });
  browserSession = await context.browser().newBrowserCDPSession();
  ({ id: extensionId } = await browserSession.send('Extensions.loadUnpacked', { path: extensionPath }));
  bridge = await context.newPage(); await bridge.goto(`chrome-extension://${extensionId}/popup.html`);
  report.extensionVersion = (await message('PING')).version;
  report.modelStatus = (await message('GET_MODEL_STATUS')).model; assert.equal(report.modelStatus.ready, true, 'Prepare the model explicitly in .test-profile-current first; benchmark never downloads it.');
  assert.equal(report.modelStatus.revision, report.modelManifest.revision);
  assert.equal(report.modelStatus.dtype, report.modelManifest.dtype);
  report.gpu = await diagnostic('CHECK_GPU');
  const previousPreferences = await bridge.evaluate(() => chrome.storage.local.get(['languageSettings', 'siteSettings', 'overlaySettings']));
  report.preferencesRestored = false;
  try {
    await bridge.evaluate(() => chrome.storage.local.set({ siteSettings: { disabledOrigins: [] }, overlaySettings: { highContrast: false } }));
    page = await context.newPage(); await page.goto(origin);
    await page.locator('#sample').evaluate(async (image, source) => { image.src = source; await image.decode(); }, images.get(corpus.cases[0].id));
    await page.bringToFront();
    const targets = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos;
    const target = targets.find(target => target.url === page.url()); assert.ok(target);
    await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    await inPage('install');
    await bridge.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === url); await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); }, page.url());
    await context.setOffline(true); report.offlineDuringMeasurements = true;
    for (const item of corpus.cases) for (let repeat = 1; repeat <= repeats; repeat++) for (const mode of ['cold', 'warm']) {
      if (mode === 'cold') await diagnostic('UNLOAD_MODEL');
      await bridge.evaluate(item => chrome.storage.local.set({ languageSettings: { sourceLanguage: item.sourceLanguage, targetLanguage: item.targetLanguage } }), item);
      await page.locator('#sample').evaluate(async (image, source) => { image.src = source; await image.decode(); }, images.get(item.id));
      const button = page.locator('#aksara-root button[aria-label="Translate image"]');
      await inPage('clear'); await page.locator('#sample').hover({ position: { x: 8, y: 8 } });
      const dismiss = page.locator('#aksara-root .dismiss:visible');
      if (await dismiss.count()) await dismiss.click();
      await button.waitFor();
      const observer = await memoryObserver(), started = performance.now();
      const run = { caseId: item.id, kind: item.kind, mode, repeat, ok: false };
      console.log(`START ${item.id} ${mode} ${repeat}/${repeats}`);
      try {
        // Dismiss clears the previous UI/result but deliberately leaves the
        // inference worker warm. Never feed annotations into the runtime.
        await button.focus(); await button.press('Enter');
        let reply, previousStage;
        await until(async () => {
          const messages = await inPage('messages'), stage = messages.findLast(event => event.type === 'IMAGE_PROGRESS')?.stage;
          if (stage && stage !== previousStage) { previousStage = stage; console.log(`  ${stage}`); }
          reply = messages.findLast(event => ['IMAGE_READY', 'IMAGE_ERROR'].includes(event.type)); return Boolean(reply);
        }, `${item.id} ${mode}`, 390_000);
        run.wallMs = Math.round(performance.now() - started);
        if (reply.type !== 'IMAGE_READY') throw new Error(`${reply.code}: ${reply.userMessage}`);
        run.image = reply.image;
        if (!run.image.translation) throw new Error(JSON.stringify(run.image.translationError));
        assert.equal(run.image.translation.cold, mode === 'cold', 'Cold/warm condition changed; do not silently mislabel timing.');
        run.metrics = evaluateCase(item, run.image); run.ok = true;
      } catch (error) { run.wallMs ??= Math.round(performance.now() - started); run.error = error.message; }
      finally { run.memory = await observer.stop(); }
      report.runs.push(run); await saveReport(report, directory);
      console.log(`${run.ok ? 'DONE' : 'ERROR'} ${item.id} ${mode}: ${(run.wallMs / 1000).toFixed(2)}s; CER=${run.metrics?.ocr.cer ?? 'n/a'}; ${run.error ?? ''}`);
    }
  } finally {
    await diagnostic('UNLOAD_MODEL').catch(() => {});
    await bridge.evaluate(async previous => {
      const keys = ['languageSettings', 'siteSettings', 'overlaySettings'];
      await chrome.storage.local.remove(keys.filter(key => !(key in previous))); await chrome.storage.local.set(previous);
    }, previousPreferences); report.preferencesRestored = true;
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  report.ok = report.runs.every(run => run.ok); if (!report.ok) process.exitCode = 1;
} catch (error) { report.failure = error.stack || error.message; process.exitCode = 1; }
finally {
  await context?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
  report.completedAt = new Date().toISOString(); await saveReport(report, directory, { final: true });
  await writeFile(resolve('test-results/benchmark/latest.json'), JSON.stringify({ runId: id, directory: relative(root, directory), ok: report.ok }, null, 2) + '\n');
  console.log(`Report: ${join(directory, 'report.md')}`); if (report.failure) console.error(report.failure);
}
