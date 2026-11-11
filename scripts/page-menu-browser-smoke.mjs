import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.browser');
const { chromium } = await import('playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const { default: sharp } = await import('sharp');
const origin = 'http://page.aksara-fixture.net', profile = resolve('.test-profile-page-menu');
const png = (await readFile('tests/fixtures/comic-context.png')).toString('base64');
const report = { generatedAt:new Date().toISOString(),cases:[],errors:[],externalRequests:[],ok:false,note:'Real toolbar action opens the packaged page menu. Model-state variants are explicitly marked rendering fixtures. Opening/activation tests do not run OCR; real OCR/NLLB remains covered by test:overlays.' };
const server = createServer((req,res) => { if (req.url === '/favicon.ico') { res.writeHead(204);res.end();return; } if(req.url==='/strict')res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data: 'self'; style-src 'nonce-fixture'; script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'" );res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aksara page menu fixture</title><style nonce="fixture">body{margin:24px;background:#18382b;color:#eef8f0;font:16px/1.5 system-ui}h1{font-size:24px;margin:0}p{max-width:45ch}img{display:block;width:430px;max-width:100%;height:auto;margin:20px 0}button{min-height:36px;padding:8px 12px;font:inherit}</style><h1>Read the image</h1><p>The webpage stays visible around Aksara’s rounded menu.</p><img alt="Comic panel" src="data:image/png;base64,${png}"><button id="outside">Page action</button></html>`); });
let context, bridge, page, browserSession, extensionId;
const root = () => page.locator('#aksara-menu-root'), menu = () => root().locator('.menu-popover'), field = id => root().locator(`#${id}`);
async function until(predicate,name,timeout=15_000) { const start=Date.now(); while(!await predicate()) { if(Date.now()-start>timeout) throw new Error(`Timed out: ${name}`); await new Promise(done=>setTimeout(done,70)); } }
async function action(surface=page) { await surface.bringToFront(); const tabs=(await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos; const target=tabs.find(tab=>tab.url===surface.url()); assert.ok(target); await browserSession.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId}); }
async function open() { if(await root().count()) { await page.keyboard.press('Escape'); await root().waitFor({state:'detached'}); } await action(); await menu().waitFor(); await field('language-settings').locator('select').first().waitFor(); await until(()=>field('source-language').isEnabled(),'preferences ready'); }
async function capture(name,surface=page) { await surface.screenshot({path:`test-results/menu-${name}.png`}); }
async function inContent(operation,value) { return bridge.evaluate(async ({url,operation,value})=>{ const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url); return(await chrome.scripting.executeScript({target:{tabId:tab.id},func:(operation,value)=>{
  if(operation==='fixture') {
    globalThis.__aksaraMenuFixture=value;
    if(!globalThis.__aksaraMenuShim) { globalThis.__aksaraMenuShim=true; const send=chrome.runtime.sendMessage.bind(chrome.runtime),get=chrome.storage.local.get.bind(chrome.storage.local);
      chrome.runtime.sendMessage=(message,...args)=>{ if(message.type==='GET_PAGE_MENU_STATE'&&globalThis.__aksaraMenuFixture) { const fixture=globalThis.__aksaraMenuFixture; return fixture.kind==='loading'?new Promise(()=>{}):Promise.resolve(fixture); } return send(message,...args); };
      chrome.storage.local.get=(keys,...args)=>globalThis.__aksaraMenuFixture?.kind==='loading'&&Array.isArray(keys)&&keys.includes('languageSettings')?new Promise(()=>{}):get(keys,...args);
    }
  }
  if(operation==='request') return chrome.runtime.sendMessage({schemaVersion:1,target:'background',...value});
},args:[operation,value]}))[0]; },{url:page.url(),operation,value}); }
async function check(name,run) { const start=Date.now(); try { report.cases.push({name,ok:true,...await run(),elapsedMs:Date.now()-start}); console.log(`PASS ${name}`); } catch(error) {report.cases.push({name,ok:false,error:error.message});throw error;} }
// Scope to extension-owned UI. At narrow widths the nonmodal top-layer menu
// covers host-page text; auditing that obscured text creates false contrast hits.
async function audit() { const result=await new AxeBuilder({page}).include('#aksara-menu-root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})),[]); }
try {
  await mkdir('test-results',{recursive:true});assert.equal(profile,resolve('.test-profile-page-menu'));await rm(profile,{recursive:true,force:true});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(80,'127.0.0.1',yes);});
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1000,height:700},args:['--enable-unsafe-extension-debugging','--host-resolver-rules=MAP *.aksara-fixture.net 127.0.0.1','--no-proxy-server',`--disable-extensions-except=${resolve('dist')}`]});
  report.browser=context.browser().version();context.on('request',request=>{const url=new URL(request.url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin)report.externalRequests.push(url.origin+url.pathname);});
  context.on('page',surface=>{surface.on('pageerror',error=>report.errors.push(error.message));surface.on('console',event=>{if(event.type()==='error')report.errors.push(event.text());});});
  browserSession=await context.browser().newBrowserCDPSession();({id:extensionId}=await browserSession.send('Extensions.loadUnpacked',{path:resolve('dist')}));
  bridge=await context.newPage();await bridge.goto(`chrome-extension://${extensionId}/options.html`);report.version=await bridge.evaluate(()=>chrome.runtime.getManifest().version);
  page=await context.newPage();await page.goto(origin);await page.locator('img').evaluate(image=>image.decode());
  await page.locator('#outside').evaluate(node=>node.addEventListener('click',()=>{node.dataset.clicked='true';}));
  await check('toolbar opens a page-layer rounded menu with transparent corners and no native popup',async()=>{
    await open();await until(async()=>(await field('model-summary').innerText()).includes('Download model'),'actual first-use model state');
    assert.equal(await bridge.evaluate(()=>chrome.extension.getViews({type:'popup'}).length),0);assert.equal(await page.locator('#aksara-root').count(),0);
    assert.equal(await menu().evaluate(node=>node.matches(':popover-open')),true);const box=await menu().boundingBox();
    const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x+1,y+1)?.id||'',box);assert.notEqual(hit,'aksara-menu-root');
    const buffer=await page.screenshot();const corner=await sharp(buffer).extract({left:Math.floor(box.x+1),top:Math.floor(box.y+1),width:1,height:1}).removeAlpha().raw().toBuffer();assert.ok(corner[0]<100&&corner[1]<100&&corner[2]<100,'The dark webpage is visible outside the rounded corner, rather than a white rectangular popup canvas.');
    const contexts=await bridge.evaluate(()=>chrome.runtime.getContexts({contextTypes:[chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]}));assert.equal(contexts.length,0);
    await audit();await capture('rounded-page');await page.screenshot({path:'test-results/menu-rounded-detail.png',clip:{x:box.x-12,y:box.y-12,width:box.width+24,height:box.height+24}});return{nativePopups:0,cornerRgb:[...corner],noImageJob:true,axeViolations:0};
  });
  await check('synthetic page events cannot enable, save preferences, open settings or dismiss the menu',async()=>{
    const before=await bridge.evaluate(()=>chrome.storage.local.get(['languageSettings','siteSettings']));
    await page.evaluate(()=>{const root=document.querySelector('#aksara-menu-root').shadowRoot;const source=root.querySelector('#source-language');source.value='ind_Latn';source.dispatchEvent(new Event('change',{bubbles:true}));root.querySelector('#site-enabled').click();for(const selector of ['#enable-tab','#open-options','footer a','.menu-close'])root.querySelector(selector).click();});
    await page.waitForTimeout(120);assert.deepEqual(await bridge.evaluate(()=>chrome.storage.local.get(['languageSettings','siteSettings'])),before);assert.equal(await root().count(),1);assert.equal(await page.locator('#aksara-root').count(),0);return{untrustedEventsRejected:true};
  });
  await check('keyboard choices and site access persist; only explicit activation installs image controls',async()=>{
    await field('target-language').focus();await page.keyboard.press('End');await page.keyboard.press('Tab');await until(async()=>(await bridge.evaluate(()=>chrome.storage.local.get('languageSettings'))).languageSettings?.targetLanguage==='fra_Latn','language save');
    await field('site-enabled').focus();await page.keyboard.press('Space');await until(()=>field('enable-tab').isDisabled(),'site disabled');await until(()=>field('site-enabled').isEnabled(),'site save');
    await field('site-enabled').focus();await page.keyboard.press('Space');await until(()=>field('enable-tab').isEnabled(),'site allowed');assert.equal(await page.locator('#aksara-root').count(),0);
    await field('enable-tab').focus();await page.keyboard.press('Enter');await root().waitFor({state:'detached'});await page.locator('#aksara-root .translate').waitFor();
    await open();await until(async()=>(await field('enable-tab').innerText()).includes('Enabled'),'connected state');
    await field('site-enabled').uncheck();await until(async()=>await page.locator('#aksara-root .translate').count()===0,'controls removed');await until(()=>field('site-enabled').isEnabled(),'disable saved');await field('site-enabled').check();await until(()=>field('enable-tab').isEnabled(),'allow saved');
    await open();assert.equal(await field('enable-tab').innerText(),'Enable translation');return{actualActivation:true,manualReactivationPreserved:true};
  });
  await check('Close Escape outside click and the toolbar toggle dismiss without intercepting the page',async()=>{
    await root().getByRole('button',{name:'Close Aksara'}).click();await root().waitFor({state:'detached'});await open();await page.keyboard.press('Escape');await root().waitFor({state:'detached'});
    await open();await page.locator('#outside').click();await root().waitFor({state:'detached'});assert.equal(await page.locator('#outside').getAttribute('data-clicked'),'true');
    await open();await action();await root().waitFor({state:'detached'});return{dismissalMethods:4};
  });
  await check('page-origin messages cannot manage models or diagnostics and subframes cannot activate the menu',async()=>{
    for(const type of ['START_MODEL_DOWNLOAD','DELETE_MODEL','VERIFY_MODEL','GET_MODEL_STATUS','START_JOB']){const reply=(await inContent('request',{type,consent:true,operation:'CHECK_GPU'})).result;assert.equal(reply.error,'UNAUTHORIZED_CONTEXT');}
    await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='about:blank';frame.title='Authorization fixture';document.body.append(frame);});
    const rejected=await bridge.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);return(await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:()=>window===top?null:chrome.runtime.sendMessage({schemaVersion:1,target:'background',type:'ENABLE_PAGE_IMAGES'})})).filter(item=>item.frameId!==0).map(item=>item.result);},page.url());
    assert.ok(rejected.length>0);for(const reply of rejected)assert.equal(reply.error,'UNAUTHORIZED_CONTEXT');await page.locator('iframe').evaluate(node=>node.remove());return{privilegedRequestsRejected:5,subframeRequestsRejected:rejected.length};
  });
  const fixture=state=>({ok:true,controlsEnabled:false,model:{summary:state==='ready'?'Ready offline':state==='partial'?'Download incomplete':'Preparing model · 50%',running:false,needsSetup:state!=='ready',state}});
  await check('loading partial ready and unavailable state fixtures retain readable recovery controls',async()=>{
    const cases=[['ready',fixture('ready')],['partial',fixture('partial')],['running',fixture('running')],['error',{ok:false}],['loading',{kind:'loading'}]];
    for(const [state,data]of cases){await inContent('fixture',data);if(await root().count())await root().getByRole('button',{name:'Close Aksara'}).click();await action();await menu().waitFor();if(state!=='loading')await until(()=>field('source-language').isEnabled(),'fixture preferences');if(state==='error')await until(async()=>(await field('model-summary').innerText()).includes('unavailable'),'model error');if(state==='loading')assert.equal(await field('enable-tab').isDisabled(),true);await capture(`fixture-${state}`);await page.keyboard.press('Escape');await root().waitFor({state:'detached'});}
    await inContent('fixture',null);return{renderingFixtures:true,states:cases.map(([state])=>state)};
  });
  await check('three widths zoom and opaque accessibility fallbacks keep the panel within the viewport',async()=>{
    const sizes=[];
    for(const[width,height]of[[375,812],[768,900],[1440,900]]){await page.setViewportSize({width,height});await open();await audit();const box=await menu().boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height);await capture(`${width}`);sizes.push({width,height,axeViolations:0});await page.keyboard.press('Escape');}
    await open();const media=await context.newCDPSession(page);await media.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});await until(()=>menu().evaluate(node=>{const r=node.getBoundingClientRect(),v=visualViewport;return r.left>=v.offsetLeft&&r.right<=v.offsetLeft+v.width+1&&r.bottom<=v.offsetTop+v.height+1;}),'zoom bounds');await capture('zoom');await media.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await page.emulateMedia({forcedColors:'active'});await audit();await capture('forced-colors');await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});await media.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});assert.equal(await root().locator('.popup').evaluate(node=>getComputedStyle(node).backgroundImage),'none');await capture('opaque');await media.detach();return{sizes,zoom:1.5,opaqueFallback:true};
  });
  await check('Settings and Privacy open only extension-owned pages; host consent is reviewed in Settings',async()=>{
    if(await root().count())await page.keyboard.press('Escape');const owner=await inContent('request',{type:'GET_PAGE_MENU_STATE'});
    const tabId=await bridge.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
    await bridge.evaluate(({tabId,documentId})=>chrome.storage.session.set({pendingImagePermission:{origin:'https://cdn.aksara-fixture.net',createdAt:Date.now(),tabId,documentId}}),{tabId,documentId:owner.documentId});
    await open();await field('allow-image-host').waitFor();await field('allow-image-host').click();await bridge.locator('#image-access:not([hidden])').waitFor();assert.match(await bridge.locator('#image-access').innerText(),/cdn.aksara-fixture.net/);assert.equal(bridge.url(),`chrome-extension://${extensionId}/options.html`);await capture('settings-access',bridge);
    await bridge.evaluate(()=>chrome.storage.session.remove('pendingImagePermission'));await open();const opened=context.waitForEvent('page');await root().locator('footer a').click();const privacy=await opened;await privacy.waitForLoadState();assert.equal(privacy.url(),`chrome-extension://${extensionId}/privacy.html`);await privacy.close();return{fixedDestinations:true,grantDialog:'Manual; the test does not automatically grant host access.'};
  });
  await check('navigation removes the menu and restricted browser pages open Settings',async()=>{
    await open();await page.locator('img').evaluate(node=>node.remove());await field('enable-tab').click();await until(async()=>(await field('popup-status').innerText()).includes('No images'),'empty-page guidance');await page.evaluate(()=>history.pushState({},'','/another-route'));await root().waitFor({state:'detached'});
    await page.goto('chrome://version');await action();await until(()=>bridge.isVisible('body'),'Settings fallback');await until(async()=>(await bridge.evaluate(()=>chrome.tabs.query({active:true,currentWindow:true})))[0]?.url===`chrome-extension://${extensionId}/options.html`,'active Settings page');return{routeInvalidation:true,restrictedFallback:true};
  });
  await check('strict CSP and Trusted Types do not block the floating menu or image controls',async()=>{
    await page.goto(`${origin}/strict`);await page.locator('img').evaluate(image=>image.decode());await open();await field('enable-tab').click();await root().waitFor({state:'detached'});await page.locator('#aksara-root .translate').waitFor();await capture('strict-csp');return{strictCsp:true,trustedTypesRequired:true};
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.ok=true;
}catch(error){report.failure=error.stack||error.message;process.exitCode=1;console.error(report.failure);if(page&&!page.isClosed())await capture('failure').catch(()=>{});}
finally{await context?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await writeFile('test-results/page-menu-report.json',JSON.stringify(report,null,2)+'\n');}
