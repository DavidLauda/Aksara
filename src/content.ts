import type { OcrResult } from './ocr-result';
import type { ImageTranslation, TranslationProblem } from './translation-result';
// Keep this entry free of runtime imports: Chrome content scripts are classic scripts.
(() => {
  type Pending = { id: string; src: string; state: State; jobId?: string; transferId?: string; workerInstanceId?: string; checkTimer?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout>; stopped: boolean };
  type State = { id: string; image: HTMLImageElement; src: string; visible: boolean; control?: HTMLElement; status: string; outcome: string; pending?: Pending; ocr?: OcrResult; translation?: ImageTranslation; translationError?: TranslationProblem };
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
  function disconnect() { const connection = port; port = null; try { connection?.disconnect(); } catch { /* Extension context was reloaded. */ } }
  const host = document.createElement('div'); host.id = 'aksara-root'; host.dataset.aksaraExtension = chrome.runtime.id;
  const shadow = host.attachShadow({ mode: 'open' }), style = document.createElement('style');
  style.textContent = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;font:13px/1.45 system-ui,sans-serif!important;color:#233d31!important}
    *{box-sizing:border-box}.control{position:absolute;pointer-events:none;width:min(260px,calc(100vw - 16px));text-align:right}
    button{pointer-events:auto;min-height:32px;font:600 12px/1.4 system-ui,sans-serif;border:1px solid #b4cdbd;border-radius:7px;padding:7px 11px;background:#fffef9;color:#234d38;cursor:pointer;box-shadow:0 2px 7px #0002}
    button:focus-visible,textarea:focus-visible{outline:3px solid #d5a53c;outline-offset:3px}.translate{opacity:.85;transition:opacity .12s}
    .control.hover .translate,.control:focus-within .translate,.control.busy .translate,.control.has-status .translate{opacity:1}button:hover{background:#e9f1e7}button:disabled{cursor:wait}
    .card{pointer-events:auto;margin-top:5px;padding:10px 12px;background:#fffef9;border:1px solid #c6d7c8;border-radius:8px;box-shadow:0 3px 13px #0002;text-align:left;overflow-wrap:anywhere;max-height:calc(100vh - 72px);overflow:auto}.card[hidden],[hidden]{display:none}.card.error{border-color:#d9bda3;color:#713c24}.card p{margin:0;font:12px/1.5 system-ui,sans-serif}.card button{margin-top:8px;box-shadow:none;padding:4px 8px}.recognized-text{display:block;width:100%;height:100px;resize:vertical;max-height:180px;margin:9px 0 0;padding:8px;border:1px solid #bdcdbd;border-radius:4px;background:#f4f5ef;color:#233d31;font:13px/1.5 system-ui,sans-serif}.card .quality{margin-top:6px;color:#713c24}
    .recognized-text[hidden],.translated-text[hidden]{display:none}.translated-text{display:block;width:100%;height:100px;resize:vertical;max-height:180px;margin:9px 0 0;padding:8px;border:1px solid #8da996;border-radius:4px;background:#eaf1e7;color:#233d31;font:14px/1.5 system-ui,sans-serif}.field-label{display:block;margin-top:8px;font:600 11px/1.4 system-ui,sans-serif}.field-label[hidden]{display:none}
    @media(prefers-reduced-motion:reduce){.translate{transition:none}}
  `;
  shadow.append(style); document.documentElement.append(host);
  const source = (image: HTMLImageElement) => image.currentSrc || image.src;
  const eligible = (image: HTMLImageElement) => image.complete && image.naturalWidth >= 120 && image.naturalHeight >= 60 && image.getBoundingClientRect().width >= 120 && image.getBoundingClientRect().height >= 60;
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
  function render(state: State) {
    const control = state.control; if (!control) return;
    control.classList.toggle('busy', Boolean(state.pending)); control.classList.toggle('has-status', Boolean(state.status));
    control.querySelector<HTMLButtonElement>('.translate')!.disabled = Boolean(state.pending);
    const card = control.querySelector<HTMLElement>('.card')!;
    card.hidden = !state.status; card.classList.toggle('error', state.outcome === 'error'); card.querySelector('p')!.textContent = state.status;
    const action = card.querySelector<HTMLButtonElement>('button')!;
    action.textContent = state.pending ? 'Cancel' : 'Dismiss'; action.setAttribute('aria-label', state.pending ? 'Cancel image preparation' : 'Dismiss image status');
    const text = card.querySelector<HTMLTextAreaElement>('.recognized-text')!; text.hidden = !state.ocr; text.value = state.ocr?.text ?? '';
    const translated = card.querySelector<HTMLTextAreaElement>('.translated-text')!; translated.hidden = !state.translation; translated.value = state.translation?.text ?? '';
    card.querySelector<HTMLElement>('.original-label')!.hidden = !state.ocr;
    card.querySelector<HTMLElement>('.translated-label')!.hidden = !state.translation;
    const quality = card.querySelector<HTMLElement>('.quality')!;
    const notices = [state.translationError?.userMessage, state.translation?.partial ? `Partial translation: ${state.translation.skippedSegments} text sections skipped or the OCR limit was reached. Try a smaller crop for the rest.` : '', state.ocr?.lowConfidence ? 'Some text may be inaccurate. Check the image language or try a clearer image.' : '', state.ocr?.truncated ? 'This preview reached the text limit. Read a smaller image for the remaining text.' : ''];
    quality.textContent = notices.filter(Boolean).join(' '); quality.hidden = !quality.textContent;
    schedule();
  }
  function createControl(state: State) {
    const control = document.createElement('div'); control.className = 'control'; control.dataset.imageId = state.id;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'translate'; button.textContent = 'Translate'; button.setAttribute('aria-label', 'Translate image');
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted) start(state); });
    const card = document.createElement('div'); card.className = 'card'; card.hidden = true;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const text = document.createElement('textarea'); text.className = 'recognized-text'; text.readOnly = true; text.hidden = true; text.setAttribute('aria-label', 'Recognized text'); text.spellcheck = false;
    const translated = document.createElement('textarea'); translated.className = 'translated-text'; translated.readOnly = true; translated.hidden = true; translated.setAttribute('aria-label', 'Translated text'); translated.spellcheck = false;
    const originalLabel = document.createElement('span'); originalLabel.className = 'field-label original-label'; originalLabel.textContent = 'Recognized text'; originalLabel.hidden = true;
    const translatedLabel = document.createElement('span'); translatedLabel.className = 'field-label translated-label'; translatedLabel.textContent = 'Translation'; translatedLabel.hidden = true;
    const quality = document.createElement('p'); quality.className = 'quality'; quality.hidden = true;
    const action = document.createElement('button'); action.type = 'button';
    action.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); if (!event.isTrusted) return;
      if (state.pending) cancel(state.pending, 'Image translation cancelled.'); else { state.status = ''; clearResult(state); render(state); button.focus(); }
    });
    card.append(status, translatedLabel, translated, originalLabel, text, quality, action); control.append(button, card);
    control.addEventListener('pointerenter', () => control.classList.add('hover')); control.addEventListener('pointerleave', () => control.classList.remove('hover'));
    shadow.append(control); state.control = control; render(state);
  }
  function layout() {
    frame = 0;
    for (const state of states.values()) {
      if (!state.image.isConnected) {
        if (state.pending) cancel(state.pending, 'The image left the page.');
        state.control?.remove(); intersection.unobserve(state.image); resize.unobserve(state.image); states.delete(state.id); byImage.delete(state.image); continue;
      }
      if (source(state.image) !== state.src) {
        if (state.pending) cancel(state.pending, 'The image changed. Click Translate on the current image.');
        state.src = source(state.image); state.status = ''; clearResult(state); render(state);
      }
      if (!state.visible || !eligible(state.image)) { state.control?.remove(); state.control = undefined; continue; }
      if (!state.control) createControl(state);
      const rect = state.image.getBoundingClientRect();
      const width = state.control!.offsetWidth;
      state.control!.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width - 8))}px`;
      state.control!.style.top = `${Math.max(8, Math.min(rect.top + 8, innerHeight - state.control!.offsetHeight - 8))}px`;
    }
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
      for (const node of record.addedNodes) if (node instanceof Element && node !== host) scan(node);
      if (record.type === 'attributes') {
        const image = record.target instanceof HTMLImageElement ? record.target : record.target instanceof HTMLSourceElement ? record.target.closest('picture')?.querySelector('img') : null;
        const state = image ? byImage.get(image) : undefined;
        if (state?.pending) cancel(state.pending, 'The image source changed. Click Translate again.');
        if (state) { state.status = ''; clearResult(state); render(state); }
      }
    }
    schedule();
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] }); scan(document.documentElement);
  const onLoad = (event: Event) => { if (event.target instanceof HTMLImageElement) { discover(event.target); schedule(); } };
  const onPointer = (event: PointerEvent) => { if (event.target instanceof HTMLImageElement) byImage.get(event.target)?.control?.classList.add('hover'); };
  const onPointerOut = (event: PointerEvent) => { if (event.target instanceof HTMLImageElement) byImage.get(event.target)?.control?.classList.remove('hover'); };
  document.addEventListener('load', onLoad, true); document.addEventListener('pointerover', onPointer, true); document.addEventListener('pointerout', onPointerOut, true);
  addEventListener('scroll', schedule, true); addEventListener('resize', schedule);
  function clearResult(state: State) { state.ocr = undefined; state.translation = undefined; state.translationError = undefined; }
  function start(state: State) {
    if (state.pending) return;
    const request: Pending = { id: identifier(), src: source(state.image), state, stopped: false };
    state.pending = request; clearResult(state); state.status = 'Reading image…'; state.outcome = ''; pending.set(request.id, request); render(state);
    state.control?.querySelector<HTMLButtonElement>('.card button')?.focus();
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
  function assertLive(request: Pending) { if (request.stopped || !request.state.image.isConnected || source(request.state.image) !== request.src) throw new Error('The image changed before it could be read.'); }
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
    if (!request.state.image.isConnected || source(request.state.image) !== request.src) { cancel(request, 'The image changed. Click Translate again.'); return; }
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
      end(request, image.translation ? image.translation.sameLanguage ? `Already in ${target}` : `${image.translation.partial ? 'Partly translated' : 'Translated'} · ${language} → ${target}` : `Text recognized · ${language} · ${image.ocr.lines.length} ${image.ocr.lines.length === 1 ? 'line' : 'lines'} · ${Math.round(image.ocr.confidence * 100)}% confidence`, 'ready');
    }
  }
  scope.__aksaraImageSnapshot = (requestId, imageId) => {
    const request = pending.get(requestId);
    if (!request || request.stopped || request.state.id !== imageId || !request.state.image.isConnected || source(request.state.image) !== request.src) return null;
    const image = request.state.image, kind = /^(data:|blob:)/.test(request.src) ? 'inline' : 'url';
    return { imageId, kind, ...(kind === 'url' ? { url: request.src } : {}), width: image.naturalWidth, height: image.naturalHeight };
  };
  const ping = (message: { type?: string }, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => { if (sender.id === chrome.runtime.id && message?.type === 'AKSARA_PING') reply({ ok: true, imageCount: document.images.length, eligibleCount: [...states.values()].filter(state => eligible(state.image)).length }); };
  chrome.runtime.onMessage.addListener(ping);
  const onPageHide = () => { for (const request of [...pending.values()]) cancel(request, 'The page changed.'); disconnect(); };
  addEventListener('pagehide', onPageHide);
  const dispose = () => {
    if (disposed) return;
    disposed = true; onPageHide(); cancelAnimationFrame(frame); mutations.disconnect(); intersection.disconnect(); resize.disconnect(); host.remove();
    host.removeEventListener('aksara-dispose', dispose);
    document.removeEventListener('load', onLoad, true); document.removeEventListener('pointerover', onPointer, true); document.removeEventListener('pointerout', onPointerOut, true);
    removeEventListener('scroll', schedule, true); removeEventListener('resize', schedule); removeEventListener('pagehide', onPageHide);
    try { chrome.runtime.onMessage.removeListener(ping); } catch { /* Old extension context. */ }
    delete scope.__aksaraImageSnapshot;
  };
  scope.__aksaraDispose = dispose; host.addEventListener('aksara-dispose', dispose);
})();
