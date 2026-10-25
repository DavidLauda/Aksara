import { checkGpu } from './gpu';
import { errorMessage, isEnvelope, PAIRS, type Pair, type Host, type Job, type Operation, type Progress } from './protocol';
import * as translationModule from './translation';
import { ImageAcquisition } from './image-acquisition';
import { ImageAcquisitionError } from './image-policy';
import { ModelManager } from './model-manager';
import { translationProblem } from './translation-result';
import type { OcrResult } from './ocr-result';

let active: Job | null = null;
let latest: Job | null = null;
let creating: Promise<void> | null = null;
let loadedHost: Host | null = null;
let needsReload = false;
const operations = new Set<Operation>(['CHECK_GPU', 'OCR_SAMPLE', 'TRANSLATE_SAMPLE', 'PIPELINE_SAMPLE', 'UNLOAD_MODEL']);

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS], justification: 'Run the bundled Tesseract OCR worker and an optional WebGPU inference worker for user-requested image translation.' }).finally(() => { creating = null; });
  await creating;
}
async function offscreen(type: string, job: Job, fields: Record<string, unknown> = {}) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ schemaVersion: 1, target: 'offscreen', type, jobId: job.id, ...fields });
  if (!response?.ok) throw new Error(response?.error || 'The OCR/inference context did not respond.');
  return response.result;
}
const images: ImageAcquisition = new ImageAcquisition(() => Boolean(active) || modelManager.busy || needsReload, async (id, languages, signal) => {
  if (loadedHost === 'service-worker') { await translationModule.unload(); loadedHost = null; }
  await ensureOffscreen();
  if (signal.aborted) throw new ImageAcquisitionError('CANCELLED', 'Image reading was cancelled.');
  let closing: Promise<void> | undefined;
  const cancel = () => { closing = chrome.offscreen.closeDocument().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    // Only opaque lifecycle metadata survives a service-worker interruption.
    await chrome.storage.session.set({ activeImageJob: { id } });
    if (signal.aborted) throw new ImageAcquisitionError('CANCELLED', 'Image reading was cancelled.');
    const response = await chrome.runtime.sendMessage({ schemaVersion: 1, target: 'offscreen', type: 'READ_IMAGE', jobId: id, languages });
    if (!response?.ok) throw new ImageAcquisitionError(response?.code || 'OCR_FAILED', response?.error || 'Aksara could not read the text. Check the source language or try another image.');
    const image = response.result as { ocr: OcrResult };
    images.progress(id, { stage: 'model_prepare', fraction: null });
    loadedHost = 'offscreen-worker';
    const translated = await chrome.runtime.sendMessage({ schemaVersion: 1, target: 'offscreen', type: 'TRANSLATE_IMAGE', jobId: id, ocr: image.ocr });
    if (signal.aborted) throw new ImageAcquisitionError('CANCELLED', 'Translation cancelled.');
    if (!translated?.ok) return { ...image, translationError: translationProblem(translated?.error || 'TRANSLATION_FAILED') };
    return { ...image, translation: translated.result };
  } catch (error) {
    if (!closing && !(error instanceof ImageAcquisitionError && error.code === 'NO_TEXT_FOUND')) cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    await closing;
    await chrome.storage.session.remove('activeImageJob');
  }
}, () => recovered);
const modelManager: ModelManager = new ModelManager(() => Boolean(active) || images.busy || needsReload, async () => {
  await translationModule.unload(); loadedHost = null;
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) await chrome.offscreen.closeDocument();
});
chrome.runtime.onConnect.addListener(port => images.connect(port));
function notify(job: Job) {
  void chrome.runtime.sendMessage({ schemaVersion: 1, target: 'diagnostics', type: 'JOB_UPDATED', job }).catch(() => {});
}
function progress(job: Job, event: Progress) {
  if (active?.id !== job.id) return;
  job.progress = event;
  notify(job);
}
async function release(job: Job) {
  await translationModule.unload();
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) await offscreen('UNLOAD', job);
  loadedHost = null;
  return { released: true, note: 'Model weights remain cached on disk.' };
}
async function translateSample(job: Job, text: string) {
  // loadedHost is volatile across MV3 restarts. The offscreen worker can still
  // be warm after this service worker wakes, so always reclaim it before loading
  // a service-worker model; never allow two NLLB instances to coexist.
  if (job.host === 'service-worker') {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) await offscreen('UNLOAD', job);
  }
  if (loadedHost && loadedHost !== job.host) await release(job);
  loadedHost = job.host;
  if (job.host === 'offscreen-worker') return offscreen('RUN_TRANSLATION', job, { text, pair: job.pair });
  return translationModule.translate(text, chrome.runtime.getURL(''), event => progress(job, event), job.pair);
}
async function run(job: Job, language: 'eng' | 'ind') {
  // Only active jobs receive a bounded heartbeat. Idle extensions have no keepalive.
  const heartbeat = setInterval(() => notify(job), 10_000);
  const watchdog = setTimeout(() => {
    if (active?.id !== job.id) return;
    job.state = 'error'; job.error = 'JOB_TIMEOUT: The feasibility check exceeded ten minutes. Reload the extension before retrying.';
    job.elapsedMs = Date.now() - job.startedAt;
    clearInterval(heartbeat); active = null; needsReload = true; notify(job);
    void chrome.storage.session.set({ lastJob: metadata(job) });
    // Closing the host stops its worker/download immediately. Service-worker ONNX
    // sessions cannot be forcibly cancelled safely; UI prevents concurrent retries.
    if (job.host === 'offscreen-worker') void chrome.offscreen.closeDocument().catch(() => {});
  }, 600_000);
  try {
    let result: unknown;
    switch (job.operation) {
      case 'CHECK_GPU': result = { serviceWorker: await checkGpu(), offscreenWorker: await offscreen('CHECK_GPU', job) }; break;
      case 'OCR_SAMPLE': result = await offscreen('RUN_OCR', job, { language }); break;
      case 'UNLOAD_MODEL': result = await release(job); break;
      case 'TRANSLATE_SAMPLE': result = await translateSample(job, PAIRS[job.pair].text); break;
      case 'PIPELINE_SAMPLE': {
        const ocr = await offscreen('RUN_OCR', job, { language: 'eng' });
        const translation = await translateSample(job, ocr.text);
        result = { ocr, translation }; break;
      }
    }
    if (job.state !== 'running') return;
    job.result = result; job.state = 'done'; job.progress = { stage: 'done', fraction: 1 };
  } catch (error) {
    job.state = 'error'; job.error = error instanceof Error ? error.stack || error.message : errorMessage(error);
  } finally {
    clearInterval(heartbeat); clearTimeout(watchdog);
    job.elapsedMs = Date.now() - job.startedAt;
    if (active?.id === job.id) active = null;
    latest = job;
    await chrome.storage.session.set({ lastJob: metadata(job) });
    notify(job);
  }
}
function metadata(job: Job) {
  // Persist lifecycle state, never OCR text, image bytes, or translations.
  const { result, ...safe } = job;
  return safe;
}
const recovered = (async () => {
  await modelManager.recover();
  const { lastJob, activeImageJob } = await chrome.storage.session.get(['lastJob', 'activeImageJob']);
  if (activeImageJob) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) await chrome.offscreen.closeDocument();
    await chrome.storage.session.remove('activeImageJob');
  }
  if (!lastJob) return;
  latest = lastJob as Job;
  if (latest.state === 'running') {
    // Reclaim an orphaned OCR/inference worker before accepting a new job.
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) await chrome.offscreen.closeDocument();
    latest.state = 'error';
    latest.error = 'INTERRUPTED: The background context restarted. Cached model files are preserved; run the check again.';
    latest.elapsedMs = Date.now() - latest.startedAt;
    await chrome.storage.session.set({ lastJob: metadata(latest) });
    notify(latest);
  }
})();
async function handleUi(message: Record<string, unknown>, sendResponse: (response: unknown) => void) {
  await recovered;
  const modelResponse = await modelManager.handle(message);
  if (modelResponse !== undefined) { sendResponse(modelResponse); return; }
  if (message.type === 'GET_JOB') { sendResponse({ ok: true, job: latest }); return; }
  if (message.type !== 'START_JOB' || !operations.has(message.operation as Operation)) { sendResponse({ ok: false, error: 'INVALID_REQUEST' }); return; }
  if (needsReload) { sendResponse({ ok: false, error: 'RELOAD_REQUIRED: Reload the extension after the timed out inference job.' }); return; }
  if (active || images.busy || modelManager.busy) { sendResponse({ ok: false, error: 'BUSY: An Aksara job is already running.' }); return; }
  const pair = message.operation === 'TRANSLATE_SAMPLE' && (message.pair === 'id-en' || message.pair === 'en-fr') ? message.pair as Pair : 'en-id';
  const job: Job = { id: crypto.randomUUID(), operation: message.operation as Operation, host: message.host === 'offscreen-worker' ? 'offscreen-worker' : 'service-worker', pair, state: 'running', progress: { stage: 'starting', fraction: null }, startedAt: Date.now() };
  active = latest = job;
  try { await chrome.storage.session.set({ lastJob: metadata(job) }); } catch (error) { active = null; throw error; }
  sendResponse({ schemaVersion: 1, type: 'JOB_ACCEPTED', ok: true, jobId: job.id });
  void run(job, message.language === 'ind' ? 'ind' : 'eng');
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isEnvelope(message, 'background') || sender.id !== chrome.runtime.id) return;
  if (message.type === 'PING') { sendResponse({ schemaVersion: 1, ok: true, version: chrome.runtime.getManifest().version, instanceId: images.instanceId }); return; }
  if (message.type === 'OFFSCREEN_PROGRESS') {
    const job = active;
    if (sender.url === chrome.runtime.getURL('offscreen.html')) {
      if (job && job.id === message.jobId) progress(job, message.event as Progress);
      images.progress(String(message.jobId), message.event);
    }
    return;
  }
  // Feasibility operations may only be started from our extension UI, never a webpage.
  if (!sender.url?.startsWith(chrome.runtime.getURL('')) || (sender.url !== chrome.runtime.getURL('options.html') && sender.url !== chrome.runtime.getURL('popup.html'))) { sendResponse({ ok: false, error: 'UNAUTHORIZED_CONTEXT' }); return; }
  void handleUi(message, sendResponse).catch(error => { sendResponse({ ok: false, error: errorMessage(error) }); });
  return true;
});
