import { IMAGE_LIMITS, ImageAcquisitionError, inspectRaster, validateImageUrl } from './image-policy';
import { imageStore } from './image-store';
import { isEnvelope, isRecord } from './protocol';

type Snapshot = { imageId: string; kind: 'url' | 'inline'; url?: string; width: number; height: number };
type Owner = { tabId: number; documentId: string; frameId: number; pageOrigin: string };
type Acquisition = {
  id: string; requestId: string; imageId: string; owner: Owner; port: chrome.runtime.Port;
  snapshot: Snapshot; abort: AbortController; timer: ReturnType<typeof setTimeout>;
  transferId?: string; bytes?: Uint8Array; offset: number; index: number; chunkCount: number;
};
const originPattern = (url: URL) => `${url.origin}/*`;

/** One image acquisition across tabs. Binary data never travels in runtime JSON. */
export class ImageAcquisition {
  private active: Acquisition | null = null;
  private preparing: { port: chrome.runtime.Port; requestId: string; cancelled: boolean } | null = null;
  private inspecting = 0;
  private ready = imageStore.clear();

  constructor(private readonly isDiagnosticBusy: () => boolean, private readonly inspect: (id: string) => Promise<unknown>, private readonly startup: () => Promise<void>) {}
  get busy() { return this.preparing !== null || this.active !== null || this.inspecting > 0; }

