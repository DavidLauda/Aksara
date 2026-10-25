import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: sharp } = await import('sharp');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const extensionPath = resolve('dist');
const fixtureOrigin = 'http://page.aksara-fixture.net';
const profile = resolve('.test-profile-current');
const report = {
  generatedAt: new Date().toISOString(), phase: 5, browser: null, extensionVersion: null,
  hardware: { platform: os.platform(), cpu: os.cpus()[0].model, totalMemoryBytes: os.totalmem() },
  cases: [], errors: [], externalRequests: [], screenshots: [], ok: false,
  note: 'Primary and retry journeys use real packaged Tesseract and cached NLLB/WebGPU. Geometry reuses those actual results. Only explicitly labeled hostile/long-text rendering cases substitute UI fixture data; they are not inference claims. The existing model cache is preserved.',
};
let context, page, bridge, browserSession, extensionId, realImage;
const imageBytes = await sharp({ create: { width: 900, height: 440, channels: 3, background: '#fbfaf4' } })
  .composite([{ input: Buffer.from('<svg width="900" height="440"><g font-family="Arial" font-size="62" fill="#19251f"><text x="55" y="150">Open the door.</text><text x="55" y="310">Good morning.</text></g></svg>') }]).png().toBuffer();
const imageUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;
const replacementUrl = `data:image/png;base64,${(await sharp({ create: { width: 900, height: 440, channels: 3, background: '#efeee7' } }).png().toBuffer()).toString('base64')}`;
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aksara aligned translation preview</title><style>
  *{box-sizing:border-box}body{margin:28px;background:#edf1eb;color:#263d30;font:17px/1.5 system-ui}main{max-width:1000px;margin:auto}h1{font-size:28px;margin-bottom:8px}p{max-width:60ch}#clipper{position:relative;margin-top:26px}img{display:block;width:900px;max-width:100%;height:auto;object-fit:fill;object-position:50% 50%}small{display:block;margin-top:20px;color:#476050}.spacer{height:1600px}#clipboard-target{display:block;width:100%;min-height:80px}#clipboard-test{margin-top:24px}button,textarea{font:inherit}
  </style></head><body><main><h1>Read images in your language</h1><p>Aksara places the translation over the original text, on this device.</p><div id="before-image"></div><div id="clipper"><img id="sample" width="900" height="440" alt="Open the door. Good morning." src="${imageUrl}"></div><small>Local preview · No image or text is uploaded</small><div id="clipboard-test" hidden><label for="clipboard-target">Clipboard test destination</label><textarea id="clipboard-target"></textarea></div><div class="spacer"></div></main></body></html>`);
});

async function until(predicate, description, timeout = 30_000, interval = 100) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${description}`);
    await new Promise(resolveWait => setTimeout(resolveWait, interval));
  }
}
const message = (type, fields = {}) => bridge.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type, ...fields }), { type, fields });
const translateButton = () => page.locator('#aksara-root button[aria-label="Translate image"]');
const status = () => page.locator('#aksara-root [role="status"]');
const segments = () => page.locator('#aksara-root .translated-segment');
const overlay = () => page.locator('#aksara-root .image-overlay');
const control = name => page.locator(`#aksara-root .${name}`);

