import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { NativePopup } from './native-popup.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const profile = resolve('.test-profile-popup'), extensionPath = resolve('dist'), origin = 'http://page.aksara-fixture.net';
const png = (await readFile('tests/fixtures/comic-context.png')).toString('base64');
const report = { generatedAt: new Date().toISOString(), cases: [], errors: [], externalRequests: [], ok: false, note: 'Actual Chrome action popups opened by Extensions.triggerAction (and chrome.action.openPopup for the unsupported-page case), inspected through CDP. Model metadata/error/loading variants explicitly use UI fixtures; no weights are downloaded and no inference quality is graded.' };
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(`<!doctype html><html lang="en"><title>Popup activation fixture</title><h1>Comic</h1><img width="360" alt="Comic panel" src="data:image/png;base64,${png}"></html>`); });
let context, bridge, page, popup, extensionId, browserSession, installFixture;
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
async function until(predicate, name, timeout = 10_000) { const start = Date.now(); while (!await predicate()) { if (Date.now() - start > timeout) throw new Error(`Timed out: ${name}`); await new Promise(done => setTimeout(done, 60)); } }
async function closePopup() {
  const previous = popup;
  await bridge.evaluate(() => chrome.extension.getViews({type:'popup'}).forEach(view => view.close()));
  if (previous instanceof NativePopup) {
    await until(async () => !(await browserSession.send('Target.getTargets')).targetInfos.some(target => target.targetId === previous.targetId), 'native popup target destroyed');
    previous.closed = true; previous.cleanup();
  } else if (previous && !previous.isClosed()) await previous.close();
  popup = undefined;
}
async function openPopup(fixture = null) {
  await closePopup(); await bridge.evaluate(fixture => chrome.storage.session.set({ __aksaraPopupTestFixture: fixture }), fixture);
  await page.bringToFront();
  if (fixture) {
    // Render-only variants use a background extension document. Native action
    // views close when reloaded, so do not mislabel these fixtures as popups.
    const waiting = context.waitForEvent('page'); await bridge.evaluate(url => chrome.tabs.create({url,active:false}),`chrome-extension://${extensionId}/popup.html`);
    popup = await waiting; await popup.setViewportSize({width:360,height:600}); await popup.waitForLoadState();
    if (fixture.kind !== 'loading') await popup.locator('#language-settings:not([disabled])').waitFor();
    return popup;
  }
  const tabs = (await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos;
  await browserSession.send('Extensions.triggerAction',{id:extensionId,targetId:tabs.find(target => target.url === page.url()).targetId});
  let target;
  await until(async () => { target = (await browserSession.send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${extensionId}/popup.html`); return !!target; }, 'native popup target');
  popup = await NativePopup.attach(browserSession,target.targetId,report.errors);
  await popup.waitForLoadState();
  if (fixture?.kind !== 'loading') await popup.locator('#language-settings:not([disabled])').waitFor();
  await until(async () => await popup.locator('.popup').evaluate(node => node.getBoundingClientRect().width > 300), 'popup stylesheet');
  return popup;
}
async function dimensions() { return popup.evaluate(() => ({ width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, bodyHeight: document.body.getBoundingClientRect().height })); }
async function capture(name, surface = popup) { await surface.screenshot({ path: `test-results/popup-${name}.png` }); }
async function audit(surface = popup) { let result; if (surface instanceof NativePopup) { await surface.expression(axeSource); result = await surface.evaluate(() => axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})); } else result = await new AxeBuilder({ page: surface }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); assert.deepEqual(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), []); }
async function check(name, run) { const start = Date.now(); try { report.cases.push({ name, ok: true, ...await run(), elapsedMs: Date.now() - start }); console.log(`PASS ${name}`); } catch(error) { report.cases.push({ name, ok: false, error: error.message }); throw error; } }
try {
  await mkdir('test-results', { recursive: true }); assert.equal(profile, resolve('.test-profile-popup')); await rm(profile, { recursive: true, force: true });
  await new Promise((yes,no) => { server.once('error',no); server.listen(80,'127.0.0.1',yes); });
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 }, args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1', '--no-proxy-server', `--disable-extensions-except=${extensionPath}`] });
  report.browser = context.browser().version();
  context.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.origin !== origin) report.externalRequests.push(url.origin + url.pathname); });
  context.on('page', surface => { surface.on('pageerror', error => report.errors.push(error.message)); surface.on('console', event => { if (event.type() === 'error') report.errors.push(event.text()); }); });
  // Test-only UI replay. The normal first journey delegates to the real backend.
  // No annotation, model metadata override or test hook ships in the extension.
  installFixture = function () {
    if (!location.pathname.endsWith('/popup.html') || !chrome.runtime?.id) return;
    const send = chrome.runtime.sendMessage.bind(chrome.runtime), get = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.runtime.sendMessage = async (...args) => {
      if (args[0]?.type !== 'GET_MODEL_STATUS') return send(...args);
      const { __aksaraPopupTestFixture: fixture } = await chrome.storage.session.get('__aksaraPopupTestFixture');
      if (fixture?.kind === 'loading') return new Promise(() => {});
      if (fixture?.kind === 'error') throw new Error('Fixture model status failure');
      if (fixture?.model) return { ok: true, model: fixture.model, job: fixture.job ?? null };
      return send(...args);
    };
    chrome.storage.local.get = async (...args) => {
      if (args[0] === 'languageSettings') { const { __aksaraPopupTestFixture: fixture } = await chrome.storage.session.get('__aksaraPopupTestFixture'); if (fixture?.kind === 'loading') return new Promise(() => {}); }
      return get(...args);
    };
  };
  await context.addInitScript(installFixture);
  browserSession = await context.browser().newBrowserCDPSession(); ({ id: extensionId } = await browserSession.send('Extensions.loadUnpacked', { path: extensionPath }));
  bridge = await context.newPage(); await bridge.goto(`chrome-extension://${extensionId}/options.html`);
  // Legacy native-view regression only. Production uses the in-page menu.
  await bridge.evaluate(() => chrome.action.setPopup({popup:'popup.html'}));
  report.version = await bridge.evaluate(() => chrome.runtime.getManifest().version);
  page = await context.newPage(); await page.goto(origin); await page.locator('img').evaluate(image => image.decode());
  await check('actual Chrome action popup has intrinsic width and a compact first-use layout', async () => {
    await openPopup(); await popup.locator('body[data-model-state=empty]').waitFor();
    const native = await bridge.evaluate(() => chrome.extension.getViews({ type: 'popup' }).map(view => ({ width: view.innerWidth, height: view.innerHeight })));
    assert.equal(native.length, 1); assert.equal(native[0].width, 360);
    const box = await dimensions(); assert.ok(box.scrollWidth <= box.width && box.scrollHeight <= box.height + 1 && box.height < 510);
    assert.equal(await popup.getByText('ON YOUR DEVICE', { exact: true }).count(), 0); assert.equal(await popup.locator('#enable-tab').isEnabled(), true);
    await audit(); await capture('native-empty'); return { native, dimensions: box, actualBackend: true };
  });
  await check('keyboard language choices persist and the site switch gates actual activation', async () => {
    await popup.locator('#target-language').focus(); await popup.keyboard.press('End'); await popup.keyboard.press('Tab');
    await until(async () => (await bridge.evaluate(() => chrome.storage.local.get('languageSettings'))).languageSettings?.targetLanguage === 'fra_Latn', 'language saved');
    await popup.locator('#site-enabled').focus(); await popup.keyboard.press('Space'); await until(() => popup.locator('#enable-tab').isDisabled(), 'site disabled');
    await until(async () => await popup.locator('#site-enabled').isEnabled() && await popup.locator('#site-enabled').evaluate(node => document.activeElement === node), 'site choice saved and keyboard focus restored');
    await popup.keyboard.press('Space'); await until(() => popup.locator('#enable-tab').isEnabled(), 'site allowed');
    assert.equal(await page.locator('#aksara-root .translate').count(), 0, 'Allowing a site does not inject controls or acquire images.');
    await popup.locator('#enable-tab').focus(); await popup.keyboard.press('Enter');
    await until(async () => (await popup.locator('#enable-tab').innerText()).includes('Enabled on this page'), 'page enabled');
    await page.locator('#aksara-root .translate').waitFor(); await capture('native-enabled'); return { actualContentInjection: true, syntheticOcr: false };
  });
  await check('reopening detects enabled controls without bypassing manual reactivation after a site disable', async () => {
    await openPopup(); await until(async () => (await popup.locator('#enable-tab').innerText()).includes('Enabled'), 'saved page connection');
    await popup.locator('#site-enabled').uncheck(); await until(async () => await page.locator('#aksara-root .translate').count() === 0, 'controls removed');
    await popup.locator('#site-enabled').check(); await until(() => popup.locator('#enable-tab').isEnabled(), 'site preference saved');
    await openPopup(); assert.equal(await popup.locator('#enable-tab').innerText(), 'Enable translation'); return { explicitReactivationPreserved: true };
  });
  const model = { ready: true, cachedBytes: 911962632, totalBytes: 911962632, revision: 'ui-fixture' };
  await check('ready partial running error and loading rendering fixtures fit the popup width', async () => {
    const states = [
      ['ready', { model }, 'Ready offline'],
      ['partial', { model: { ...model, ready: false, cachedBytes: 16000000 } }, 'Download incomplete'],
      ['running', { model: { ...model, ready: false }, job: { id: 'ui-fixture', operation: 'VERIFY_MODEL', state: 'running', progress: { stage: 'model_verify', fraction: .5 } } }, 'Verifying model files'],
      ['error', { kind: 'error' }, 'Model status unavailable'],
      ['loading', { kind: 'loading' }, 'Checking model'],
    ]; const sizes = [];
    for (const [state, fixture, text] of states) { await openPopup(fixture); await until(async () => (await popup.locator('#model-summary').innerText()).includes(text), state); const size = await dimensions(); assert.equal(size.width, 360); assert.ok(size.scrollWidth <= size.width && size.bodyHeight < 510 && size.scrollHeight <= size.height); if (state === 'loading') assert.equal(await popup.locator('#enable-tab').isDisabled(), true); await capture(`fixture-${state}`); sizes.push({ state, ...size }); }
    return { renderingFixtures: true, fixtureViewport:'360x600 extension tab; first-use/activation/reopen/Setup are tested in actual native popup windows', sizes };
  });
  await check('save failure is visible and a long hostname stays bounded', async () => {
    await openPopup();
    await popup.evaluate(() => { const set = chrome.storage.local.set.bind(chrome.storage.local); chrome.storage.local.set = async value => { if (value.languageSettings) throw new Error('Fixture save failure'); return set(value); }; });
    await popup.locator('#target-language').selectOption('ind_Latn'); await popup.locator('#language-status[data-error=true]').waitFor();
    assert.match(await popup.locator('#language-status').innerText(), /Could not save/); await capture('native-save-error');
    await popup.locator('#site-help').evaluate(node => { node.textContent = 'a-very-long-origin-name-for-checking-layout.aksara-fixture.net:8080'; node.title = 'http://' + node.textContent; });
    assert.ok((await dimensions()).scrollWidth <= 360); await capture('native-long-host'); return { nativePopup:true,errorFixture: true, longHostFixture: true };
  });
  await check('image-host access remains explicit and keyboard reachable', async () => {
    await closePopup(); await bridge.evaluate(() => chrome.storage.session.set({ pendingImagePermission: { origin: 'https://cdn.aksara-fixture.net/image.png', createdAt: Date.now() } }));
    await openPopup(); await popup.locator('#allow-image-host').waitFor(); await popup.locator('#allow-image-host').focus();
    assert.equal(await popup.locator('#allow-image-host').evaluate(node => document.activeElement === node), true); const size = await dimensions(); assert.ok(size.scrollWidth <= size.width); await capture('native-permission');
    await bridge.evaluate(() => chrome.storage.session.remove('pendingImagePermission')); return { nativePopup:true,dimensions:size,grantDialog: 'Manual; no permission grant is fabricated or automatically accepted.' };
  });
  await check('native settings opens the actual Setup page without a download', async () => {
    await openPopup(); await popup.locator('#open-options').focus(); await popup.keyboard.press('Enter');
    await until(() => bridge.locator('#model-manager').isVisible(), 'existing Setup page');
    const status = await bridge.evaluate(() => chrome.runtime.sendMessage({schemaVersion:1,target:'background',type:'GET_MODEL_STATUS'})); assert.equal(status.model.cachedBytes,0); assert.equal(status.model.ready,false); return { fixedSetupDestination: bridge.url(),cachedBytes:status.model.cachedBytes };
  });
  await check('standalone popup fits three widths and opaque accessibility fallbacks', async () => {
    await closePopup(); await bridge.evaluate(model => chrome.storage.session.set({ __aksaraPopupTestFixture: { model } }), model); await page.bringToFront();
    const waiting = context.waitForEvent('page'); await bridge.evaluate(url => chrome.tabs.create({ url, active: false }), `chrome-extension://${extensionId}/popup.html`); const standalone = await waiting; await standalone.waitForLoadState(); await standalone.locator('body[data-model-state=ready]').waitFor();
    const sizes = [];
    for (const [width,height] of [[375,812],[768,900],[1440,900]]) { await standalone.setViewportSize({ width,height }); await audit(standalone); const bounds = await standalone.locator('.popup').boundingBox(); assert.ok(bounds.x + bounds.width <= width); assert.equal(await standalone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await capture(`${width}`, standalone); sizes.push({ width,height,axeViolations:0 }); }
    await standalone.setViewportSize({ width:375,height:812 });
    await standalone.evaluate(() => { const nodes = [...document.querySelectorAll('h1,p,label,span,select,button,a')].map(node => [node, getComputedStyle(node).fontSize, getComputedStyle(node).lineHeight]); for (const [node,font,line] of nodes) { node.style.fontSize = `${parseFloat(font) * 1.25}px`; if (line !== 'normal') node.style.lineHeight = `${parseFloat(line) * 1.25}px`; } });
    assert.equal(await standalone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await capture('text-125',standalone);
    await standalone.emulateMedia({ forcedColors:'active' }); await audit(standalone); await capture('forced-colors',standalone);
    await standalone.emulateMedia({ forcedColors:'none', reducedMotion:'reduce' }); const media = await context.newCDPSession(standalone); await media.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
    assert.equal(await standalone.locator('.popup').evaluate(node => getComputedStyle(node).backgroundImage), 'none'); await capture('opaque',standalone); await media.detach(); await standalone.close(); return { sizes,textSizing:'125% fixture; not a native browser-zoom claim',fallbacks:true };
  });
  await check('unsupported browser pages explain the next action', async () => {
    await closePopup(); await bridge.bringToFront(); await bridge.evaluate(() => chrome.storage.session.set({ __aksaraPopupTestFixture:null })); await bridge.evaluate(() => chrome.action.openPopup());
    const target = (await browserSession.send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${extensionId}/popup.html`); popup = await NativePopup.attach(browserSession,target.targetId,report.errors); await popup.waitForLoadState();
    await until(async () => (await popup.locator('#site-help').innerText()).includes('Unavailable'), 'unsupported page explanation'); assert.equal(await popup.locator('#enable-tab').isDisabled(),true); await capture('native-unsupported'); return { actualUnsupportedPage:true };
  });
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.externalRequests,[]); report.ok = true;
} catch(error) { report.failure = error.stack || error.message; process.exitCode = 1; console.error(report.failure); if (popup && !popup.isClosed()) await capture('failure').catch(() => {}); }
finally { await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await writeFile('test-results/popup-report.json',JSON.stringify(report,null,2)+'\n'); }
