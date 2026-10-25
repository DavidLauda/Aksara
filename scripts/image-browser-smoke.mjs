import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: sharp } = await import('sharp');
const { default: AxeBuilder } = await import('@axe-core/playwright');

// Keep fixture permissions and data out of the distributable extension.
const extensionPath = resolve('.test-extension-images');
const profilePath = resolve('.test-profile-ocr');
const fixtureOrigin = 'http://page.aksara-fixture.net';
const cdnOrigin = 'http://cdn.aksara-fixture.net';
const deniedOrigin = 'http://denied.aksara-fixture.net';
const png = await sharp({ create: { width: 640, height: 280, channels: 4, background: '#f3f4e8' } })
  .composite([{ input: Buffer.from('<svg width="640" height="280"><text x="42" y="146" font-size="44">Open the door.</text></svg>') }]).png().toBuffer();
const tinyPng = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#eee' } }).png().toBuffer();
const blankPng = await sharp({ create: { width: 640, height: 280, channels: 3, background: '#fff' } }).png().toBuffer();
const indPng = await sharp({ create: { width: 1200, height: 480, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg width="1200" height="480"><g font-family="Arial" font-size="64" fill="black"><text x="60" y="160">Buka pintunya.</text><text x="60" y="300">Selamat pagi.</text></g></svg>') }]).png().toBuffer();
const densePng = await sharp({ create: { width: 1600, height: 4000, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from(`<svg width="1600" height="4000"><g font-family="Arial" font-size="38" fill="black">${Array.from({ length: 60 }, (_, index) => `<text x="40" y="${70 + index * 64}">Aksara reads text privately. Open the door. Line ${index + 1}.</text>`).join('')}</g></svg>`) }]).png().toBuffer();
const oversizedHeader = Buffer.from(png);
oversizedHeader.writeUInt32BE(20_000, 16);
oversizedHeader.writeUInt32BE(20_000, 20);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280"><rect width="640" height="280" fill="#f3f4e8"/><text x="42" y="146" font-size="44">Open the door.</text></svg>';
const requests = [];
const counts = new Map();
const gates = new Map();
const report = { generatedAt: new Date().toISOString(), phase: 3, browser: null, cases: [], errors: [], requests, ok: false };
let context;
let page;
let bridge;
let fixtureServer;
const workerVersions = new Map();

function fixtureHtml(source, { tiny = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Aksara image acquisition fixtures</title><style>
    body{margin:36px;font:18px system-ui;background:#edf1f4;color:#17212a}h1{font-size:26px}img{display:block;max-width:100%;margin:22px 0}#sample{width:640px;height:280px}#tiny{width:24px;height:24px}
    </style></head><body><main><h1>Aksara image acquisition</h1><p>Only a click should prepare image pixels.</p><img id="sample" alt="Open the door" src="${source}">${tiny ? '<img id="tiny" alt="Small icon" src="/tiny.png">' : ''}</main></body></html>`;
}

async function startServer() {
  fixtureServer = createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url, origin);
    const key = `${url.host}${url.pathname}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    const recorded = { origin, path: url.pathname, count, at: Date.now(), referrer: request.headers.referer || null };
    requests.push(recorded);
    response.setHeader('Cache-Control', 'no-store');
    // No Access-Control-Allow-Origin: CDN success exercises extension host access.
    if (url.pathname === '/fixture') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(fixtureHtml(url.searchParams.get('image') || '/same-origin.png', { tiny: url.searchParams.has('tiny') }));
      return;
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (url.pathname.startsWith('/slow-') && count > 1) {
      await new Promise(resolveGate => gates.set(url.pathname, resolveGate));
      if (response.destroyed) return;
    }
    const body = url.pathname === '/tiny.png' ? tinyPng : url.pathname === '/blank.png' ? blankPng : url.pathname === '/ind.png' ? indPng : url.pathname === '/ocr-interrupted.png' ? densePng
      : url.pathname === '/unsupported.svg' ? svg
        : url.pathname === '/oversized-header.png' && count > 1 ? oversizedHeader : png;
    response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png', 'Content-Length': Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise((resolveServer, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(80, '127.0.0.1', resolveServer);
  });
}

async function until(predicate, description, timeout = 20_000) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started >= timeout) throw new Error(`Timed out: ${description}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 60));
  }
}

function release(path) { gates.get(path)?.(); gates.delete(path); }
const translateButtons = () => page.locator('#aksara-root button[aria-label="Translate image"]');
const imageStatuses = () => page.locator('#aksara-root [role="status"]');
const recognizedText = () => page.locator('#aksara-root textarea[aria-label="Recognized text"]:visible');

async function latestResult() {
  return bridge.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const result = await chrome.scripting.executeScript({ target: { tabId: tabs.find(tab => tab.url === url).id }, func: () => globalThis.__aksaraTestMessages.filter(message => message.type === 'IMAGE_READY').at(-1)?.image });
    return result[0].result;
  }, page.url());
}

async function imageStatusMatches(expression) {
  await until(async () => (await imageStatuses().allTextContents()).some(text => expression.test(text)), `image status matching ${expression}`);
  return imageStatuses().allTextContents();
}

async function inject() {
  const tabId = await bridge.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab?.id) throw new Error('Fixture tab was not found.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      globalThis.__aksaraTestMessages = [];
      if (globalThis.__aksaraCaptureInstalled) return;
      globalThis.__aksaraCaptureInstalled = true;
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      // Observe actual port replies in the isolated world; OCR remains real.
      chrome.runtime.connect = (...args) => {
        const port = connect(...args);
        port.onMessage.addListener(message => globalThis.__aksaraTestMessages.push(message));
        return port;
      };
    } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return tab.id;
  }, page.url());
  await page.locator('#aksara-root').waitFor({ state: 'attached' });
  await until(async () => await translateButtons().count() === 1, 'one eligible image control');
  return tabId;
}

async function openFixture(image, options = {}) {
  const url = new URL('/fixture', fixtureOrigin);
  url.searchParams.set('image', image);
  if (options.tiny) url.searchParams.set('tiny', '1');
  await page.goto(url.href);
  await page.locator('#sample').evaluate(image => image.decode());
  return inject();
}

async function clickTranslate(index = 0) {
  const button = translateButtons().nth(index);
  // Move over the underlying image before clicking an intentionally subtle hover control.
  await page.locator(index ? '#late' : '#sample').hover({ position: { x: 8, y: 8 } });
  await button.click();
}

async function assertEmptyStaging() {
  let count;
  await until(async () => {
    count = await bridge.evaluate(async () => {
      const database = await new Promise((resolveDatabase, reject) => {
        const request = indexedDB.open('aksara-image-transfers');
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolveCount, reject) => {
          const transaction = database.transaction('images', 'readonly');
          const request = transaction.objectStore('images').count();
          transaction.oncomplete = () => resolveCount(request.result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('Image staging inspection was aborted.'));
        });
      } finally { database.close(); }
    });
    return count === 0;
  }, 'temporary image staging is empty');
  assert.equal(count, 0, 'Image bytes must be removed after completion or cancellation.');
  return count;
}

async function check(name, run) {
  const started = Date.now();
  try {
    const evidence = await run();
    const stagedImagesRemaining = await assertEmptyStaging();
    report.cases.push({ name, ok: true, elapsedMs: Date.now() - started, ...evidence, stagedImagesRemaining });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({ name, ok: false, elapsedMs: Date.now() - started, error: error.message });
    throw error;
  }
}

try {
  await mkdir('test-results', { recursive: true });
  assert.equal(extensionPath, resolve('.test-extension-images'));
  assert.equal(profilePath, resolve('.test-profile-ocr'));
  await rm(profilePath, { recursive: true, force: true });
  await rm(extensionPath, { recursive: true, force: true });
  await cp(resolve('dist'), extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...manifest.host_permissions, `${fixtureOrigin}/*`, `${cdnOrigin}/*`])];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await startServer();
  console.log('Starting isolated Chromium image/OCR checks…');
  context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium', headless: true, viewport: { width: 1060, height: 860 },
    args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`],
  });
  report.browser = context.browser().version();
  console.log(`Chromium ${report.browser} started.`);
  bridge = await context.newPage();
  const diagnosticSession = await context.newCDPSession(bridge);
  diagnosticSession.on('ServiceWorker.workerErrorReported', event => { report.errors.push(`Background error: ${event.errorMessage?.errorMessage || JSON.stringify(event)}`); });
  diagnosticSession.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const version of versions) workerVersions.set(version.versionId, version); });
  await diagnosticSession.send('ServiceWorker.enable');
  const browserSession = await context.browser().newBrowserCDPSession();
  const loaded = await browserSession.send('Extensions.loadUnpacked', { path: extensionPath });
  console.log('Unpacked extension loaded.');
  await bridge.goto(`chrome-extension://${loaded.id}/popup.html`);
  const ping = await bridge.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'PING' }));
  assert.equal(ping.ok, true);
  console.log('Background worker responds to extension messages.');
  await bridge.evaluate(() => chrome.storage.local.remove('languageSettings'));
  const extensionId = loaded.id;
  page = await context.newPage();
  for (const surface of [page, bridge]) surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text().slice(0, 500)); });
  await page.addInitScript(() => {
    globalThis.__aksaraVitals = { lcpMs: null, cumulativeLayoutShift: 0, maxEventTimingMs: null, eventTimingSupported: PerformanceObserver.supportedEntryTypes.includes('event') };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) globalThis.__aksaraVitals.lcpMs = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__aksaraVitals.cumulativeLayoutShift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    if (globalThis.__aksaraVitals.eventTimingSupported) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.interactionId) globalThis.__aksaraVitals.maxEventTimingMs = Math.max(globalThis.__aksaraVitals.maxEventTimingMs || 0, entry.duration);
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  });
  page.on('pageerror', error => report.errors.push(error.message));
  context.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && ![fixtureOrigin, cdnOrigin, deniedOrigin].includes(url.origin)) report.errors.push(`Unexpected external request: ${url.origin}`);
  });

  await check('visible eligible images, tiny exclusion, no automatic acquisition', async () => {
    await openFixture('/same-origin.png', { tiny: true });
    assert.equal(await translateButtons().count(), 1);
    const before = requests.filter(request => request.path.endsWith('.png')).length;
    await new Promise(resolveWait => setTimeout(resolveWait, 350));
    assert.equal(requests.filter(request => request.path.endsWith('.png')).length, before, 'Connecting must not fetch images again.');
    await page.screenshot({ path: 'test-results/images-detection.png', fullPage: true });
    return { eligibleControls: 1, automaticImageFetches: 0 };
  });

  await check('synthetic page clicks cannot start image acquisition', async () => {
    const before = counts.get('page.aksara-fixture.net/same-origin.png');
    await page.evaluate(() => document.querySelector('#aksara-root').shadowRoot.querySelector('button[aria-label="Translate image"]').click());
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
    assert.equal(counts.get('page.aksara-fixture.net/same-origin.png'), before, 'Synthetic clicks must not fetch the image.');
    assert.ok((await imageStatuses().allTextContents()).every(text => !text.trim()), 'Synthetic clicks must not create an image job or status.');
    return { syntheticAcquisitions: 0 };
  });

  await check('keyboard Enter recognizes same-origin image with natural-coordinate boxes', async () => {
    await translateButtons().first().focus();
    await translateButtons().first().press('Enter');
    const statuses = await imageStatusMatches(/Text recognized.*English/i);
    assert.match(await recognizedText().inputValue(), /Open the door\./i);
    const result = await latestResult();
    assert.equal(result.width, 640); assert.equal(result.height, 280);
    assert.ok(result.ocr.lines.length > 0);
    for (const line of result.ocr.lines) {
      assert.ok(line.box.x >= 0 && line.box.y >= 0 && line.box.width > 0 && line.box.height > 0);
      assert.ok(line.box.x + line.box.width <= 640 && line.box.y + line.box.height <= 280);
      assert.ok(line.confidence >= 0 && line.confidence <= 1);
    }
    await page.screenshot({ path: 'test-results/ocr-success.png', fullPage: true });
    return { statuses, input: 'keyboard Enter', result };
  });

  await check('late image insertion and reinjection stay idempotent', async () => {
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.id = 'late'; image.src = '/late.png'; image.width = 640; image.height = 280; image.alt = 'Late image';
      document.body.append(image);
      return image.decode();
    });
    await until(async () => await translateButtons().count() === 2, 'late image control');
    await bridge.evaluate(async url => {
      const tabs = await chrome.tabs.query({});
      await chrome.scripting.executeScript({ target: { tabId: tabs.find(tab => tab.url === url).id }, files: ['content.js'] });
    }, page.url());
    assert.equal(await page.locator('#aksara-root').count(), 1);
    await until(async () => await translateButtons().count() === 2, 'reinjected image controls');
    assert.equal(await translateButtons().count(), 2);
    await clickTranslate(1);
    await until(async () => (await imageStatuses().allTextContents()).filter(text => /Text recognized/.test(text)).length === 1, 'late image result after reinjection');
    return { eligibleControls: 2, roots: 1 };
  });

  await check('granted CDN image succeeds without page CORS', async () => {
    await openFixture(`${cdnOrigin}/cdn.png`);
    await clickTranslate();
    const statuses = await imageStatusMatches(/Text recognized/i);
    const fetch = requests.filter(request => request.origin === cdnOrigin && request.path === '/cdn.png').at(-1);
    assert.equal(fetch.referrer, null, 'Extension image fetch must omit the page referrer.');
    return { statuses, requestCount: counts.get('cdn.aksara-fixture.net/cdn.png'), acquisitionReferrer: fetch.referrer };
  });

  await check('missing CDN grant produces an actionable popup request', async () => {
    const granted = await bridge.evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), deniedOrigin);
    assert.equal(granted, false, 'Denied fixture host must have no real permission.');
    await openFixture(`${deniedOrigin}/denied.png`);
    const before = counts.get('denied.aksara-fixture.net/denied.png');
    await clickTranslate();
    const statuses = await imageStatusMatches(/allow|permission|popup/i);
    assert.equal(counts.get('denied.aksara-fixture.net/denied.png'), before, 'Missing permission must prevent the background fetch.');
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const allowButton = popup.locator('#allow-image-host');
    await allowButton.waitFor({ state: 'visible' });
    assert.match(await popup.locator('#image-host').innerText(), /denied\.aksara-fixture\.net/);
    await popup.screenshot({ path: 'test-results/images-permission.png', fullPage: true });
    await popup.close();
    return { statuses, popupPermissionHost: deniedOrigin, backgroundFetches: 0 };
  });

  for (const kind of ['data', 'blob']) {
    await check(`${kind} image uses bounded inline transfer and decoder`, async () => {
      await openFixture(`/inline-${kind}-placeholder.png`);
      const inlineBytes = await page.evaluate(async kind => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 280;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = '#f3f4e8'; drawing.fillRect(0, 0, 640, 280);
        if (kind === 'blob') {
          // Incompressible, deterministic pixels exercise multiple 192 KiB chunks.
          const pixels = drawing.createImageData(640, 280);
          let seed = 42;
          for (let offset = 0; offset < pixels.data.length; offset += 4) {
            for (let channel = 0; channel < 3; channel++) {
              seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
              pixels.data[offset + channel] = seed & 255;
            }
            pixels.data[offset + 3] = 255;
          }
          drawing.putImageData(pixels, 0, 0);
        }
        drawing.fillStyle = '#fff'; drawing.fillRect(20, 70, 570, 115);
        drawing.fillStyle = '#17212a'; drawing.font = '44px sans-serif'; drawing.fillText('Open the door.', 42, 146);
        const image = document.querySelector('#sample');
        const blob = await new Promise(resolveBlob => canvas.toBlob(resolveBlob, 'image/png'));
        image.src = kind === 'data' ? canvas.toDataURL('image/png') : URL.createObjectURL(blob);
        await image.decode();
        return blob.size;
      }, kind);
      await until(async () => await translateButtons().count() === 1, `${kind} image control`);
      const before = requests.filter(request => /\.(png|svg)$/.test(request.path)).length;
      let statuses;
      if (kind === 'data') await context.setOffline(true);
      try { await clickTranslate(); statuses = await imageStatusMatches(/Text recognized/i); }
      finally { if (kind === 'data') await context.setOffline(false); }
      assert.match(await recognizedText().inputValue(), /Open the door/i);
      assert.equal(requests.filter(request => /\.(png|svg)$/.test(request.path)).length, before, `${kind} preparation must not contact an image host.`);
      if (kind === 'blob') assert.ok(inlineBytes > 192 * 1024, 'Blob fixture must require more than one chunk.');
      let lowConfidence;
      if (kind === 'blob') {
        lowConfidence = (await latestResult()).ocr.lowConfidence;
        assert.equal(lowConfidence, true, 'Noise should remain clearly labeled as uncertain.');
        await page.locator('#aksara-root .quality:visible').waitFor();
        assert.match(await page.locator('#aksara-root .quality').innerText(), /may be inaccurate/);
        await page.screenshot({ path: 'test-results/ocr-low-confidence.png', fullPage: true });
      }
      return { statuses, inlineBytes, imageHostRequests: 0, offline: kind === 'data', lowConfidence };
    });
  }

  await check('explicit cancellation releases the acquisition slot', async () => {
    await openFixture('/slow-cancel.png');
    await clickTranslate();
    await until(() => gates.has('/slow-cancel.png'), 'held image fetch');
    await page.locator('#aksara-root button[aria-label="Cancel image preparation"]').click();
    const statuses = await imageStatusMatches(/cancel/i);
    await assertEmptyStaging();
    release('/slow-cancel.png');
    await openFixture('/after-cancel.png');
    await clickTranslate();
    await imageStatusMatches(/Text recognized/i);
    return { statuses, subsequentImagePrepared: true };
  });

  await check('source replacement discards the pending result', async () => {
    await openFixture('/slow-replace.png');
    await clickTranslate();
    await until(() => gates.has('/slow-replace.png'), 'held replaceable image fetch');
    await page.locator('#sample').evaluate(async image => { image.src = '/replacement.png'; await image.decode(); });
    await until(async () => await translateButtons().count() === 1 && await page.locator('#aksara-root button[aria-label="Cancel image preparation"]').count() === 0, 'replacement image control');
    release('/slow-replace.png');
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
    assert.ok((await imageStatuses().allTextContents()).every(text => !/Text recognized/.test(text)), 'The old response must not mark the replacement ready.');
    await clickTranslate();
    const statuses = await imageStatusMatches(/Text recognized/i);
    return { statuses, staleResultDiscarded: true };
  });

  await check('unsupported SVG fails with a format explanation', async () => {
    await openFixture('/unsupported.svg');
    await clickTranslate();
    return { statuses: await imageStatusMatches(/format|supported|SVG|raster|PNG|JPEG/i) };
  });

  await check('oversized raster header is rejected before decoding', async () => {
    await openFixture('/oversized-header.png');
    await clickTranslate();
    return { statuses: await imageStatusMatches(/large|dimension|pixel|limit/i), fixture: 'A valid displayed PNG; acquisition response changes IHDR dimensions to 20,000 × 20,000.' };
  });

  await page.screenshot({ path: 'test-results/images-validation.png', fullPage: true });
  await check('language controls save and restore Indonesian source and French target', async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#language-settings:not([disabled])').waitFor();
    assert.equal(await popup.locator('#source-language').inputValue(), 'eng_Latn');
    await popup.locator('#source-language').selectOption('ind_Latn');
    await popup.locator('#target-language').selectOption('fra_Latn');
    await until(async () => {
      const stored = await popup.evaluate(() => chrome.storage.local.get('languageSettings'));
      return stored.languageSettings?.sourceLanguage === 'ind_Latn' && stored.languageSettings?.targetLanguage === 'fra_Latn';
    }, 'saved language choices');
    await popup.reload(); await popup.locator('#language-settings:not([disabled])').waitFor();
    assert.equal(await popup.locator('#source-language').inputValue(), 'ind_Latn');
    assert.equal(await popup.locator('#target-language').inputValue(), 'fra_Latn');
    await popup.setViewportSize({ width: 375, height: 812 });
    const audit = await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    report.popupAxe = { violations: audit.violations.map(item => ({ id: item.id, impact: item.impact, description: item.description, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })) };
    assert.deepEqual(report.popupAxe.violations, []);
    await popup.screenshot({ path: 'test-results/ocr-popup.png', fullPage: true });
    await popup.close();
    return { sourceLanguage: 'ind_Latn', targetLanguage: 'fra_Latn', restoredOnReopen: true, axeViolations: 0 };
  });

  await check('Indonesian multiline image returns natural-coordinate boxes and selected target', async () => {
    await openFixture('/ind.png'); await clickTranslate();
    const statuses = await imageStatusMatches(/Text recognized.*Indonesian/i);
    assert.match(await recognizedText().inputValue(), /Buka pintunya\./i);
    assert.match(await recognizedText().inputValue(), /Selamat pagi\./i);
    const result = await latestResult();
    assert.equal(result.ocr.imageWidth, 1200); assert.equal(result.ocr.imageHeight, 480);
    assert.equal(result.ocr.sourceLanguage, 'ind_Latn'); assert.equal(result.ocr.targetLanguage, 'fra_Latn');
    assert.equal(result.ocr.lines.length, 2);
    assert.ok(result.ocr.lines[1].box.y > result.ocr.lines[0].box.y);
    for (const line of result.ocr.lines) assert.ok(line.box.x + line.box.width <= 1200 && line.box.y + line.box.height <= 480);
    await page.screenshot({ path: 'test-results/ocr-indonesian.png', fullPage: true });
    await page.locator('#sample').evaluate(async image => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0); image.src = canvas.toDataURL('image/png'); await image.decode();
    });
    await context.setOffline(true);
    try { await clickTranslate(); await imageStatusMatches(/Text recognized.*Indonesian/i); assert.match(await recognizedText().inputValue(), /Selamat pagi/i); }
    finally { await context.setOffline(false); }
    return { statuses, result, offlineInlineRetry: true };
  });

  await check('blank image explains empty OCR and permits retry', async () => {
    await openFixture('/blank.png'); await clickTranslate();
    const statuses = await imageStatusMatches(/No text found.*language/i);
    assert.equal(await recognizedText().count(), 0);
    const error = await bridge.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
      return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__aksaraTestMessages.filter(message => message.type === 'IMAGE_ERROR').at(-1) }))[0].result;
    }, page.url());
    assert.equal(error.code, 'NO_TEXT_FOUND');
    await page.screenshot({ path: 'test-results/ocr-empty.png', fullPage: true });
    await page.locator('#aksara-root button[aria-label="Dismiss image status"]').press('Enter');
    assert.equal(await page.locator('#aksara-root button[aria-label="Translate image"]').evaluate(button => button.getRootNode().activeElement === button), true);
    return { statuses, code: error.code, focusRestored: true };
  });

  await check('cancelling OCR initialization closes its host and allows a successful retry', async () => {
    await openFixture('/ocr-cancel.png'); await clickTranslate();
    await page.waitForFunction(() => /Starting local|Reading text/.test(document.querySelector('#aksara-root').shadowRoot.querySelector('[role="status"]').textContent));
    await page.screenshot({ path: 'test-results/ocr-loading.png', fullPage: true });
    await page.locator('#aksara-root button[aria-label="Cancel image preparation"]').press('Enter');
    const statuses = await imageStatusMatches(/cancel/i);
    await until(async () => (await bridge.evaluate(() => chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }))).length === 0, 'cancelled OCR host closed');
    await assertEmptyStaging();
    assert.ok((await imageStatuses().allTextContents()).every(status => !/Text recognized/.test(status)));
    await clickTranslate(); await imageStatusMatches(/Text recognized/i);
    return { statuses, offscreenHostClosed: true, retrySucceeded: true };
  });

  await check('service-worker interruption reclaims orphaned OCR and accepts a retry', async () => {
    await openFixture('/ocr-interrupted.png'); await clickTranslate();
    await page.waitForFunction(() => /Starting local|Reading text/.test(document.querySelector('#aksara-root').shadowRoot.querySelector('[role="status"]').textContent));
    const marker = await bridge.evaluate(() => chrome.storage.session.get('activeImageJob'));
    assert.ok(marker.activeImageJob?.id);
    const targets = (await browserSession.send('Target.getTargets')).targetInfos.filter(target => target.type === 'service_worker' && target.url === `chrome-extension://${extensionId}/background.js`);
    assert.ok(targets.length > 0, 'The actual background target must exist for a real interruption.');
    const beforeStop = Date.now();
    report.interruptionTargets = { targets, versions: [...workerVersions.values()] };
    for (const target of targets) await browserSession.send('Target.closeTarget', { targetId: target.targetId });
    console.log(`Worker stop returned after ${Date.now() - beforeStop} ms; page: ${(await imageStatuses().allTextContents()).join(' ')}`);
    const statuses = await imageStatusMatches(/interrupted/i);
    await bridge.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'PING' }));
    await until(async () => !(await bridge.evaluate(() => chrome.storage.session.get('activeImageJob'))).activeImageJob, 'interrupted job recovery');
    await assertEmptyStaging();
    await clickTranslate(); await imageStatusMatches(/Text recognized/i);
    return { statuses, orphanReclaimed: true, retrySucceeded: true };
  });

  await check('English OCR layout and accessibility at narrow, tablet and desktop widths', async () => {
    await bridge.evaluate(() => chrome.storage.local.set({ languageSettings: { sourceLanguage: 'eng_Latn', targetLanguage: 'ind_Latn' } }));
    await openFixture('/responsive.png'); await clickTranslate(); await imageStatusMatches(/Text recognized/i);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await translateButtons().evaluate(button => getComputedStyle(button).transitionDuration), '0s');
    report.viewports = [];
    for (const [width, height] of [[375, 812], [768, 900], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#sample').hover({ position: { x: 8, y: 8 } });
      await until(async () => page.locator('#aksara-root .card').evaluate(card => { const box = card.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; }), `card fits ${width}px`);
      await recognizedText().focus();
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const violations = audit.violations.map(item => ({ id: item.id, impact: item.impact, description: item.description }));
      report.viewports.push({ viewport: `${width}x${height}`, violations, screenshot: `ocr-${width}.png` });
      assert.deepEqual(violations, []);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'Fixture and extension should not overflow horizontally.');
      await page.screenshot({ path: `test-results/ocr-${width}.png`, fullPage: true });
    }
    report.fixturePerformance = { ...await page.evaluate(() => globalThis.__aksaraVitals), note: 'Local fixture measurements; maximum Event Timing is an interaction proxy, not field INP. Null means no qualifying timing entry was observed.' };
    return { viewports: report.viewports, reducedMotion: true };
  });

  await check('responsive currentSrc replacement clears completed OCR text', async () => {
    await page.evaluate(async () => {
      const image = document.querySelector('#sample'), picture = document.createElement('picture'), source = document.createElement('source');
      source.media = '(max-width: 600px)'; source.srcset = '/blank.png';
      image.before(picture); picture.append(source, image);
      await image.decode();
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await until(async () => page.locator('#sample').evaluate(image => image.currentSrc.endsWith('/blank.png') && image.complete), 'responsive source loaded');
    await until(async () => await recognizedText().count() === 0, 'old OCR text removed');
    assert.ok((await imageStatuses().allTextContents()).every(status => !/Text recognized/.test(status)));
    await clickTranslate(); const statuses = await imageStatusMatches(/No text found/i);
    return { staleTextRemoved: true, statuses };
  });

  await check('extension reload interrupts a read and permits controls to be enabled again', async () => {
    await page.setViewportSize({ width: 1060, height: 860 });
    await openFixture('/ocr-interrupted.png'); await clickTranslate();
    await page.waitForFunction(() => /Starting local|Reading text/.test(document.querySelector('#aksara-root').shadowRoot.querySelector('[role="status"]').textContent));
    const previous = await bridge.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'PING' }));
    const oldBridge = bridge;
    // Refresh the same unpacked directory through Chrome's development API.
    await browserSession.send('Extensions.loadUnpacked', { path: extensionPath });
    bridge = await context.newPage();
    await until(async () => {
      try {
        await bridge.goto(`chrome-extension://${extensionId}/popup.html`, { timeout: 3000 });
        const current = await bridge.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'PING' }));
        return current.ok && current.instanceId !== previous.instanceId;
      } catch (error) { report.reloadErrors = [...(report.reloadErrors || []), error.message].slice(-3); return false; }
    }, 'extension reload completed');
    await oldBridge.close().catch(() => {});
    const statuses = await imageStatusMatches(/interrupted/i);
    await page.locator('#sample').evaluate(async image => { image.src = '/after-extension-reload.png'; await image.decode(); });
    await inject();
    assert.equal(await page.locator('#aksara-root').count(), 1);
    await clickTranslate(); await imageStatusMatches(/Text recognized/i);
    assert.match(await recognizedText().inputValue(), /Open the door/i);
    return { statuses, controlsReenabled: true, retrySucceeded: true, reloadMethod: 'Extensions.loadUnpacked on the same test path' };
  });

  assert.deepEqual(report.errors, [], 'No uncaught page error or unexpected model download.');
  report.ok = true;
} catch (error) {
  report.failure = error.stack || error.message;
  process.exitCode = 1;
  console.error(report.failure);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: 'test-results/images-failure.png', fullPage: true }).catch(() => {});
    report.failureStatuses = await imageStatuses().allTextContents().catch(() => []);
  }
} finally {
  for (const path of [...gates.keys()]) release(path);
  await context?.close();
  if (fixtureServer) {
    fixtureServer.closeAllConnections();
    await new Promise(resolveClose => fixtureServer.close(resolveClose));
  }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/images-report.json', JSON.stringify(report, null, 2) + '\n');
}