  connect(port: chrome.runtime.Port) {
    if (port.name !== 'aksara-images') return;
    const sender = port.sender;
    if (sender?.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0 || !sender.documentId || !sender.url?.match(/^https?:\/\//)) { port.disconnect(); return; }
    const owner: Owner = { tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, pageOrigin: new URL(sender.url).origin };
    port.onMessage.addListener(message => {
      void this.handle(message, port, owner).catch(error => this.fail(port, message?.requestId, error));
    });
    port.onDisconnect.addListener(() => { if (this.preparing?.port === port) this.preparing.cancelled = true; if (this.active?.port === port) this.stop(this.active, 'CANCELLED', 'Image preparation stopped because the page connection closed.'); });
  }

  private post(port: chrome.runtime.Port, fields: Record<string, unknown>) {
    try { port.postMessage({ schemaVersion: 1, target: 'content', ...fields }); } catch { /* Document navigated or worker disconnected. */ }
  }
  private fail(port: chrome.runtime.Port, requestId: unknown, error: unknown) {
    const job = this.active;
    const code = error instanceof ImageAcquisitionError ? error.code : error instanceof DOMException && error.name === 'AbortError' ? 'CANCELLED' : 'IMAGE_ACCESS_DENIED';
    const userMessage = error instanceof ImageAcquisitionError ? error.message : 'Aksara could not read this image. Try another image or check site access.';
    if (job?.port === port && job.requestId === requestId) this.stop(job, code, userMessage);
    else this.post(port, { type: 'IMAGE_ERROR', requestId, code, userMessage });
  }
  private stop(job: Acquisition, code: string, userMessage: string) {
    if (this.active !== job) return;
    this.active = null; clearTimeout(job.timer); job.abort.abort(); job.bytes = undefined;
    void imageStore.delete(job.id).catch(() => {});
    this.post(job.port, { type: 'IMAGE_ERROR', requestId: job.requestId, jobId: job.id, code, userMessage });
  }
  private assertActive(job: Acquisition) {
    if (this.active !== job || job.abort.signal.aborted) throw new ImageAcquisitionError('CANCELLED', 'Image preparation was cancelled.');
  }
  private async snapshot(owner: Owner, requestId: string, imageId: string): Promise<Snapshot> {
    const results = await chrome.scripting.executeScript({
      target: { tabId: owner.tabId, documentIds: [owner.documentId] },
      func: (request: string, image: string) => {
        const api = (globalThis as typeof globalThis & { __aksaraImageSnapshot?: (request: string, image: string) => unknown }).__aksaraImageSnapshot;
        return api?.(request, image) ?? null;
      },
      args: [requestId, imageId],
    });
    const value = results[0]?.result;
    if (!isRecord(value) || value.imageId !== imageId || (value.kind !== 'url' && value.kind !== 'inline') || typeof value.width !== 'number' || typeof value.height !== 'number') throw new ImageAcquisitionError('SOURCE_CHANGED', 'The image changed or left the page. Click Translate on the current image.');
    return value as Snapshot;
  }

  private async handle(value: unknown, port: chrome.runtime.Port, owner: Owner) {
    if (!isEnvelope(value, 'background') || typeof value.requestId !== 'string' || value.requestId.length > 80) throw new ImageAcquisitionError('INVALID_REQUEST', 'The image request was invalid.');
    const requestId = value.requestId;
    if (value.type === 'CANCEL_IMAGE') {
      if (this.preparing?.port === port && this.preparing.requestId === requestId) this.preparing.cancelled = true;
      if (this.active?.port === port && this.active.requestId === requestId) this.stop(this.active, 'CANCELLED', 'Image preparation cancelled.');
      return;
    }
    if (value.type === 'PREPARE_IMAGE') {
      if (this.busy || this.isDiagnosticBusy()) throw new ImageAcquisitionError('BUSY', 'Another Aksara job is running. Finish or cancel it, then retry.');
      if (typeof value.imageId !== 'string' || value.imageId.length > 80) throw new ImageAcquisitionError('INVALID_REQUEST', 'The image request was invalid.');
      const preparation = { port, requestId, cancelled: false };
      this.preparing = preparation;
      let snapshot: Snapshot;
      try { await this.ready; await this.startup(); snapshot = await this.snapshot(owner, requestId, value.imageId); }
      finally { if (this.preparing === preparation) this.preparing = null; }
      if (preparation.cancelled) throw new ImageAcquisitionError('CANCELLED', 'Image preparation cancelled.');
      // The document may have cancelled while the authoritative snapshot was read.
      if (this.active || this.isDiagnosticBusy()) throw new ImageAcquisitionError('BUSY', 'Another Aksara job is running. Please retry.');
      const id = crypto.randomUUID();
      const job: Acquisition = { id, requestId, imageId: value.imageId, owner, snapshot, port, abort: new AbortController(), timer: setTimeout(() => this.stop(job, 'IMAGE_TIMEOUT', 'Reading this image took too long. Please retry.'), IMAGE_LIMITS.timeoutMs), offset: 0, index: 0, chunkCount: 0 };
      this.active = job;
      this.post(port, { type: 'IMAGE_PROGRESS', requestId, jobId: id, stage: 'acquire' });
      if (snapshot.kind === 'inline') {
        job.transferId = crypto.randomUUID();
        this.post(port, { type: 'IMAGE_UPLOAD_READY', requestId, jobId: id, transferId: job.transferId, chunkBytes: IMAGE_LIMITS.chunkBytes, maxBytes: IMAGE_LIMITS.maxBytes });
      } else await this.readUrl(job);
      return;
    }
    const job = this.active;
    if (!job || job.port !== port || job.requestId !== requestId || value.jobId !== job.id || value.transferId !== job.transferId || !job.transferId) throw new ImageAcquisitionError('INVALID_REQUEST', 'This image transfer has expired. Click Translate to retry.');
    if (value.type === 'IMAGE_UPLOAD_BEGIN') {
      if (job.bytes || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > IMAGE_LIMITS.maxBytes || value.mimeType !== 'image/png' || value.chunkCount !== Math.ceil(Number(value.bytes) / IMAGE_LIMITS.chunkBytes)) throw new ImageAcquisitionError('IMAGE_TOO_LARGE', 'The displayed image is too large to prepare.');
      job.bytes = new Uint8Array(Number(value.bytes)); job.chunkCount = Number(value.chunkCount);
      this.post(port, { type: 'IMAGE_UPLOAD_ACK', requestId, index: -1 }); return;
    }
    if (value.type === 'IMAGE_CHUNK') {
      if (!job.bytes || value.index !== job.index || typeof value.base64 !== 'string' || value.base64.length > IMAGE_LIMITS.chunkBytes * 4 / 3 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) throw new ImageAcquisitionError('INVALID_REQUEST', 'The image transfer was interrupted. Please retry.');
      const chunk = atob(value.base64);
      const expected = Math.min(IMAGE_LIMITS.chunkBytes, job.bytes.length - job.offset);
      if (chunk.length !== expected || !expected) throw new ImageAcquisitionError('INVALID_REQUEST', 'The image transfer had an invalid size.');
      for (let i = 0; i < chunk.length; i++) job.bytes[job.offset + i] = chunk.charCodeAt(i);
      job.offset += chunk.length; job.index++;
      this.post(port, { type: 'IMAGE_UPLOAD_ACK', requestId, index: job.index - 1 }); return;
    }
    if (value.type === 'IMAGE_UPLOAD_END') {
      if (!job.bytes || job.offset !== job.bytes.length || job.index !== job.chunkCount) throw new ImageAcquisitionError('INVALID_REQUEST', 'The image transfer did not finish.');
      const bytes = job.bytes; job.bytes = undefined;
      await this.finish(job, bytes, 'image/png'); return;
    }
    throw new ImageAcquisitionError('INVALID_REQUEST', 'Unknown image request.');
  }

  private async readUrl(job: Acquisition) {
    const url = validateImageUrl(job.snapshot.url ?? '');
    const pattern = originPattern(url);
    if (url.origin !== job.owner.pageOrigin && !(await chrome.permissions.contains({ origins: [pattern] }))) {
      await chrome.storage.session.set({ pendingImagePermission: { origin: url.origin, pattern, host: url.hostname, createdAt: Date.now() } });
      throw new ImageAcquisitionError('PERMISSION_REQUIRED', `Allow image access to ${url.hostname} in the Aksara popup, then click Translate again.`);
    }
    this.assertActive(job);
    let response: Response;
    try { response = await fetch(url.href, { signal: job.abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' }); }
    catch (error) {
      this.assertActive(job);
      throw new ImageAcquisitionError('IMAGE_ACCESS_DENIED', 'Aksara could not fetch this image. Redirected or protected images are not supported yet.');
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ImageAcquisitionError('IMAGE_ACCESS_DENIED', 'The image host denied access. Protected images may need a readable displayed copy.'); }
    const length = Number(response.headers.get('content-length'));
    if (length > IMAGE_LIMITS.maxBytes) { await response.body.cancel(); throw new ImageAcquisitionError('IMAGE_TOO_LARGE', 'This image is larger than the 8 MB limit.'); }
    const parts: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.assertActive(job); total += value.length;
        if (total > IMAGE_LIMITS.maxBytes) throw new ImageAcquisitionError('IMAGE_TOO_LARGE', 'This image is larger than the 8 MB limit.');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    await this.finish(job, bytes, response.headers.get('content-type') ?? '');
  }

  private async finish(job: Acquisition, bytes: Uint8Array, mime: string) {
    this.assertActive(job);
    const raster = inspectRaster(bytes, mime);
    await this.snapshot(job.owner, job.requestId, job.imageId);
    this.assertActive(job);
    await imageStore.put(job.id, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: raster.mimeType }));
    this.assertActive(job);
    this.post(job.port, { type: 'IMAGE_PROGRESS', requestId: job.requestId, jobId: job.id, stage: 'decode' });
    // createImageBitmap/digest cannot be interrupted mid-call. Keep the shared
    // workload locked until they drain, even after a user cancellation.
    let result: unknown;
    this.inspecting++;
    try { result = await this.inspect(job.id); } finally { this.inspecting--; }
    this.assertActive(job);
    await this.snapshot(job.owner, job.requestId, job.imageId);
    this.assertActive(job);
    this.active = null; clearTimeout(job.timer); job.bytes = undefined;
    await imageStore.delete(job.id);
    this.post(job.port, { type: 'IMAGE_READY', requestId: job.requestId, jobId: job.id, image: result });
  }
}
