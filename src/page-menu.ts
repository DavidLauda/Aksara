import css from './popup.css?inline';
import markup from '../popup.html?raw';
import tokens from '../design-tokens.json';
import { LANGUAGE_SETTINGS_KEY, SOURCE_LANGUAGES, TARGET_LANGUAGES, languageSettings } from './languages';
import { SITE_SETTINGS_KEY, setSiteAllowed, siteAllowed, siteSettings } from './site-settings';

// Classic isolated-world entry; opening the menu does not read image pixels.
(() => {
  type Scope = typeof globalThis & { __aksaraMenuClose?: () => void };
  const scope = globalThis as Scope;
  if (scope.__aksaraMenuClose) { scope.__aksaraMenuClose(); return; }
  for (const old of document.querySelectorAll<HTMLElement>('[data-aksara-menu]')) if (old.dataset.aksaraMenu === chrome.runtime.id) { old.dispatchEvent(new Event('aksara-menu-dispose')); old.remove(); }
  const host = document.createElement('div'); host.id = 'aksara-menu-root'; host.lang = 'en'; host.dir = 'ltr'; host.dataset.aksaraMenu = chrome.runtime.id;
  const root = host.attachShadow({ mode: 'open' }), style = document.createElement('style'), popover = document.createElement('div');
  style.textContent = `${css}
    :host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;font:13px/18px system-ui,sans-serif!important;color:#193d30!important;color-scheme:light}
    .menu-popover{position:fixed;inset:auto;top:16px;right:16px;margin:0;padding:0;border:0;width:360px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;background:transparent;color:inherit;border-radius:22px;box-shadow:0 8px 30px #10201833;pointer-events:auto}
    .menu-popover::backdrop{background:transparent}.popup{width:100%;border-radius:22px;background:linear-gradient(145deg,#ffffffc9,#ffffff38),var(--aks-surface,#f8fcf9)}.popup-header{margin-bottom:20px}.menu-close{display:grid;place-items:center;flex:none;width:36px;height:36px;min-height:36px;padding:0;line-height:1}.menu-close svg{display:block}.menu-popover[data-model-state=ready] .model-row p:before{background:#267047}.menu-popover[data-model-state=partial] .model-row p:before,.menu-popover[data-model-state=error] .model-row p:before{background:#956405}
    .menu-popover.narrow .language-row{grid-template-columns:1fr}.menu-popover.narrow .language-arrow{display:none}
    @media(prefers-reduced-transparency:reduce){.popup{background:var(--aks-surface,#f8fcf9)}}
    @media(forced-colors:active){.menu-popover{box-shadow:none}.popup{background:Canvas}}
  `;
  for (const [name,value] of Object.entries(tokens.color)) host.style.setProperty(`--aks-${name}`,value);
  for (const [name,value] of Object.entries({ panel:tokens.radius.panel,toolbar:tokens.radius.toolbar,control:tokens.radius.button })) host.style.setProperty(`--aks-${name}-radius`,`${value}px`);
  popover.className = 'menu-popover'; popover.popover = 'auto'; popover.setAttribute('role','dialog'); popover.setAttribute('aria-label','Aksara image translation');
  // This template is bundled repository HTML, never page/OCR/model output.
  const template = document.createElement('template'); template.innerHTML = markup.match(/<main class="popup">[\s\S]*?<\/main>/)![0]; popover.append(template.content.cloneNode(true));
  const find = <T extends HTMLElement>(id: string) => popover.querySelector<T>(`#${id}`)!;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'menu-close'; close.setAttribute('aria-label','Close Aksara'); close.title = 'Close Aksara';
  const closeIcon = document.createElementNS('http://www.w3.org/2000/svg','svg'); closeIcon.setAttribute('viewBox','0 0 24 24'); closeIcon.setAttribute('aria-hidden','true'); closeIcon.setAttribute('focusable','false');
  const closePath = document.createElementNS(closeIcon.namespaceURI,'path'); closePath.setAttribute('d','M6 6 18 18M18 6 6 18'); closeIcon.append(closePath); close.append(closeIcon); popover.querySelector('.popup-header')!.append(close);
  const source = find<HTMLSelectElement>('source-language'), target = find<HTMLSelectElement>('target-language'), site = find<HTMLInputElement>('site-enabled'), enable = find<HTMLButtonElement>('enable-tab');
  const languageStatus = find('language-status'), siteStatus = find('site-status'), status = find('popup-status'), modelSummary = find('model-summary'), settings = find<HTMLButtonElement>('open-options');
  const origin = location.origin, pageUrl = location.href, previousFocus = document.activeElement as HTMLElement | null;
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const entryChanged = () => { if (location.href !== pageUrl) dispose(); };
  let disposed = false, ready = false, connected = false, siteBusy = false, saving = 0, activating = false, localVersion = 0;
  let pendingAllowed: boolean | undefined;
  let prefs = languageSettings(null), sites = siteSettings(null), saveQueue = Promise.resolve(), poll: ReturnType<typeof setTimeout> | undefined;
  const request = (type: string) => chrome.runtime.sendMessage({ schemaVersion:1,target:'background',type });
  function render() {
    if (disposed) return;
    const allowed = siteAllowed(sites,origin);
    find<HTMLFieldSetElement>('language-settings').disabled = !ready;
    site.disabled = !ready || siteBusy; site.checked = pendingAllowed ?? allowed;
    enable.disabled = !ready || !!saving || siteBusy || activating || !allowed;
    enable.textContent = activating ? 'Enabling…' : connected && allowed ? 'Enabled on this page' : 'Enable translation'; enable.dataset.connected = String(connected && allowed);
    find('activation-help').textContent = allowed ? 'Hover over an image and choose Translate.' : 'Allow this site to enable translation.';
  }
  async function loadLocal() {
    const version = ++localVersion;
    try {
      const saved = await chrome.storage.local.get([LANGUAGE_SETTINGS_KEY,SITE_SETTINGS_KEY]);
      if (disposed || version !== localVersion) return;
      prefs = languageSettings(saved[LANGUAGE_SETTINGS_KEY]); sites = siteSettings(saved[SITE_SETTINGS_KEY]);
      if (!saving) { source.value = prefs.sourceLanguage; target.value = prefs.targetLanguage; }
      if (!siteAllowed(sites,origin)) connected = false;
      ready = true;
      if (!languageStatus.dataset.error) languageStatus.textContent = 'Language choices stay on this device.';
      render();
    } catch { languageStatus.textContent = 'Could not load choices. Reopen Aksara to retry.'; languageStatus.dataset.error = 'true'; }
  }
  async function refresh() {
    clearTimeout(poll);
    try {
      const data = await request('GET_PAGE_MENU_STATE');
      if (disposed) return;
      if (!data?.ok) throw new Error();
      connected = data.controlsEnabled; modelSummary.textContent = data.model.summary; popover.dataset.modelState = data.model.state; settings.textContent = data.model.needsSetup ? 'Set up' : 'Settings';
      find('image-permission').hidden = !data.pendingHost;
      if (data.pendingHost) find('image-host').textContent = `Review access to images on ${data.pendingHost} in Settings.`;
      if (data.model.running) poll = setTimeout(() => { void refresh(); },4000);
      render();
    } catch { if (!disposed) { modelSummary.textContent = 'Model status unavailable'; settings.textContent = 'Set up'; } }
  }
  function dispose() {
    if (disposed) return; disposed = true; clearTimeout(poll);
    try { chrome.storage.onChanged.removeListener(changed); } catch { /* An extension reload can invalidate the old isolated world. */ }
    removeEventListener('pagehide',dispose); removeEventListener('popstate',dispose); removeEventListener('hashchange',dispose); document.removeEventListener('visibilitychange',hidden);
    removeEventListener('resize',position); window.visualViewport?.removeEventListener('resize',position); window.visualViewport?.removeEventListener('scroll',position);
    navigation?.removeEventListener('currententrychange',entryChanged);
    host.remove(); delete scope.__aksaraMenuClose;
    if (previousFocus?.isConnected && (document.activeElement === host || document.activeElement === document.body)) previousFocus.focus({preventScroll:true});
  }
  const hidden = () => { if (document.hidden) dispose(); };
  function position() {
    if (disposed) return;
    const viewport = window.visualViewport, width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const panelWidth = Math.min(360,Math.max(0,width - 32));
    popover.style.maxWidth = `${panelWidth}px`; popover.style.maxHeight = `${Math.max(0,height - 32)}px`;
    popover.style.right = 'auto'; popover.style.left = `${(viewport?.offsetLeft ?? 0) + Math.max(16,width - panelWidth - 16)}px`; popover.style.top = `${(viewport?.offsetTop ?? 0) + 16}px`;
    popover.classList.toggle('narrow',panelWidth < 300);
  }
  const changed = (changes: Record<string,chrome.storage.StorageChange>,area: string) => { if (area === 'local' && (LANGUAGE_SETTINGS_KEY in changes || SITE_SETTINGS_KEY in changes)) void loadLocal(); };
  for (const [select,languages] of [[source,SOURCE_LANGUAGES],[target,TARGET_LANGUAGES]] as const) for (const language of languages) { const option = document.createElement('option'); option.value = language.code; option.textContent = language.label; select.append(option); }
  for (const select of [source,target]) select.addEventListener('change',event => {
    if (!event.isTrusted) { source.value = prefs.sourceLanguage; target.value = prefs.targetLanguage; return; }
    const chosen = languageSettings({sourceLanguage:source.value,targetLanguage:target.value}); saving++; render(); delete languageStatus.dataset.error;
    saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set({[LANGUAGE_SETTINGS_KEY]:chosen})).then(() => { languageStatus.textContent = 'Saved for the next image.'; }).catch(() => { languageStatus.textContent = 'Could not save. Reopen Aksara and retry.'; languageStatus.dataset.error = 'true'; }).finally(() => { saving--; if (!disposed) { void loadLocal(); render(); } });
  });
  site.addEventListener('change',event => {
    if (!event.isTrusted || siteBusy) { render(); return; }
    const allowed = site.checked, restoreFocus = root.activeElement === site;
    siteBusy = true; pendingAllowed = allowed; render(); delete siteStatus.dataset.error;
    void chrome.storage.local.get(SITE_SETTINGS_KEY).then(saved => chrome.storage.local.set({[SITE_SETTINGS_KEY]:setSiteAllowed(siteSettings(saved[SITE_SETTINGS_KEY]),origin,allowed)})).catch(() => { siteStatus.textContent = 'Could not save this site. Reopen Aksara and retry.'; siteStatus.dataset.error = 'true'; }).finally(async () => { siteBusy = false; pendingAllowed = undefined; await loadLocal(); if (!disposed && restoreFocus && !root.activeElement) site.focus(); });
  });
  site.addEventListener('click',event => { if (!event.isTrusted) event.preventDefault(); });
  const on = (button: HTMLElement, action: () => void) => button.addEventListener('click',event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted) action(); });
  on(close,dispose);
  on(settings,() => { void request('OPEN_SETUP').then(data => { if (!data?.ok) throw new Error(); dispose(); }).catch(() => { status.textContent = 'Could not open Settings. Reopen Aksara and retry.'; }); });
  const access = find<HTMLButtonElement>('allow-image-host'); access.textContent = 'Review image access'; on(access,() => { void request('OPEN_SETUP').then(data => { if (!data?.ok) throw new Error(); dispose(); }).catch(() => { status.textContent = 'Could not open Settings.'; }); });
  const privacy = popover.querySelector<HTMLElement>('footer a')!;
  privacy.setAttribute('href',chrome.runtime.getURL('privacy.html'));
  on(privacy,() => { void request('OPEN_PRIVACY').then(data => { if (!data?.ok) throw new Error(); dispose(); }).catch(() => { status.textContent = 'Could not open Privacy.'; }); });
  on(enable,() => {
    if (activating || enable.disabled) return; activating = true; render(); status.textContent = '';
    void saveQueue.then(() => request('ENABLE_PAGE_IMAGES')).then(data => { if (!data?.ok) throw new Error(); connected = true; if (data.imageCount === 0) status.textContent = 'No images found on this page.'; else dispose(); }).catch(() => { status.textContent = 'Could not enable this page. Reopen Aksara and check site access.'; status.dataset.error = 'true'; }).finally(() => { activating = false; render(); });
  });
  find('site-help').textContent = location.host; find('site-help').title = origin;
  popover.addEventListener('toggle',() => { if (!popover.matches(':popover-open')) dispose(); });
  host.addEventListener('aksara-menu-dispose',dispose); host.addEventListener('click',event => event.stopPropagation());
  root.append(style,popover); document.documentElement.append(host); scope.__aksaraMenuClose = dispose;
  chrome.storage.onChanged.addListener(changed); addEventListener('pagehide',dispose); addEventListener('popstate',dispose); addEventListener('hashchange',dispose); document.addEventListener('visibilitychange',hidden);
  addEventListener('resize',position); window.visualViewport?.addEventListener('resize',position); window.visualViewport?.addEventListener('scroll',position);
  navigation?.addEventListener('currententrychange',entryChanged);
  render(); position(); popover.showPopover(); close.focus({preventScroll:true});
  void loadLocal(); void refresh();
  // Avoid retaining a menu on a changed document URL between asynchronous reads.
  if (location.href !== pageUrl) dispose();
})();
