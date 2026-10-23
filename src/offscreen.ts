import { createWorker, OEM, PSM, type Worker as TesseractWorker } from 'tesseract.js';
import { errorMessage, isEnvelope, type Pair, type Progress, SAMPLE_TEXT } from './protocol';

let ocr: TesseractWorker | null = null;
let translationWorker: globalThis.Worker | null = null;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress: (event: Progress) => void }>();
function report(jobId: string, event: Progress) {
  void chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type: 'OFFSCREEN_PROGRESS', jobId, event }).catch(() => {});
}
function workerRequest(type: string, jobId: string, text?: string, pair: Pair = 'en-id') {
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
      } else task.resolve(data.result);
    };
    translationWorker.onerror = event => {
      for (const task of pending.values()) task.reject(new Error(event.message || 'Translation worker crashed.'));
      pending.clear(); translationWorker?.terminate(); translationWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    pending.set(jobId, { resolve, reject, progress: event => report(jobId, event) });
    translationWorker!.postMessage({ id: jobId, type, text, pair, baseUrl: chrome.runtime.getURL('') });
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isEnvelope(message, 'offscreen') || sender.id !== chrome.runtime.id || sender.tab) return;
  const jobId = String(message.jobId);
  const task = message.type === 'RUN_OCR' ? readSample(jobId, message.language === 'ind' ? 'ind' : 'eng') : message.type === 'RUN_TRANSLATION' ? workerRequest('TRANSLATE', jobId, String(message.text), message.pair as Pair) : message.type === 'CHECK_GPU' ? workerRequest('CHECK_GPU', jobId) : message.type === 'UNLOAD' ? (translationWorker ? workerRequest('UNLOAD', jobId) : Promise.resolve({ released: true })) : null;
  if (!task) return;
  task.then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});
