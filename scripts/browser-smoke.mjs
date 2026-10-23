import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const modelTest = process.argv.includes('--model');
const firstHost = process.argv.includes('--offscreen') ? 'offscreen-worker' : 'service-worker';
await mkdir('test-results', { recursive: true });
const context = await chromium.launchPersistentContext(resolve('.test-profile-current'), {
  channel: 'chromium', headless: true,
  args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`],
});
const report = { generatedAt: new Date().toISOString(), modelTest, browser: context.browser()?.version(), hardware: { platform: os.platform(), cpu: os.cpus()[0].model, totalMemoryBytes: os.totalmem() }, memory: { peakProcessPrivateBytes: 0, peakProcessWorkingSetBytes: 0, note: 'Aggregate isolated-browser process measurements; excludes dedicated GPU VRAM and may count shared resident pages more than once.' }, jobs: [], errors: [], remoteRequests: [] };
try {
  const browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Extensions.loadUnpacked', { path: resolve('dist') });
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') report.errors.push(event.text().slice(0, 500)); });
  context.on('request', request => { if (request.url().startsWith('https:')) { const url = new URL(request.url()); report.remoteRequests.push(url.origin + url.pathname); } });
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(`chrome-extension://${extensionId}/options.html`); break; }
    catch (error) { if (attempt >= 15) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  await page.screenshot({ path: 'test-results/setup.png', fullPage: true });
  const workerSession = await context.newCDPSession(page);
  let versions = [];
  workerSession.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) => { versions = updated; });
  await workerSession.send('ServiceWorker.enable');
  async function memorySample() {
    if (!modelTest || process.platform !== 'win32') return;
    try {
      const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo');
      const ids = processInfo.map(process => Number(process.id)).filter(Number.isSafeInteger);
      const command = `$aksaraProcesses = Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; @{privateBytes=($aksaraProcesses | Measure-Object PrivateMemorySize64 -Sum).Sum; workingSetBytes=($aksaraProcesses | Measure-Object WorkingSet64 -Sum).Sum} | ConvertTo-Json -Compress`;
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true });
      const sample = JSON.parse(stdout);
      report.memory.peakProcessPrivateBytes = Math.max(report.memory.peakProcessPrivateBytes, sample.privateBytes);
      report.memory.peakProcessWorkingSetBytes = Math.max(report.memory.peakProcessWorkingSetBytes, sample.workingSetBytes);
    } catch { report.memory.unavailable = true; }
  }

  async function run(operation, host = 'service-worker', language = 'eng', pair = 'en-id') {
    const response = await page.evaluate(fields => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'START_JOB', ...fields }), { operation, host, language, pair });
    assert.equal(response.ok, true, response.error);
    let previous = '';
    const started = Date.now();
    for (;;) {
      const { job } = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'GET_JOB' }));
      if (job?.id === response.jobId) {
        const stage = `${operation} [${host}] ${job.progress.stage} ${job.progress.fraction === null ? '' : Math.round(job.progress.fraction * 100) + '%'}`;
        if (stage !== previous) { console.log(stage); previous = stage; }
        if (job.state !== 'running') {
          report.jobs.push(job);
          console.log(JSON.stringify(job.state === 'done' ? { operation, elapsedMs: job.elapsedMs, result: job.result } : { operation, error: job.error }));
          return job;
        }
      }
      if (Date.now() - started > 620_000) throw new Error(`Browser check timed out: ${operation}`);
      await memorySample();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const gpu = await run('CHECK_GPU');
  assert.equal(gpu.state, 'done', gpu.error);
  const ocr = await run('OCR_SAMPLE');
  assert.equal(ocr.state, 'done', ocr.error);
  assert.match(ocr.result.text, /Open the door/i);
  assert.ok(ocr.result.lines.length > 0);
  const ind = await run('OCR_SAMPLE', 'service-worker', 'ind');
  assert.equal(ind.state, 'done', ind.error);
  assert.match(ind.result.text, /Buka pintunya/i);
  const malformed = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 99, target: 'background', type: 'START_JOB', operation: 'OCR_SAMPLE' }).catch(() => null));
  assert.ok(malformed == null);
  if (modelTest) {
    const cold = await run('PIPELINE_SAMPLE', firstHost);
    assert.equal(cold.state, 'done', cold.error);
    assert.match(cold.result.translation.translatedText, /buka|pintu/i);
    const warm = await run('TRANSLATE_SAMPLE', firstHost);
    assert.equal(warm.state, 'done', warm.error);
    assert.equal(warm.result.cold, false);
    const reverse = await run('TRANSLATE_SAMPLE', firstHost, 'eng', 'id-en');
    assert.equal(reverse.state, 'done', reverse.error);
    assert.match(reverse.result.translatedText, /door/i);
    const french = await run('TRANSLATE_SAMPLE', firstHost, 'eng', 'en-fr');
    assert.equal(french.state, 'done', french.error);
    assert.match(french.result.translatedText, /porte/i);
    const fallback = await run('PIPELINE_SAMPLE', firstHost === 'service-worker' ? 'offscreen-worker' : 'service-worker');
    assert.equal(fallback.state, 'done', fallback.error);
    await run('UNLOAD_MODEL', 'offscreen-worker');
    await context.setOffline(true);
    const offline = await run('PIPELINE_SAMPLE', 'offscreen-worker');
    assert.equal(offline.state, 'done', offline.error);
    assert.equal(offline.result.translation.cache.downloadedBytes, 0);
    await context.setOffline(false);
    await run('UNLOAD_MODEL', 'offscreen-worker');
    const interrupted = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'START_JOB', operation: 'TRANSLATE_SAMPLE', host: 'offscreen-worker' }));
    assert.equal(interrupted.ok, true);
    await page.waitForFunction(async () => {
      const { job } = await chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'GET_JOB' });
      return ['model_prepare', 'translate'].includes(job?.progress?.stage);
    });
    const version = versions.find(version => version.scriptURL === `chrome-extension://${extensionId}/background.js` && version.runningStatus === 'running');
    assert.ok(version, 'Service worker version is available for the restart test.');
    await workerSession.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    const recovered = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'GET_JOB' }));
    assert.equal(recovered.job.state, 'error');
    assert.match(recovered.job.error, /INTERRUPTED/);
    report.interruptedJobRecovered = true;
    const afterRestart = await run('OCR_SAMPLE');
    assert.equal(afterRestart.state, 'done', afterRestart.error);
  }
  if (!modelTest) assert.equal(report.remoteRequests.length, 0, 'Bundled OCR and capability checks require no remote assets.');
  await page.screenshot({ path: 'test-results/diagnostics.png', fullPage: true });
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.message; process.exitCode = 1;
  console.error(error.message);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/${modelTest ? 'model' : 'browser'}-report.json`, JSON.stringify(report, null, 2) + '\n');
  await context.close();
}
