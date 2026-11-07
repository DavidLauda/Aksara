import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const profile = resolve('.test-profile-glass'), extensionPath = resolve('dist'), origin = 'http://page.aksara-fixture.net';
const recorded = JSON.parse(await readFile('docs/evidence/region-ocr-fix/overlay-report.json', 'utf8'));
const real = recorded.cases.find(item => item.image?.translation && item.image.width === 360).image;
const png = `data:image/png;base64,${(await readFile('tests/fixtures/comic-context.png')).toString('base64')}`;
const report = { generatedAt: new Date().toISOString(), note: 'UI rendering replay of a saved actual OCR/NLLB result. These cases do not run or grade inference. Real pipeline regression runs separately.', cases: [], errors: [], externalRequests: [], ok: false };
let context, page, bridge, browserSession, extensionId;
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aksara overlay controls</title><style>body{margin:24px;background:#eef1ed;color:#193d30;font:16px/1.5 system-ui}main{max-width:1000px;margin:auto}h1{font-size:24px}img{display:block;width:520px;max-width:100%;height:auto;margin:24px 0}button,textarea{font:inherit}#clipboard-destination{display:block;width:100%;min-height:60px}</style><main><h1>Read the image</h1><p>The page stays in place while Aksara translates.</p><img id="sample" src="${png}" alt="Comic panel"><button id="outside">Page action</button><div id="clipboard-test" hidden><label for="clipboard-destination">Copied fixture text</label><textarea id="clipboard-destination"></textarea></div></main></html>`);
});
async function until(predicate, name, timeout = 15_000) {
  const started = Date.now(); while (!await predicate()) { if (Date.now() - started > timeout) throw new Error(`Timed out: ${name}`); await new Promise(resolveWait => setTimeout(resolveWait, 80)); }
}
async function inContent(operation, value) {
  return bridge.evaluate(async ({ url, operation, value }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (operation, value) => {
      if (operation === 'fixture') globalThis.__aksaraGlassFixture = value;
      if (operation === 'clipboard-block') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Fixture clipboard denial'); } } });
    }, args: [operation, value ?? null] }))[0].result;
  }, { url: page.url(), operation, value });
}
const root = () => page.locator('#aksara-root');
const controls = name => root().locator(`.${name}`);
async function openFixture(image = real) {
  await page.goto(origin); await page.locator('#sample').evaluate(image => image.decode());
  await page.bringToFront();
  const targets = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos;
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: targets.find(target => target.url === page.url()).targetId });
  await bridge.evaluate(async ({ url, image }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: image => {
      globalThis.__aksaraGlassFixture = image;
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = (...args) => {
        const port = connect(...args), listeners = [], add = port.onMessage.addListener.bind(port.onMessage), post = port.postMessage.bind(port);
        port.onMessage.addListener = listener => { listeners.push(listener); add(listener); };
        port.postMessage = message => {
          if (message.type !== 'PREPARE_IMAGE') { post(message); return; }
          const fixture = globalThis.__aksaraGlassFixture;
          if (fixture === 'held') return;
          queueMicrotask(() => { for (const listener of listeners) listener({ schemaVersion: 1, target: 'content', type: fixture?.fixtureError ? 'IMAGE_ERROR' : 'IMAGE_READY', requestId: message.requestId,
            ...(fixture?.fixtureError ? { code: 'NO_TEXT_FOUND', userMessage: fixture.userMessage ?? 'No text found. Check the image language or try a clearer image.' } : { image: fixture }) }); });
        }; return port;
      };
    }, args: [image] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  }, { url: page.url(), image });
  await controls('translate').waitFor();
}
async function translate() { await controls('translate').focus(); await controls('translate').press('Enter'); await until(() => controls('toggle-original').isVisible(), 'compact result'); }
async function capture(name) { await page.screenshot({ path: `test-results/glass-${name}.png` }); }
async function check(name, run) { const started = Date.now(); try { report.cases.push({ name, ok: true, ...await run(), elapsedMs: Date.now() - started }); console.log(`PASS ${name}`); } catch (error) { report.cases.push({ name, ok: false, error: error.message }); throw error; } }
try {
  await mkdir('test-results', { recursive: true }); assert.equal(profile, resolve('.test-profile-glass')); await rm(profile, { recursive: true, force: true });
  await new Promise((yes, no) => { server.once('error', no); server.listen(80, '127.0.0.1', yes); });
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 }, args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`] });
  report.browser = context.browser().version();
  context.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.origin !== origin) report.externalRequests.push(url.origin + url.pathname); });
  context.on('page', surface => { surface.on('pageerror', error => report.errors.push(error.message)); surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text()); }); });
  browserSession = await context.browser().newBrowserCDPSession();
  ({ id: extensionId } = await browserSession.send('Extensions.loadUnpacked', { path: extensionPath }));
  bridge = await context.newPage(); await bridge.goto(`chrome-extension://${extensionId}/popup.html`);
  report.version = await bridge.evaluate(() => chrome.runtime.getManifest().version);
  page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__aksaraGlassVitals = { lcpMs: null, cumulativeLayoutShift: 0, maxEventTimingMs: null, longTasks: [] };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) globalThis.__aksaraGlassVitals.lcpMs = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__aksaraGlassVitals.cumulativeLayoutShift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    if (PerformanceObserver.supportedEntryTypes.includes('event')) new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) globalThis.__aksaraGlassVitals.maxEventTimingMs = Math.max(globalThis.__aksaraGlassVitals.maxEventTimingMs ?? 0, entry.duration); }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => { globalThis.__aksaraGlassVitals.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))); }).observe({ type: 'longtask', buffered: true });
  });
  await check('compact result replaces the card and exposes only primary actions', async () => {
    await openFixture(); await capture('idle'); await translate();
    assert.equal(await controls('translate').isVisible(), false); assert.equal(await controls('card').isVisible(), false);
    assert.equal(await root().getByText('Text details', { exact: true }).count(), 0); assert.equal(await controls('quality').count(), 0);
    assert.deepEqual(await controls('actionbar').locator('button:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['Show original', 'Copy translation', 'More options', 'Dismiss translation']);
    const box = await controls('actionbar').boundingBox(); assert.ok(box.height <= 46 && box.width < 270);
    await capture('success'); await page.locator('#sample').screenshot({ path: 'test-results/glass-preview.png' }); return { toolbar: box, defaultPanelVisible: false };
  });
  await check('options support keyboard, Escape, outside click and stable anchoring', async () => {
    const before = await controls('actionbar').boundingBox(); await controls('more').focus(); await controls('more').press('Enter');
    assert.equal(await controls('more').getAttribute('aria-expanded'), 'true'); assert.equal(await controls('retry-translation').evaluate(node => node.getRootNode().activeElement === node), true);
    await capture('options'); await controls('retry-translation').press('ArrowDown'); assert.equal(await controls('overlay-contrast').evaluate(node => node.getRootNode().activeElement === node), true);
    await controls('overlay-contrast').press('Escape'); assert.equal(await controls('more').getAttribute('aria-expanded'), 'false');
    assert.equal(await controls('more').evaluate(node => node.getRootNode().activeElement === node), true);
    await controls('more').click(); const after = await controls('actionbar').boundingBox(); assert.ok(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1);
    await page.locator('#outside').click(); assert.equal(await controls('card').isVisible(), false); return { stableAnchor: true };
  });
  await check('Original and Copy work with unobtrusive feedback', async () => {
    await controls('toggle-original').click(); await until(() => controls('image-overlay').isHidden(), 'original shown'); await controls('toggle-original').click();
    await controls('copy-translation').click(); await controls('copy-translation.copied').waitFor(); assert.equal(await controls('card').isVisible(), false);
    await page.locator('#clipboard-test').evaluate(node => { node.hidden = false; }); await page.locator('#clipboard-destination').focus(); await page.keyboard.press('Control+V');
    assert.equal(await page.locator('#clipboard-destination').inputValue(), real.translation.text); await page.locator('#clipboard-test').evaluate(node => { node.hidden = true; }); return { copiedFixtureOnly: true };
  });
  await check('light dark and busy pages fit three widths with one bounded blur surface', async () => {
    await until(async () => !await controls('copy-translation.copied').count(), 'copy feedback finishes');
    const sizes = [];
    for (const [width, height, theme] of [[375, 812, 'light'], [768, 900, 'dark'], [1440, 900, 'busy']]) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(theme => { document.body.style.background = theme === 'dark' ? '#151c19' : theme === 'busy' ? 'repeating-linear-gradient(45deg,#c1d5de 0 25px,#ebd3a6 25px 50px)' : '#eef1ed'; document.body.style.color = theme === 'dark' ? '#eef5ed' : '#193d30'; }, theme);
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); assert.deepEqual(audit.violations.map(item => item.id), []);
      const surfaces = await root().locator('.actionbar').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).backdropFilter !== 'none').map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
      assert.ok(surfaces.length <= 1); assert.ok(surfaces.every(box => box.width * box.height <= 270 * 46));
      const box = await controls('actionbar').boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
      await capture(`${width}`); sizes.push({ width, height, theme, axeViolations: 0, blurSurfaces: surfaces });
    }
    return { sizes };
  });
  await check('contrast and forced colors provide opaque controls', async () => {
    await controls('more').click(); await controls('overlay-contrast').click(); assert.equal(await controls('actionbar').evaluate(node => getComputedStyle(node).backdropFilter), 'none'); await capture('opaque');
    await controls('toggle-original').click();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); assert.deepEqual(audit.violations.map(item => item.id), []);
    await controls('toggle-original').click();
    await controls('more').click(); await controls('overlay-contrast').click(); await page.emulateMedia({ forcedColors: 'active' }); assert.equal(await controls('actionbar').evaluate(node => getComputedStyle(node).backdropFilter), 'none'); await capture('forced-colors'); await page.emulateMedia({ forcedColors: 'none' });
    return { opaqueFallback: true };
  });
  await check('reduced transparency removes blur and zoom keeps the menu reachable', async () => {
    const session = await context.newCDPSession(page);
    try {
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.equal(await controls('actionbar').evaluate(node => getComputedStyle(node).backdropFilter), 'none');
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 }); await controls('more').click();
      await until(() => controls('card').evaluate(node => { const r = node.getBoundingClientRect(), v = visualViewport; return r.left >= v.offsetLeft && r.top >= v.offsetTop && r.right <= v.offsetLeft + v.width + 1 && r.bottom <= v.offsetTop + v.height + 1; }), 'menu within zoomed viewport');
      await capture('zoom'); await controls('retry-translation').press('Escape');
    } finally { await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await session.detach(); }
    return { reducedTransparency: true, zoom: 1.5 };
  });
  await check('unsupported mapping offers a focused reader without the old details UI', async () => {
    await page.locator('#sample').evaluate(image => { image.style.transform = 'rotate(5deg)'; }); await root().getByRole('textbox', { name: 'Translated text' }).waitFor();
    assert.equal(await root().getByRole('textbox', { name: 'Translated text' }).inputValue(), real.translation.text); await capture('reader');
    await controls('reader-close').click(); assert.equal(await controls('card').isVisible(), false); await controls('read-translation').click(); await controls('translated-text').press('Escape');
    assert.equal(await controls('read-translation').getAttribute('aria-expanded'), 'false'); await page.locator('#sample').evaluate(image => { image.style.transform = ''; }); return { fallbackReadable: true };
  });
  await check('blocked copy opens selectable full text and Close restores Translate', async () => {
    await inContent('clipboard-block'); await controls('copy-translation').click(); await controls('translated-text').waitFor(); assert.equal(await controls('translated-text').inputValue(), real.translation.text);
    await controls('dismiss').click(); assert.equal(await controls('image-overlay').count(), 0); assert.equal(await controls('translate').evaluate(node => node.getRootNode().activeElement === node), true); return { clipboardFallback: true };
  });
  await check('loading and empty errors remain compact and recoverable', async () => {
    await openFixture('held'); await controls('translate').click(); await until(() => controls('state-label').isVisible(), 'loading'); assert.equal(await controls('card').isVisible(), false); assert.equal(await controls('spinner').evaluate(node => getComputedStyle(node).animationName), 'none'); await capture('loading');
    await root().getByRole('button', { name: 'Cancel image preparation' }).click();
    await openFixture({ fixtureError: true }); await controls('translate').click(); await controls('notice').waitFor(); await capture('empty'); assert.equal(await controls('retry-primary').isVisible(), true); return { cancelAndRetry: true };
  });
  await check('partial output exposes available text without a generic quality warning', async () => {
    const fixture = structuredClone(real); fixture.translation.partial = true;
    await openFixture(fixture); await controls('translate').click(); await controls('read-translation').waitFor();
    assert.equal((await controls('read-translation').innerText()).trim(), 'Partial'); assert.equal(await controls('card').isVisible(), false);
    await controls('read-translation').click(); assert.equal(await controls('translated-text').inputValue(), fixture.translation.text);
    assert.equal(await root().getByRole('heading', { name: 'Available translation' }).isVisible(), true); await capture('partial');
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); assert.deepEqual(audit.violations.map(item => item.id), []);
    return { partialIsContextual: true, axeViolations: 0 };
  });
  await check('image-host access feedback points back to the popup', async () => {
    await openFixture({ fixtureError: true, userMessage: 'Allow this image host in Aksara’s popup, then try again.' }); await controls('translate').click(); await controls('notice').waitFor();
    assert.match(await controls('notice').innerText(), /popup/); assert.equal(await controls('retry-primary').isVisible(), true); await capture('permission');
    return { note: 'UI state replay. Actual acquisition permission boundaries are covered by test:images; native Chrome grant dialog remains manual.' };
  });
  await check('multiple images share one active blur and remain responsive while scrolling', async () => {
    await openFixture(); await translate();
    await page.locator('#sample').evaluate(image => { image.style.width = '220px'; const clone = image.cloneNode(); clone.id = 'second'; image.after(clone); });
    await until(async () => await controls('control').count() === 2, 'second control');
    await controls('control').nth(1).locator('.translate').click(); await controls('control').nth(1).locator('.toggle-original').waitFor();
    for (const index of [0, 1]) {
      await controls('control').nth(index).locator('.more').focus();
      const count = await controls('actionbar').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).backdropFilter !== 'none').length); assert.equal(count, 1);
    }
    const frames = await page.evaluate(async () => {
      document.body.style.minHeight = '1800px'; const durations = []; let before = performance.now();
      for (let i = 0; i < 45; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); durations.push(now - before); before = now; scrollTo(0, i % 2 ? 30 : 0); }
      scrollTo(0, 0); return durations.sort((a,b) => a-b);
    });
    const vitals = await page.evaluate(() => globalThis.__aksaraGlassVitals); assert.ok(vitals.cumulativeLayoutShift < 0.1);
    return { activeBlurSurfaces: 1, scrollFrameP95Ms: frames[Math.floor(frames.length * .95)], fixtureVitals: vitals, note: 'Local rendering fixture only. Event Timing is a proxy, not field INP, and this is not a GPU or inference benchmark.' };
  });
  await check('missing model preserves source reading and opens actual Setup', async () => {
    const fixture = structuredClone(real); delete fixture.translation; fixture.translationError = { code: 'MODEL_NOT_READY', userMessage: 'Model missing' };
    await openFixture(fixture); await controls('translate').click(); await controls('setup').waitFor(); await capture('setup');
    await controls('read-translation').click(); assert.equal(await controls('recognized-text').inputValue(), real.ocr.text); await controls('reader-close').click();
    const opened = context.waitForEvent('page'); await controls('setup').click(); const options = await opened; await options.waitForLoadState(); assert.equal(options.url(), `chrome-extension://${extensionId}/options.html`); await options.close();
    return { fixedSetupDestination: true };
  });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.ok = true;
} catch (error) { report.failure = error.stack || error.message; process.exitCode = 1; console.error(report.failure); if (page && !page.isClosed()) await capture('failure').catch(() => {}); }
finally { await context?.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); await mkdir('test-results', { recursive: true }); await writeFile('test-results/glass-report.json', JSON.stringify(report, null, 2) + '\n'); }