async function inContent(func, args = []) {
  return bridge.evaluate(async ({ url, code, args }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    if (!tab?.id) throw new Error('The fixture tab is unavailable.');
    // executeScript requires a serializable function. The fixed dispatcher below
    // exposes only harness operations, with no eval or code in the extension.
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (operation, args) => {
      if (operation === 'messages') return globalThis.__aksaraTestMessages;
      if (operation === 'clear') { globalThis.__aksaraTestMessages = []; return; }
      if (operation === 'fixture') { globalThis.__aksaraFixtureImage = args[0]; return; }
    }, args: [code, args] }))[0].result;
  }, { url: page.url(), code: func, args });
}
const captured = () => inContent('messages');
const clearCaptured = () => inContent('clear');

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 },
    args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`],
  });
  report.browser = context.browser().version();
  context.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== fixtureOrigin) report.externalRequests.push({ origin: url.origin, path: url.pathname, method: request.method() });
  });
  context.on('page', surface => {
    surface.on('pageerror', error => report.errors.push(error.message));
    surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text().slice(0, 500)); });
  });
  browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Target.setDiscoverTargets', { discover: true, filter: [{}] });
  ({ id: extensionId } = await browserSession.send('Extensions.loadUnpacked', { path: extensionPath }));
  bridge = await context.newPage();
  await bridge.goto(`chrome-extension://${extensionId}/popup.html`);
  const ping = await message('PING'); assert.equal(ping.ok, true); report.extensionVersion = ping.version;
  const diagnostics = await context.newCDPSession(bridge);
  diagnostics.on('ServiceWorker.workerErrorReported', event => report.errors.push(`Background: ${event.errorMessage?.errorMessage || JSON.stringify(event)}`));
  await diagnostics.send('ServiceWorker.enable');
  // This is the task-owned isolated profile; restore only fixture preferences.
  await bridge.evaluate(origin => chrome.storage.local.set({ languageSettings: { sourceLanguage: 'eng_Latn', targetLanguage: 'ind_Latn' }, siteSettings: { disabledOrigins: [] }, overlaySettings: { highContrast: false } }), fixtureOrigin);
  assert.equal((await message('GET_MODEL_STATUS')).model.ready, true, 'Prepare the explicit model download in the isolated profile before running overlay tests.');
  page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__aksaraVitals = { lcpMs: null, cumulativeLayoutShift: 0, maxEventTimingMs: null };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) globalThis.__aksaraVitals.lcpMs = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__aksaraVitals.cumulativeLayoutShift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    if (PerformanceObserver.supportedEntryTypes.includes('event')) new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) globalThis.__aksaraVitals.maxEventTimingMs = Math.max(globalThis.__aksaraVitals.maxEventTimingMs || 0, entry.duration); }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  });
  await page.goto(fixtureOrigin);
  await page.locator('#sample').evaluate(image => image.decode());
  await activate();
}
async function activate() {
  await page.bringToFront();
  const tabs = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos;
  const target = tabs.find(target => target.url === page.url()); assert.ok(target);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  await inject();
}
async function inject() {
  await bridge.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      globalThis.__aksaraTestMessages = [];
      if (globalThis.__aksaraCaptureInstalled) return;
      globalThis.__aksaraCaptureInstalled = true;
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = (...args) => {
        const port = connect(...args);
        const add = port.onMessage.addListener.bind(port.onMessage);
        const contentListeners = [];
        add(message => globalThis.__aksaraTestMessages.push(message));
        port.onMessage.addListener = listener => { contentListeners.push(listener); add(listener); };
        const post = port.postMessage.bind(port);
        port.postMessage = message => {
          // Only rendering-only hostile/long-text cases select this explicit UI
          // fixture. All ordinary requests retain the real extension pipeline.
          if (message.type === 'PREPARE_IMAGE' && globalThis.__aksaraFixtureImage) {
            const image = globalThis.__aksaraFixtureImage; globalThis.__aksaraFixtureImage = null;
            const reply = { schemaVersion: 1, target: 'content', type: 'IMAGE_READY', requestId: message.requestId, image, testRenderingFixture: true };
            globalThis.__aksaraTestMessages.push(reply);
            queueMicrotask(() => { for (const listener of contentListeners) listener(reply); });
          } else post(message);
        };
        return port;
      };
    } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  }, page.url());
  await until(async () => await translateButton().count() === 1, 'one eligible image control');
}
async function startImage(selector = translateButton(), keyboard = false) {
  await clearCaptured();
  await page.locator('#sample').hover({ position: { x: 8, y: 8 } });
  if (keyboard) { await selector.focus(); await selector.press('Enter'); } else await selector.click();
}
async function imageResult() {
  let reply, previous = '';
  await until(async () => {
    const messages = await captured();
    reply = messages.findLast(message => ['IMAGE_READY', 'IMAGE_ERROR'].includes(message.type));
    const stage = messages.findLast(message => message.type === 'IMAGE_PROGRESS')?.stage;
    if (stage && stage !== previous) { previous = stage; console.log(`Image stage: ${stage}`); }
    return Boolean(reply);
  }, 'image translation result', 390_000, 400);
  assert.equal(reply.type, 'IMAGE_READY', `${reply.code}: ${reply.userMessage}`);
  assert.ok(reply.image.translation, JSON.stringify(reply.image.translationError));
  return reply.image;
}
async function capture(name, surface = page, fullPage = false) {
  await surface.screenshot({ path: `test-results/${name}.png`, fullPage });
  report.screenshots.push(`${name}.png`);
}
async function check(name, task) {
  const started = Date.now();
  try { const result = await task(); report.cases.push({ name, ok: true, elapsedMs: Date.now() - started, ...result }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, ok: false, elapsedMs: Date.now() - started, error: error.message }); throw error; }
}
async function restyle(style = '', parentStyle = '') {
  await page.evaluate(({ style, parentStyle }) => {
    document.querySelector('#sample').style.cssText = style;
    document.querySelector('#clipper').style.cssText = parentStyle;
    document.querySelector('#before-image').style.cssText = '';
    window.scrollTo(0, 0);
  }, { style, parentStyle });
  await page.waitForTimeout(120);
}

