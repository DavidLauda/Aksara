import { createWorker, OEM, PSM, type Worker as TesseractWorker } from 'tesseract.js';
import { errorMessage, isEnvelope, type Pair, type Progress, SAMPLE_TEXT } from './protocol';
import { imageStore } from './image-store';
import { assertDimensions, ImageAcquisitionError, inspectRaster } from './image-policy';
import { languageSettings, ocrLanguage, type LanguageSettings } from './languages';
import { normalizeOcr } from './ocr-result';
import type { OcrResult } from './ocr-result';
import { TRANSLATION_LIMITS } from './translation-result';

let ocr: TesseractWorker | null = null;
let translationWorker: globalThis.Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress: (event: Progress) => void }>();
function report(jobId: string, event: Progress) {
  void chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'OFFSCREEN_PROGRESS', jobId, event }).catch(() => {});
}
function workerRequest(type: string, jobId: string, text?: string, pair: Pair = 'en-id', imageOcr?: OcrResult) {
  clearTimeout(idleTimer);
  if (type === 'UNLOAD') {
    translationWorker?.terminate(); translationWorker = null;
    for (const task of pending.values()) task.reject(new Error('Inference context was released.'));
    pending.clear();
    return Promise.resolve({ released: true, workerTerminated: true });
  }
  if (!translationWorker) {
    translationWorker = new Worker(new URL('./translation.worker.ts', import.meta.url), { type: 'module' });
    translationWorker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      if (data.type === 'PROGRESS') { task.progress(data.event); return; }
      pending.delete(data.id);
      if (data.type === 'ERROR') {
        task.reject(new Error(data.error));
        translationWorker?.terminate(); translationWorker = null;
      } else {
        task.resolve(data.result);
        // Terminating the realm releases WASM heaps as well as GPU sessions.
        idleTimer = setTimeout(() => { void workerRequest('UNLOAD', 'idle'); }, TRANSLATION_LIMITS.idleMs);
      }
    };
    translationWorker.onerror = event => {
      for (const task of pending.values()) task.reject(new Error(event.message || 'Translation worker crashed.'));
      pending.clear(); translationWorker?.terminate(); translationWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    pending.set(jobId, { resolve, reject, progress: event => report(jobId, event) });
    translationWorker!.postMessage({ id: jobId, type, text, pair, ocr: imageOcr, baseUrl: chrome.runtime.getURL('') });
  });
}
async function readSample(jobId: string, language: 'eng' | 'ind') {
  const started = performance.now();
  report(jobId, { stage: 'ocr_prepare', fraction: null });
  try {
    ocr = await createWorker(language, OEM.LSTM_ONLY, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract/'),
      langPath: chrome.runtime.getURL('vendor/tesseract/lang/'),
      workerBlobURL: false,
      gzip: true,
      logger: event => report(jobId, { stage: 'ocr', fraction: event.progress ?? null }),
    });
    await ocr.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 180;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black'; context.font = '64px Arial';
    context.fillText(language === 'eng' ? SAMPLE_TEXT : 'Buka pintunya.', 40, 110);
    const { data } = await ocr.recognize(canvas, {}, { text: true, blocks: true });
    const lines = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)) ?? [];
    return { text: data.text.trim(), confidence: data.confidence / 100, lines: lines.map(line => ({ text: line.text.trim(), confidence: line.confidence / 100, box: { x: line.bbox.x0, y: line.bbox.y0, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0 } })), imageWidth: canvas.width, imageHeight: canvas.height, language, elapsedMs: Math.round(performance.now() - started) };
  } finally { await ocr?.terminate(); ocr = null; }
}
async function inspectImage(jobId: string, languages?: LanguageSettings) {
  const started = performance.now();
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const blob = await imageStore.get(jobId);
    if (!blob) throw new Error('The staged image expired. Click Translate again.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const raster = inspectRaster(bytes, blob.type);
    bitmap = await createImageBitmap(blob);
    assertDimensions(bitmap.width, bitmap.height);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const image = { width: bitmap.width, height: bitmap.height, byteLength: blob.size, mimeType: raster.mimeType, animated: raster.animated, sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), context: 'offscreen' };
    if (!languages) return image;
    report(jobId, { stage: 'ocr_prepare', fraction: null });
    // Normalize alpha, EXIF orientation and animated formats to the exact still
    // whose natural-coordinate boxes we return. No scaling or rotation follows.
    canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = null;
    let workerError!: (error: Error) => void;
    const failed = new Promise<never>((_, reject) => { workerError = reject; });
    const initializing = createWorker(ocrLanguage(languages.sourceLanguage), OEM.LSTM_ONLY, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract/'),
      langPath: chrome.runtime.getURL('vendor/tesseract/lang/'),
      workerBlobURL: false, gzip: true, cacheMethod: 'none',
      logger: event => report(jobId, { stage: event.status === 'recognizing text' ? 'ocr' : 'ocr_prepare', fraction: event.status === 'recognizing text' ? event.progress : null }),
      errorHandler: () => workerError(new ImageAcquisitionError(ocr ? 'OCR_FAILED' : 'OCR_LANGUAGE_MISSING', 'The local text reader could not start or finish. Reload Aksara and check the source language.')),
    });
    // The background closes this entire offscreen host on cancellation/deadline,
    // including a Tesseract worker that has not finished initializing yet.
    ocr = await Promise.race([initializing, failed]);
    await Promise.race([ocr.setParameters({ tessedit_pageseg_mode: PSM.AUTO }), failed]);
    let { data } = await Promise.race([ocr.recognize(canvas, { rotateAuto: false }, { text: true, blocks: true }, jobId), failed]);
    // Sparse text on a photo can be missed by automatic page layout. Retry once
    // within the same deadline; confidence still reflects the recognized output.
    if (!data.text.trim()) {
      await Promise.race([ocr.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), failed]);
      ({ data } = await Promise.race([ocr.recognize(canvas, { rotateAuto: false }, { text: true, blocks: true }, `${jobId}-sparse`), failed]));
    }
    const result = normalizeOcr(data, image.width, image.height, languages, performance.now() - started);
    if (!result.text) throw new ImageAcquisitionError('NO_TEXT_FOUND', 'No text found. Check the image language in Aksara’s popup or try a sharper image.');
    return { ...image, ocr: result };
  } finally { await ocr?.terminate(); ocr = null; bitmap?.close(); if (canvas) canvas.width = canvas.height = 1; await imageStore.delete(jobId); }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isEnvelope(message, 'offscreen') || sender.id !== chrome.runtime.id || sender.tab) return;
  const jobId = String(message.jobId);
  const task = message.type === 'READ_IMAGE' ? inspectImage(jobId, languageSettings(message.languages)) : message.type === 'TRANSLATE_IMAGE' ? workerRequest('TRANSLATE_IMAGE', jobId, undefined, 'en-id', message.ocr as OcrResult) : message.type === 'INSPECT_IMAGE' ? inspectImage(jobId) : message.type === 'RUN_OCR' ? readSample(jobId, message.language === 'ind' ? 'ind' : 'eng') : message.type === 'RUN_TRANSLATION' ? workerRequest('TRANSLATE', jobId, String(message.text), message.pair as Pair) : message.type === 'CHECK_GPU' ? workerRequest('CHECK_GPU', jobId) : message.type === 'UNLOAD' ? (translationWorker ? workerRequest('UNLOAD', jobId) : Promise.resolve({ released: true })) : null;
  if (!task) return;
  task.then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, code: error instanceof ImageAcquisitionError ? error.code : 'OCR_FAILED', error: error instanceof ImageAcquisitionError ? error.message : message.type === 'READ_IMAGE' ? 'Aksara could not read this image. Check the source language or try another image.' : errorMessage(error) }));
  return true;
});
