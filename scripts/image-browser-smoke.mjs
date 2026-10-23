import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: sharp } = await import('sharp');

// Keep fixture permissions and data out of the distributable extension.
const extensionPath = resolve('.test-extension-images');
const profilePath = resolve('.test-profile-images');
const fixtureOrigin = 'http://page.aksara-fixture.net';
const cdnOrigin = 'http://cdn.aksara-fixture.net';
const deniedOrigin = 'http://denied.aksara-fixture.net';
const png = await sharp({ create: { width: 640, height: 280, channels: 4, background: '#f3f4e8' } })
  .composite([{ input: Buffer.from('<svg width="640" height="280"><text x="42" y="146" font-size="44">Open the door.</text></svg>') }]).png().toBuffer();
const tinyPng = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#eee' } }).png().toBuffer();
const oversizedHeader = Buffer.from(png);
oversizedHeader.writeUInt32BE(20_000, 16);
oversizedHeader.writeUInt32BE(20_000, 20);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280"><rect width="640" height="280" fill="#f3f4e8"/><text x="42" y="146" font-size="44">Open the door.</text></svg>';
const requests = [];
const counts = new Map();
const gates = new Map();
const report = { generatedAt: new Date().toISOString(), browser: null, cases: [], errors: [], requests, ok: false };
let context;
let page;
let fixtureServer;

function fixtureHtml(source, { tiny = false } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Aksara image acquisition fixtures</title><style>
    body{margin:36px;font:18px system-ui;background:#edf1f4;color:#17212a}h1{font-size:26px}img{display:block;max-width:100%;margin:22px 0}#sample{width:640px;height:280px}#tiny{width:24px;height:24px}
    </style></head><body><h1>Aksara image acquisition</h1><p>Only a click should prepare image pixels.</p><img id="sample" alt="Open the door" src="${source}">${tiny ? '<img id="tiny" alt="Small icon" src="/tiny.png">' : ''}</body></html>`;
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
    const body = url.pathname === '/tiny.png' ? tinyPng
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

async function until(predicate, description, timeout = 12_000) {
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

async function imageStatusMatches(expression) {
  await until(async () => (await imageStatuses().allTextContents()).some(text => expression.test(text)), `image status matching ${expression}`);
  return imageStatuses().allTextContents();
}

async function inject() {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const tabId = await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab?.id) throw new Error('Fixture tab was not found.');
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
  await page.locator(index ? '#late' : '#sample').hover();
  await button.click();
}

async function assertEmptyStaging() {
  let count;
  await until(async () => {
    const currentWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    count = await currentWorker.evaluate(async () => {
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
  await rm(extensionPath, { recursive: true, force: true });
  await cp(resolve('dist'), extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...manifest.host_permissions, `${fixtureOrigin}/*`, `${cdnOrigin}/*`])];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await startServer();
  context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium', headless: true, viewport: { width: 1060, height: 860 },
    args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  report.browser = context.browser().version();
  const browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Extensions.loadUnpacked', { path: extensionPath });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  context.on('request', request => {
    if (/huggingface\.co|\.hf\.co/.test(request.url())) report.errors.push(`Unexpected model request: ${new URL(request.url()).origin}`);
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

  await check('keyboard Enter prepares same-origin image in background decoder', async () => {
    await translateButtons().first().focus();
    await translateButtons().first().press('Enter');
    const statuses = await imageStatusMatches(/Image ready.*640\s*[×x]\s*280/i);
    return { statuses, input: 'keyboard Enter' };
  });

  await check('late image insertion and reinjection stay idempotent', async () => {
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.id = 'late'; image.src = '/late.png'; image.width = 640; image.height = 280; image.alt = 'Late image';
      document.body.append(image);
      return image.decode();
    });
    await until(async () => await translateButtons().count() === 2, 'late image control');
    const currentWorker = context.serviceWorkers()[0];
    await currentWorker.evaluate(async url => {
      const tabs = await chrome.tabs.query({});
      await chrome.scripting.executeScript({ target: { tabId: tabs.find(tab => tab.url === url).id }, files: ['content.js'] });
    }, page.url());
    assert.equal(await page.locator('#aksara-root').count(), 1);
    await until(async () => await translateButtons().count() === 2, 'reinjected image controls');
    assert.equal(await translateButtons().count(), 2);
    await clickTranslate(1);
    await until(async () => (await imageStatuses().allTextContents()).filter(text => /Image ready/.test(text)).length === 1, 'late image result after reinjection');
    return { eligibleControls: 2, roots: 1 };
  });

  await check('granted CDN image succeeds without page CORS', async () => {
    await openFixture(`${cdnOrigin}/cdn.png`);
    await clickTranslate();
    const statuses = await imageStatusMatches(/Image ready.*640\s*[×x]\s*280/i);
    const fetch = requests.filter(request => request.origin === cdnOrigin && request.path === '/cdn.png').at(-1);
    assert.equal(fetch.referrer, null, 'Extension image fetch must omit the page referrer.');
    return { statuses, requestCount: counts.get('cdn.aksara-fixture.net/cdn.png'), acquisitionReferrer: fetch.referrer };
  });

  await check('missing CDN grant produces an actionable popup request', async () => {
    const granted = await context.serviceWorkers()[0].evaluate(origin => chrome.permissions.contains({ origins: [`${origin}/*`] }), deniedOrigin);
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
        drawing.fillStyle = '#17212a'; drawing.font = '44px sans-serif'; drawing.fillText('Open the door.', 42, 146);
        const image = document.querySelector('#sample');
        const blob = await new Promise(resolveBlob => canvas.toBlob(resolveBlob, 'image/png'));
        image.src = kind === 'data' ? canvas.toDataURL('image/png') : URL.createObjectURL(blob);
        await image.decode();
        return blob.size;
      }, kind);
      await until(async () => await translateButtons().count() === 1, `${kind} image control`);
      const before = requests.filter(request => /\.(png|svg)$/.test(request.path)).length;
      await clickTranslate();
      const statuses = await imageStatusMatches(/Image ready.*640\s*[×x]\s*280/i);
      assert.equal(requests.filter(request => /\.(png|svg)$/.test(request.path)).length, before, `${kind} preparation must not contact an image host.`);
      if (kind === 'blob') assert.ok(inlineBytes > 192 * 1024, 'Blob fixture must require more than one chunk.');
      return { statuses, inlineBytes, imageHostRequests: 0 };
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
    await imageStatusMatches(/Image ready/i);
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
    assert.ok((await imageStatuses().allTextContents()).every(text => !/Image ready/.test(text)), 'The old response must not mark the replacement ready.');
    await clickTranslate();
    const statuses = await imageStatusMatches(/Image ready.*640\s*[×x]\s*280/i);
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