/** Browser-observed standard CSS boxes, independent of the production helper. */
async function measureExpected(fit = 'fill', position = [0.5, 0.5], positionUnit = 'fraction') {
  return page.locator('#sample').evaluate((image, { fit, position, positionUnit, result }) => {
    const rect = image.getBoundingClientRect(), css = getComputedStyle(image), px = name => parseFloat(css[name]) || 0;
    const scaleX = rect.width / image.offsetWidth, scaleY = rect.height / image.offsetHeight;
    const leftInset = px('borderLeftWidth') + px('paddingLeft'), topInset = px('borderTopWidth') + px('paddingTop');
    const width = (image.offsetWidth - leftInset - px('borderRightWidth') - px('paddingRight')) * scaleX;
    const height = (image.offsetHeight - topInset - px('borderBottomWidth') - px('paddingBottom')) * scaleY;
    const content = { x: rect.left + leftInset * scaleX, y: rect.top + topInset * scaleY, width, height };
    let objectWidth = result.ocr.imageWidth * scaleX, objectHeight = result.ocr.imageHeight * scaleY;
    if (fit === 'fill') { objectWidth = width; objectHeight = height; }
    else if (fit !== 'none') {
      const ratio = fit === 'cover' ? Math.max(width / objectWidth, height / objectHeight) : Math.min(width / objectWidth, height / objectHeight, ...(fit === 'scale-down' ? [1] : []));
      objectWidth *= ratio; objectHeight *= ratio;
    }
    const offsetX = positionUnit === 'px' ? position[0] * scaleX : (width - objectWidth) * position[0];
    const offsetY = positionUnit === 'px' ? position[1] * scaleY : (height - objectHeight) * position[1];
    return { content, painted: { x: content.x + offsetX, y: content.y + offsetY, width: objectWidth, height: objectHeight }, boxes: result.translation.segments.map(segment => ({ id: segment.segmentId, x: content.x + offsetX + segment.box.x / result.ocr.imageWidth * objectWidth, y: content.y + offsetY + segment.box.y / result.ocr.imageHeight * objectHeight, width: segment.box.width / result.ocr.imageWidth * objectWidth, height: segment.box.height / result.ocr.imageHeight * objectHeight })) };
  }, { fit, position, positionUnit, result: realImage });
}
async function assertAligned(expected, tolerance = 2) {
  let actual;
  await until(async () => {
    actual = await segments().evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { id: node.dataset.segmentId, x: r.left, y: r.top, width: r.width, height: r.height }; }));
    return expected.boxes.every(box => {
      const segment = actual.find(segment => segment.id === box.id);
      return segment && ['x', 'y', 'width', 'height'].every(key => Math.abs(segment[key] - box[key]) <= tolerance);
    });
  }, `translated segment geometry ${JSON.stringify(expected.boxes)}; actual ${JSON.stringify(actual)}`, 8000);
  return actual;
}

