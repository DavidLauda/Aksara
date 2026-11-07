import type { OcrResult } from './ocr-result';
import type { ImageTranslation, TranslationProblem } from './translation-result';
import { ImageOverlay, measureImage, OVERLAY_CSS } from './image-overlay';
import { SITE_SETTINGS_KEY, OVERLAY_SETTINGS_KEY, siteSettings, siteAllowed, overlaySettings } from './site-settings';
import { ImageControls, CONTROL_CSS } from './image-controls';
// The dedicated IIFE build embeds these helpers in a classic content script.
(() => {
  type Pending = { id: string; src: string; pageUrl: string; state: State; jobId?: string; transferId?: string; workerInstanceId?: string; checkTimer?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout>; stopped: boolean };
  type State = { id: string; image: HTMLImageElement; src: string; visible: boolean; control?: HTMLElement; ui?: ImageControls; status: string; outcome: string; pending?: Pending; ocr?: OcrResult; translation?: ImageTranslation; translationError?: TranslationProblem; overlay?: ImageOverlay; original?: boolean; details?: boolean; fallback?: boolean; overlayNotice?: string; actionNotice?: string };
  type Scope = typeof globalThis & { __aksaraDispose?: () => void; __aksaraImageSnapshot?: (request: string, image: string) => unknown };
  const scope = globalThis as Scope;
  // randomUUID is not exposed on ordinary HTTP documents; getRandomValues is.
  const identifier = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  scope.__aksaraDispose?.();
  // Extension reloads replace the isolated world but can leave its DOM behind.
  // This event only disposes our previous UI; it cannot start an image job.
  for (const previous of document.querySelectorAll<HTMLElement>('div[data-aksara-extension]')) {
    if (previous.dataset.aksaraExtension !== chrome.runtime.id) continue;
    previous.dispatchEvent(new Event('aksara-dispose')); previous.remove();
  }
  const states = new Map<string, State>(), byImage = new WeakMap<HTMLImageElement, State>(), pending = new Map<string, Pending>();
  const acknowledgements = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let port: chrome.runtime.Port | null = null, frame = 0, disposed = false;
  let tracking: ReturnType<typeof setTimeout> | undefined;
  let preferencesReady = false, pageEnabled = true, highContrast = false;
  const preferenceVersions = { [SITE_SETTINGS_KEY]: 0, [OVERLAY_SETTINGS_KEY]: 0 };
  let pageUrl = location.href;
  const allowed = () => preferencesReady && pageEnabled;
  function disconnect() { const connection = port; port = null; try { connection?.disconnect(); } catch { /* Extension context was reloaded. */ } }
  const host = document.createElement('div'); host.id = 'aksara-root'; host.dataset.aksaraExtension = chrome.runtime.id;
  const shadow = host.attachShadow({ mode: 'open' }), style = document.createElement('style');
  style.textContent = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;font:13px/1.45 system-ui,sans-serif!important;color:#193d30!important}
    ${CONTROL_CSS}
    ${OVERLAY_CSS}
  `;
  shadow.append(style); document.documentElement.append(host);
  const source = (image: HTMLImageElement) => image.currentSrc || image.src;
  const eligible = (image: HTMLImageElement) => image.complete && image.naturalWidth >= 120 && image.naturalHeight >= 60
    && image.getBoundingClientRect().width >= 120 && image.getBoundingClientRect().height >= 60
    && image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  function send(fields: Record<string, unknown>) {
    if (!port) {
      const connection = chrome.runtime.connect({ name: 'aksara-images' }); port = connection;
      connection.onMessage.addListener(receive);
      connection.onDisconnect.addListener(() => {
        if (port !== connection) return;
        port = null;
        for (const request of [...pending.values()]) end(request, 'Image preparation was interrupted. Click Translate to retry.', 'error');
      });
    }
    port.postMessage({ schemaVersion: 1, target: 'background', ...fields });
  }
  let activeControlId = '';
  function activate(state: State) {
    if (activeControlId === state.id) return;
    activeControlId = state.id;
    for (const current of states.values()) current.control?.classList.toggle('glass-active', current.id === state.id);
  }
  function render(state: State, queue = true) {
    if (!state.ui) return;
    const code = state.translationError?.code;
    const setup = ['MODEL_NOT_READY', 'MODEL_INTEGRITY_FAILED', 'WEBGPU_UNAVAILABLE'].includes(code ?? '');
    const problem = code === 'MODEL_NOT_READY' ? 'Download the model to translate this text.'
      : code === 'MODEL_INTEGRITY_FAILED' ? 'Repair the translation model in Setup.'
      : code === 'WEBGPU_UNAVAILABLE' ? 'Your browser needs WebGPU for translation.'
      : code === 'MODEL_MEMORY_ERROR' ? 'Close heavy tabs, then try again.'
      : state.translationError ? 'Translation could not finish. Try again.' : '';
    const notice = state.pending || state.translation ? '' : state.actionNotice?.includes('popup') ? state.actionNotice : problem || (!state.ocr ? state.status : '');
    state.ui.render({ status: state.status, pending: !!state.pending, original: !!state.original, highContrast,
      fallback: !!state.fallback, needsReader: !!state.overlayNotice || !!state.translation?.partial || !!state.ocr?.truncated,
      readerOpen: state.details ?? !!state.fallback, partial: !!state.translation?.partial || !!state.ocr?.truncated, sourceText: state.ocr?.text, translatedText: state.translation?.text,
      notice, setup, actionNotice: state.actionNotice ?? '' });
    if (queue) schedule();
  }
  function createControl(state: State) {
    const ui = new ImageControls(state.id, {
      activate: () => activate(state),
      menuOpened: () => { for (const current of states.values()) if (current !== state) current.ui?.closeMenu(); schedule(); },
      translate: () => start(state),
      dismiss: () => {
        if (state.pending) cancel(state.pending, 'Translation cancelled.');
        else { state.status = ''; clearResult(state); render(state); state.ui?.entry.focus({ preventScroll: true }); }
      },
      original: () => { state.original = !state.original; render(state); },
      copy: () => { void copyTranslation(state); },
      read: open => { state.details = open; render(state); },
      contrast: () => {
        highContrast = !highContrast; for (const current of states.values()) render(current);
        void chrome.storage.local.set({ [OVERLAY_SETTINGS_KEY]: { highContrast } }).catch(() => { state.actionNotice = 'Contrast changed for this page.'; render(state); });
      },
      setup: () => { void Promise.resolve().then(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'OPEN_SETUP' })).then(response => { if (!response?.ok) throw new Error('Setup unavailable'); }).catch(() => { state.actionNotice = 'Open Aksara’s popup and choose Setup.'; render(state); }); },
    });
    const control = ui.element;
    control.addEventListener('pointerenter', () => activate(state));
    control.classList.toggle('glass-active', state.id === activeControlId);
    shadow.append(control); state.ui = ui; state.control = control; resize.observe(control); render(state);
  }
  function removeControl(state: State) {
    if (state.control) { resize.unobserve(state.control); state.ui?.dispose(); state.control = undefined; state.ui = undefined; }
  }
  function invalidateNavigation() {
    if (location.href !== pageUrl) {
      pageUrl = location.href;
      for (const request of [...pending.values()]) cancel(request, 'The page changed. Click Translate to retry.');
      for (const state of states.values()) { clearResult(state); state.status = ''; render(state, false); }
    }
  }
  function layout() {
    frame = 0;
    clearTimeout(tracking); tracking = undefined;
    invalidateNavigation();
    let track = false;
    for (const state of states.values()) {
      if (!state.image.isConnected) {
        if (state.pending) cancel(state.pending, 'The image left the page.');
        state.overlay?.dispose(); removeControl(state); intersection.unobserve(state.image); resize.unobserve(state.image); states.delete(state.id); byImage.delete(state.image); continue;
      }
      if (source(state.image) !== state.src) {
        if (state.pending) cancel(state.pending, 'The image changed. Click Translate on the current image.');
        state.src = source(state.image); state.status = ''; clearResult(state); render(state);
      }
      if (allowed() && state.visible && (state.translation || state.pending)) track = true;
      if (!allowed() || !state.visible || !eligible(state.image) || document.hidden) { state.overlay?.hide(); removeControl(state); continue; }
      if (!state.control) createControl(state);
      if (state.translation && state.ocr) {
        track = true;
        state.overlay ??= new ImageOverlay(shadow, state.id); state.overlay.setResult(state.translation);
        const measured = measureImage(state.image, state.ocr);
        const fallback = !measured.mapping.supported;
        if (fallback !== !!state.fallback) state.details = fallback;
        state.fallback = fallback;
        if (measured.hidden) { state.overlay.hide(); state.control!.hidden = true; continue; }
        state.control!.hidden = false;
        if (measured.mapping.supported) {
          const result = state.overlay.update(measured.mapping, !!state.original, highContrast);
          state.overlayNotice = result.overflow || result.missing || result.cropped ? 'Full text available' : '';
        } else {
          state.overlay.hide(); state.overlayNotice = 'Read as text';
        }
        render(state, false);
      }
      const rect = state.image.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewX = viewport?.offsetLeft ?? 0, viewY = viewport?.offsetTop ?? 0, viewWidth = viewport?.width ?? innerWidth, viewHeight = viewport?.height ?? innerHeight;
      const control = state.control!;
      control.style.maxWidth = `${Math.max(0, viewWidth - 16)}px`;
      control.classList.toggle('compact', viewWidth < 320 || rect.width < 260);
      state.ui!.panels.style.maxWidth = `${Math.max(0, viewWidth - 16)}px`;
      const width = control.offsetWidth, height = control.offsetHeight;
      control.style.left = `${Math.max(viewX + 8, Math.min(viewX + viewWidth - width - 8, rect.right - width - 8))}px`;
      const preferred = rect.top + 8;
      control.style.top = `${Math.max(viewY + 8, Math.min(preferred, viewY + viewHeight - height - 8))}px`;
      state.ui!.positionPanel(viewX, viewY, viewWidth, viewHeight);
    }
    // Events handle scrolling immediately; this bounded, visible-result tracker
    // also catches CSS animations, font reflow and layout movement without DOM mutations.
    if (track && !disposed && !document.hidden) tracking = setTimeout(schedule, 80);
  }
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(layout); }
  const resize = new ResizeObserver(schedule);
  const intersection = new IntersectionObserver(entries => { for (const entry of entries) { const state = byImage.get(entry.target as HTMLImageElement); if (state) state.visible = entry.isIntersecting; } schedule(); });
  function discover(image: HTMLImageElement) {
    if (byImage.has(image)) return;
    const state: State = { id: identifier(), image, src: source(image), visible: false, status: '', outcome: '' };
    states.set(state.id, state); byImage.set(image, state); intersection.observe(image); resize.observe(image);
  }
  function scan(node: Element) { if (node instanceof HTMLImageElement) discover(node); for (const image of node.querySelectorAll('img')) discover(image); }
  const mutations = new MutationObserver(records => {
    for (const record of records) {
      if (record.target === host) continue;
      for (const node of record.addedNodes) if (node instanceof Element && node !== host) scan(node);
      if (record.type === 'attributes' && ['src', 'srcset', 'sizes'].includes(record.attributeName ?? '')) {
        const image = record.target instanceof HTMLImageElement ? record.target : record.target instanceof HTMLSourceElement ? record.target.closest('picture')?.querySelector('img') : null;
        const state = image ? byImage.get(image) : undefined;
        if (state?.pending) cancel(state.pending, 'The image source changed. Click Translate again.');
        if (state) { state.status = ''; clearResult(state); render(state); }
      }
    }
    schedule();
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'style', 'class', 'hidden', 'open'] }); scan(document.documentElement);
  const onLoad = (event: Event) => { if (event.target instanceof HTMLImageElement) { discover(event.target); schedule(); } };
  const onPointer = (event: PointerEvent) => { if (event.target instanceof HTMLImageElement) { const state = byImage.get(event.target); if (state) activate(state); } };
  const onPointerOut = (event: PointerEvent) => { if (event.target instanceof HTMLImageElement) byImage.get(event.target)?.control?.classList.remove('hover'); };
  const closeOutsideMenus = (event: Event) => { const path = event.composedPath(); for (const state of states.values()) if (state.ui?.isMenuOpen && !path.includes(state.control!)) state.ui.closeMenu(); };
  document.addEventListener('pointerdown', closeOutsideMenus, true); document.addEventListener('focusin', closeOutsideMenus, true);
  document.addEventListener('load', onLoad, true); document.addEventListener('pointerover', onPointer, true); document.addEventListener('pointerout', onPointerOut, true);
  addEventListener('scroll', schedule, true); addEventListener('resize', schedule);
  addEventListener('popstate', schedule); addEventListener('hashchange', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
  function clearResult(state: State) { state.ocr = undefined; state.translation = undefined; state.translationError = undefined; state.overlay?.dispose(); state.overlay = undefined; state.original = false; state.details = undefined; state.fallback = false; state.overlayNotice = ''; state.actionNotice = ''; }
  async function copyTranslation(state: State) {
    const text = state.translation?.text ?? state.ocr?.text;
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea'); field.value = text; field.setAttribute('aria-label', 'Temporary copy field');
        field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'; shadow.append(field);
        const focused = shadow.activeElement as HTMLElement | null;
        try { field.focus({ preventScroll: true }); field.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
        finally { field.remove(); focused?.focus({ preventScroll: true }); }
      }
      if ((state.translation?.text ?? state.ocr?.text) === text) { state.actionNotice = state.translation ? 'Translation copied.' : 'Text copied.'; state.ui?.flashCopied(); render(state); }
    } catch {
      state.details = true; state.actionNotice = 'Copy was blocked. Select the text to copy it manually.'; render(state);
      const field = state.control?.querySelector<HTMLTextAreaElement>(state.translation ? '.translated-text' : '.recognized-text'); field?.focus(); field?.select();
    }
  }
  function start(state: State) {
    if (state.pending || !allowed()) return;
    activate(state);
    invalidateNavigation();
    const request: Pending = { id: identifier(), src: source(state.image), pageUrl, state, stopped: false };
    state.pending = request; clearResult(state); state.status = 'Reading image…'; state.outcome = ''; pending.set(request.id, request); render(state);
    state.control?.querySelector<HTMLButtonElement>('.dismiss')?.focus();
    request.deadline = setTimeout(() => {
      cancel(request, 'Image reading timed out. Click Translate to retry.'); state.outcome = 'error'; render(state);
    }, 380_000);
    let checking = false;
    request.checkTimer = setInterval(() => {
      if (checking || request.stopped) return;
      checking = true;
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Background did not respond.')), 3000); });
      void Promise.race([Promise.resolve().then(() => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'PING' })), timeout]).then(response => {
        if (!response?.ok || (request.workerInstanceId && response.instanceId !== request.workerInstanceId)) throw new Error('Background restarted.');
      }).catch(() => {
        if (request.stopped) return;
        disconnect();
        for (const current of [...pending.values()]) end(current, 'Image reading was interrupted. Click Translate to retry.', 'error');
      }).finally(() => { clearTimeout(timer); checking = false; });
    }, 5000);
    try { send({ type: 'PREPARE_IMAGE', requestId: request.id, imageId: state.id }); } catch { end(request, 'Reload this page to reconnect Aksara.', 'error'); }
  }
  function end(request: Pending, message: string, outcome = '') {
    if (request.stopped) return;
    request.stopped = true; clearInterval(request.checkTimer); clearTimeout(request.deadline); pending.delete(request.id); request.state.pending = undefined;
    for (const [key, ack] of acknowledgements) if (key.startsWith(`${request.id}:`)) { clearTimeout(ack.timer); ack.reject(new Error(message)); acknowledgements.delete(key); }
    request.state.status = message; request.state.outcome = outcome; render(request.state);
  }
  function cancel(request: Pending, message: string) { try { send({ type: 'CANCEL_IMAGE', requestId: request.id, jobId: request.jobId }); } catch { /* Context invalidated. */ } end(request, message); }
  function assertLive(request: Pending) { if (request.stopped || !request.state.image.isConnected || source(request.state.image) !== request.src || request.pageUrl !== location.href) throw new Error('The page or image changed before it could be read.'); }
  function sendWithAck(request: Pending, index: number, fields: Record<string, unknown>) {
    assertLive(request);
    return new Promise<void>((resolve, reject) => {
      const key = `${request.id}:${index}`, timer = setTimeout(() => { acknowledgements.delete(key); reject(new Error('The image transfer timed out. Please retry.')); }, 10_000);
      acknowledgements.set(key, { resolve, reject, timer });
      try { send({ requestId: request.id, jobId: request.jobId, transferId: request.transferId, ...fields }); } catch (error) { clearTimeout(timer); acknowledgements.delete(key); reject(error); }
    });
  }
  async function upload(request: Pending, chunkBytes: number, maxBytes: number) {
    const image = request.state.image; assertLive(request);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('This image exceeds the 16 megapixel preparation limit.');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    let blob: Blob | null;
    try { canvas.getContext('2d')!.drawImage(image, 0, 0); blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); }
    catch { throw new Error('This displayed image cannot be read because of the site’s security settings.'); }
    finally { canvas.width = canvas.height = 1; }
    assertLive(request);
    if (!blob || blob.size > maxBytes) throw new Error('The displayed image is larger than the 8 MB preparation limit.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await sendWithAck(request, -1, { type: 'IMAGE_UPLOAD_BEGIN', bytes: bytes.length, mimeType: 'image/png', chunkCount: Math.ceil(bytes.length / chunkBytes) });
    for (let offset = 0, index = 0; offset < bytes.length; offset += chunkBytes, index++) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length)); let binary = '';
      for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
      await sendWithAck(request, index, { type: 'IMAGE_CHUNK', index, base64: btoa(binary) });
    }
    assertLive(request); send({ type: 'IMAGE_UPLOAD_END', requestId: request.id, jobId: request.jobId, transferId: request.transferId });
  }
  function receive(message: Record<string, unknown>) {
    if (message.schemaVersion !== 1 || message.target !== 'content' || typeof message.requestId !== 'string') return;
    const request = pending.get(message.requestId); if (!request) return;
    if (typeof message.workerInstanceId === 'string') request.workerInstanceId ??= message.workerInstanceId;
    if (!request.state.image.isConnected || source(request.state.image) !== request.src || request.pageUrl !== location.href) { cancel(request, 'The page or image changed. Click Translate again.'); return; }
    if (typeof message.jobId === 'string') request.jobId = message.jobId;
    if (message.type === 'IMAGE_UPLOAD_ACK') {
      const key = `${request.id}:${message.index}`, ack = acknowledgements.get(key); if (ack) { clearTimeout(ack.timer); acknowledgements.delete(key); ack.resolve(); }
    } else if (message.type === 'IMAGE_UPLOAD_READY') {
      request.transferId = String(message.transferId);
      if (message.chunkBytes !== 192 * 1024 || message.maxBytes !== 8 * 1024 * 1024) { cancel(request, 'Reload the page to update Aksara’s image connection.'); return; }
      void upload(request, message.chunkBytes, message.maxBytes).catch(error => { if (!request.stopped) { cancel(request, error instanceof Error ? error.message : 'Could not read the displayed image.'); request.state.outcome = 'error'; render(request.state); } });
    } else if (message.type === 'IMAGE_PROGRESS') {
      const fraction = typeof message.fraction === 'number' && Number.isFinite(message.fraction) ? Math.round(Math.max(0, Math.min(1, message.fraction)) * 100) : null;
      request.state.status = message.stage === 'translate' ? `Translating on this device${fraction === null ? '…' : ` · ${fraction}%`}` : message.stage === 'model_verify' ? `Verifying cached model${fraction === null ? '…' : ` · ${fraction}%`}` : message.stage === 'model_prepare' ? 'Loading local translation model…' : message.stage === 'ocr' ? `Reading text${fraction === null ? '…' : ` · ${fraction}%`}` : message.stage === 'ocr_prepare' ? 'Starting local text reader…' : message.stage === 'decode' ? 'Checking image…' : 'Reading image…'; render(request.state);
    }
    else if (message.type === 'IMAGE_ERROR') end(request, typeof message.userMessage === 'string' ? message.userMessage : 'Could not prepare this image.', message.code === 'CANCELLED' ? '' : 'error');
    else if (message.type === 'IMAGE_READY') {
      const image = message.image as { width: number; height: number; ocr?: OcrResult; translation?: ImageTranslation; translationError?: TranslationProblem };
      if (!image?.ocr || typeof image.ocr.text !== 'string' || !Array.isArray(image.ocr.lines)) { end(request, 'Reload Aksara to update the text reader.', 'error'); return; }
      request.state.ocr = image.ocr;
      request.state.translation = image.translation;
      request.state.translationError = image.translationError;
      const language = image.ocr.sourceLanguage === 'ind_Latn' ? 'Indonesian' : 'English';
      const target = image.ocr.targetLanguage === 'ind_Latn' ? 'Indonesian' : image.ocr.targetLanguage === 'fra_Latn' ? 'French' : 'English';
      end(request, image.translation ? image.translation.sameLanguage ? `Already in ${target}` : `${image.translation.partial ? 'Partly translated' : 'Translated'} · ${language} → ${target}` : `Text recognized · ${language}`, 'ready');
    }
  }
  scope.__aksaraImageSnapshot = (requestId, imageId) => {
    const request = pending.get(requestId);
    if (!allowed() || !request || request.stopped || request.state.id !== imageId || !request.state.image.isConnected || source(request.state.image) !== request.src || request.pageUrl !== location.href) return null;
    const image = request.state.image, kind = /^(data:|blob:)/.test(request.src) ? 'inline' : 'url';
    return { imageId, kind, ...(kind === 'url' ? { url: request.src } : {}), width: image.naturalWidth, height: image.naturalHeight };
  };
  const ping = (message: { type?: string }, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => { if (sender.id === chrome.runtime.id && message?.type === 'AKSARA_PING') reply({ ok: true, controlsEnabled: allowed(), imageCount: document.images.length, eligibleCount: allowed() ? [...states.values()].filter(state => eligible(state.image)).length : 0 }); };
  chrome.runtime.onMessage.addListener(ping);
  const onPageHide = () => { for (const request of [...pending.values()]) cancel(request, 'The page changed.'); disconnect(); for (const state of states.values()) { clearResult(state); state.status = ''; render(state); } };
  const applyPreferences = (saved: Record<string, unknown>, initial = false) => {
    if (SITE_SETTINGS_KEY in saved) {
      const enabled = siteAllowed(siteSettings(saved[SITE_SETTINGS_KEY]), location.origin);
      if (initial) pageEnabled = enabled;
      else if (!enabled) {
        pageEnabled = false;
        for (const request of [...pending.values()]) cancel(request, 'Image controls disabled on this site.');
        for (const state of states.values()) { clearResult(state); state.status = ''; removeControl(state); }
      }
    }
    if (OVERLAY_SETTINGS_KEY in saved) highContrast = overlaySettings(saved[OVERLAY_SETTINGS_KEY]).highContrast;
    if (SITE_SETTINGS_KEY in saved) preferencesReady = true;
    for (const state of states.values()) render(state); schedule();
  };
  const preferenceChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const saved: Record<string, unknown> = {};
    for (const key of [SITE_SETTINGS_KEY, OVERLAY_SETTINGS_KEY] as const) if (key in changes) { saved[key] = changes[key].newValue; preferenceVersions[key]++; }
    if (!Object.keys(saved).length) return;
    applyPreferences(saved);
  };
  chrome.storage.onChanged.addListener(preferenceChanged);
  const loadingVersions = { ...preferenceVersions };
  void chrome.storage.local.get([SITE_SETTINGS_KEY, OVERLAY_SETTINGS_KEY]).then(saved => {
    if (disposed) return;
    const current: Record<string, unknown> = {};
    for (const key of [SITE_SETTINGS_KEY, OVERLAY_SETTINGS_KEY] as const) if (loadingVersions[key] === preferenceVersions[key]) current[key] = saved[key];
    applyPreferences(current, true);
  }).catch(() => { /* No controls before the user's site preference can be read. */ });
  addEventListener('pagehide', onPageHide);
  const dispose = () => {
    if (disposed) return;
    document.removeEventListener('pointerdown', closeOutsideMenus, true); document.removeEventListener('focusin', closeOutsideMenus, true);
    disposed = true; onPageHide(); clearTimeout(tracking); cancelAnimationFrame(frame); mutations.disconnect(); intersection.disconnect(); resize.disconnect(); host.remove();
    host.removeEventListener('aksara-dispose', dispose);
    document.removeEventListener('load', onLoad, true); document.removeEventListener('pointerover', onPointer, true); document.removeEventListener('pointerout', onPointerOut, true);
    removeEventListener('scroll', schedule, true); removeEventListener('resize', schedule); removeEventListener('pagehide', onPageHide);
    removeEventListener('popstate', schedule); removeEventListener('hashchange', schedule);
    document.removeEventListener('visibilitychange', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
    try { chrome.runtime.onMessage.removeListener(ping); chrome.storage.onChanged.removeListener(preferenceChanged); } catch { /* Old extension context. */ }
    delete scope.__aksaraImageSnapshot;
  };
  scope.__aksaraDispose = dispose; host.addEventListener('aksara-dispose', dispose);
})();