try {
  await mkdir('test-results', { recursive: true });
  await new Promise((resolveServer, reject) => { server.once('error', reject); server.listen(80, '127.0.0.1', resolveServer); });
  await launch();
  await check('real two-line OCR and NLLB translation becomes aligned text safely', async () => {
    await startImage(translateButton(), true); realImage = await imageResult();
    assert.equal(realImage.translation.segments.length, 2);
    assert.match(realImage.translation.segments[0].translatedText, /buka|pintu/i);
    assert.match(realImage.translation.segments[1].translatedText, /selamat|pagi/i);
    await until(async () => await segments().count() === 2, 'two positioned translation regions');
    const expected = await measureExpected(); const actual = await assertAligned(expected);
    await capture('overlay-success');
    return { image: realImage, expected, actual, renderingFixture: false };
  });
  await check('original toggle preserves result and retry runs the real local engine', async () => {
    await control('toggle-original').press('Enter');
    await until(async () => !await overlay().isVisible(), 'original image revealed');
    assert.match(await control('toggle-original').textContent(), /Show translation/i);
    await control('toggle-original').press('Enter');
    await until(async () => await overlay().isVisible(), 'translation restored');
    await startImage(control('retry-translation'), true); realImage = await imageResult();
    await assertAligned(await measureExpected());
    return { retryResult: realImage.translation, renderingFixture: false };
  });
  await check('copy produces the complete known translation and details remain keyboard reachable', async () => {
    await control('copy-translation').press('Enter');
    await until(async () => /copied/i.test((await status().allTextContents()).join(' ')), 'copy success is confirmed before reading the clipboard');
    await page.locator('#clipboard-test').evaluate(node => { node.hidden = false; });
    await page.locator('#clipboard-target').focus(); await page.locator('#clipboard-target').press('Control+V');
    assert.equal(await page.locator('#clipboard-target').inputValue(), realImage.translation.text);
    await page.locator('#clipboard-test').evaluate(node => { node.hidden = true; });
    await control('details-toggle').press('Enter');
    assert.equal(await control('details-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#aksara-root textarea[aria-label="Translated text"]').focus();
    assert.equal(await page.locator('#aksara-root textarea[aria-label="Translated text"]').inputValue(), realImage.translation.text);
    await control('details-toggle').press('Enter');
    return { copiedKnownFixture: true, detailsOpenedAndClosed: true };
  });
  await check('object-fit, noncenter object-position, borders and padding map natural OCR coordinates', async () => {
    const matrix = [
      { name: 'fill', fit: 'fill', position: [0.5, 0.5], css: 'width:640px;height:360px;max-width:none;object-fit:fill;border:8px solid #6c8472;padding:12px;box-sizing:content-box' },
      { name: 'contain 25% 75%', fit: 'contain', position: [0.25, 0.75], css: 'width:640px;height:420px;max-width:none;object-fit:contain;object-position:25% 75%;border:8px solid #6c8472;padding:12px;box-sizing:content-box' },
      { name: 'cover right bottom', fit: 'cover', position: [1, 1], css: 'width:640px;height:420px;max-width:none;object-fit:cover;object-position:right bottom' },
      { name: 'none pixels', fit: 'none', position: [12, 24], unit: 'px', css: 'width:760px;height:520px;max-width:none;object-fit:none;object-position:12px 24px' },
      { name: 'scale-down no upscale', fit: 'scale-down', position: [0, 0], css: 'width:960px;height:600px;max-width:none;object-fit:scale-down;object-position:left top' },
      { name: 'scale-down shrinking', fit: 'scale-down', position: [0.5, 0.5], css: 'width:640px;height:380px;max-width:none;object-fit:scale-down;object-position:center' },
    ];
    const evidence = [];
    for (const item of matrix) {
      await restyle(item.css); const expected = await measureExpected(item.fit, item.position, item.unit); const actual = await assertAligned(expected);
      evidence.push({ name: item.name, expected, actual });
    }
    await capture('overlay-object-fit'); return { matrix: evidence };
  });
  await check('scroll, DOM movement, resize and positive CSS scaling keep overlays aligned', async () => {
    await restyle('width:640px;height:360px;max-width:none;object-fit:fill;border:6px solid #6c8472;padding:10px;box-sizing:content-box;transform:scale(0.8,1.1);transform-origin:top left');
    const scaled = await assertAligned(await measureExpected());
    await page.evaluate(() => window.scrollTo(0, 110));
    const scrolled = await assertAligned(await measureExpected());
    await page.locator('#before-image').evaluate(node => { node.style.height = '95px'; });
    const moved = await assertAligned(await measureExpected());
    await page.locator('#sample').evaluate(image => { image.style.width = '560px'; image.style.height = '300px'; });
    const resized = await assertAligned(await measureExpected());
    await restyle('width:640px;height:360px;max-width:none;object-fit:fill', 'transform:scale(.9);transform-origin:top left');
    const ancestorScale = await assertAligned(await measureExpected());
    return { scaled, scrolled, moved, resized, ancestorScale };
  });
  await check('clipped ancestors hide translated pixels outside the displayed image area', async () => {
    await restyle('width:700px;height:auto;max-width:none', 'width:430px;height:230px;overflow:hidden;border:7px solid #6c8472;padding:0');
    await assertAligned(await measureExpected());
    const clipping = await page.evaluate(() => {
      const clip = document.querySelector('#clipper').getBoundingClientRect();
      const layer = document.querySelector('#aksara-root').shadowRoot.querySelector('.image-overlay');
      const style = getComputedStyle(layer), rect = layer.getBoundingClientRect();
      return { clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, layer: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, overflow: style.overflow, clipPath: style.clipPath };
    });
    // Geometry remains full OCR geometry; a parent clip must bound painted text.
    assert.ok(clipping.overflow.includes('hidden') || clipping.overflow.includes('clip') || clipping.clipPath !== 'none', 'The overlay must have a real CSS clipping boundary.');
    await capture('overlay-ancestor-clip'); return { clipping };
  });
  await check('unsupported rotation falls back to selectable translated text', async () => {
    await restyle('width:640px;height:auto;max-width:none;transform:rotate(7deg)');
    await until(async () => !await overlay().isVisible(), 'unsafe rotated overlay hidden');
    await until(async () => await page.locator('#aksara-root textarea[aria-label="Translated text"]').isVisible(), 'fallback text is available');
    assert.equal(await page.locator('#aksara-root textarea[aria-label="Translated text"]').inputValue(), realImage.translation.text);
    await capture('overlay-unsupported');
    await restyle(); await until(async () => await overlay().isVisible(), 'supported layout restores overlay');
    return { originalResultRetained: true };
  });
  await check('high contrast persists, and page and popup fit three widths with no axe violations', async () => {
    await control('overlay-contrast').press('Enter');
    assert.equal(await control('overlay-contrast').getAttribute('aria-pressed'), 'true');
    const saved = await bridge.evaluate(() => chrome.storage.local.get('overlaySettings'));
    assert.equal(saved.overlaySettings.highContrast, true);
    await capture('overlay-high-contrast');
    await control('overlay-contrast').press('Enter');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sizes = [];
    for (const [width, height] of [[375, 812], [768, 900], [1440, 900]]) {
      await page.setViewportSize({ width, height }); await assertAligned(await measureExpected());
      await until(async () => page.locator('#aksara-root .card').evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), 'controls remain within the viewport');
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await capture(`overlay-${width}`); sizes.push({ width, height, axeViolations: 0 });
    }
    await page.bringToFront(); await bridge.reload(); await bridge.setViewportSize({ width: 375, height: 900 });
    const popupAxe = await new AxeBuilder({ page: bridge }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(popupAxe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), []);
    await capture('overlay-popup', bridge);
    return { sizes, popupAxeViolations: 0, highContrastSaved: true, visualRegression: 'INCONCLUSIVE: no approved matching baseline' };
  });
  await check('per-site disable removes controls and survives popup reload without affecting other origins', async () => {
    await page.bringToFront(); await bridge.reload();
    await bridge.locator('#site-enabled:not([disabled])').waitFor();
    assert.equal(await bridge.locator('#site-enabled').isChecked(), true);
    await bridge.locator('#site-enabled').uncheck();
    await until(async () => await translateButton().count() === 0 && await segments().count() === 0, 'site disable clears overlays and controls');
    assert.equal(await bridge.locator('#enable-tab').isDisabled(), true);
    const saved = await bridge.evaluate(() => chrome.storage.local.get('siteSettings'));
    assert.deepEqual(saved.siteSettings.disabledOrigins, [fixtureOrigin]);
    await page.bringToFront(); await bridge.reload(); await bridge.locator('#site-enabled:not([disabled])').waitFor();
    assert.equal(await bridge.locator('#site-enabled').isChecked(), false);
    await capture('overlay-site-disabled', bridge);
    await bridge.locator('#site-enabled').check();
    await until(async () => !await bridge.locator('#enable-tab').isDisabled(), 'site re-enabled for manual activation');
    await page.bringToFront(); await bridge.locator('#enable-tab').click();
    await until(async () => await translateButton().count() === 1, 'controls can be activated again');
    return { disabledOrigin: fixtureOrigin, persisted: true, noAutomaticInference: true };
  });
  await check('hostile and long translated strings remain literal bounded rendering fixtures', async () => {
    await page.setViewportSize({ width: 1100, height: 900 }); await restyle();
    const hostile = '<img src=x onerror="window.__aksaraInjected=true"> & <script>window.__aksaraInjected=true</script>';
    const fixture = structuredClone(realImage);
    fixture.translation.text = `${hostile}\n${'Long translated words '.repeat(80)}`;
    fixture.translation.segments[0].translatedText = hostile;
    fixture.translation.segments[1].translatedText = 'Long translated words '.repeat(80);
    await inContent('fixture', [fixture]); await startImage(); await imageResult();
    await until(async () => await segments().count() === 2, 'synthetic long-text regions');
    assert.equal(await segments().first().textContent(), hostile);
    assert.equal(await page.locator('#aksara-root img, #aksara-root script').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(globalThis.__aksaraInjected)), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await control('details-toggle').click();
    assert.equal(await page.locator('#aksara-root textarea[aria-label="Translated text"]').inputValue(), fixture.translation.text);
    await capture('overlay-literal-long-text');
    return { renderingFixture: true, noInferenceClaim: true, literalHtml: true, textLength: fixture.translation.text.length };
  });
  await check('Dismiss clears overlays and restores focus; source replacement invalidates completed text', async () => {
    await control('dismiss').press('Enter');
    await until(async () => await segments().count() === 0, 'dismiss removes translated regions');
    assert.equal(await translateButton().evaluate(node => node.getRootNode().activeElement === node), true);
    await inContent('fixture', [realImage]); await startImage(); await imageResult();
    await until(async () => await segments().count() === 2, 'replayed completed rendering fixture');
    await page.locator('#sample').evaluate(async (image, source) => { image.src = source; await image.decode(); }, replacementUrl);
    await until(async () => await segments().count() === 0, 'source replacement clears stale translated regions');
    return { focusRestored: true, renderingFixtureReplayForInvalidation: true };
  });
  report.fixturePerformance = { ...await page.evaluate(() => globalThis.__aksaraVitals), note: 'Controlled local fixture including intentional layout mutations. Event Timing is not field INP; null means no qualifying event.' };
  assert.deepEqual(report.externalRequests, [], 'Overlay tests use existing local model files and inline pixels only.');
  assert.deepEqual(report.errors, [], 'No uncaught page or extension errors.');
  report.ok = true;
} catch (error) {
  report.failure = error.stack || error.message; process.exitCode = 1; console.error(report.failure);
  if (page && !page.isClosed()) { await capture('overlay-failure').catch(() => {}); report.failureStatuses = await status().allTextContents().catch(() => []); }
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
  await writeFile('test-results/overlay-report.json', JSON.stringify(report, null, 2) + '\n');
}
