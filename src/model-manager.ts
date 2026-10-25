import { clearModel, getModelStatus, prepareModel, verifyModel } from './model-cache';
import { checkGpu } from './gpu';
import type { Progress } from './protocol';

type ModelOperation = 'START_MODEL_DOWNLOAD' | 'VERIFY_MODEL' | 'DELETE_MODEL';
type ModelJob = { id: string; operation: ModelOperation; state: 'running' | 'done' | 'error' | 'cancelled'; progress: Progress; error?: string; startedAt: number };
const operations = new Set(['START_MODEL_DOWNLOAD', 'VERIFY_MODEL', 'DELETE_MODEL']);

export class ModelManager {
  private active: { job: ModelJob; abort: AbortController } | null = null;
  private latest: ModelJob | null = null;
  constructor(private readonly isBusy: () => boolean, private readonly release: () => Promise<void>) {}
  get busy() { return this.active !== null; }

  async recover() {
    const { modelJob } = await chrome.storage.session.get('modelJob');
    if (!modelJob) return;
    this.latest = modelJob as ModelJob;
    if (this.latest.state === 'running') {
      this.latest.state = 'error';
      this.latest.error = 'INTERRUPTED: Model preparation stopped when Chrome restarted the background worker. Download again to resume cached parts.';
      await this.persist(this.latest);
    }
  }
  private async persist(job: ModelJob) { await chrome.storage.session.set({ modelJob: job }); }
  private notify(job: ModelJob) { void chrome.runtime.sendMessage({ schemaVersion: 1, target: 'model-ui', type: 'MODEL_UPDATED', job }).catch(() => {}); }

  async handle(message: Record<string, unknown>): Promise<unknown | undefined> {
    if (message.type === 'GET_MODEL_STATUS') return { ok: true, model: await getModelStatus(), job: this.latest };
    if (message.type === 'CANCEL_MODEL_JOB') {
      if (this.active?.job.operation === 'DELETE_MODEL') return { ok: false, error: 'NOT_CANCELLABLE: Model removal is already completing.' };
      this.active?.abort.abort();
      return { ok: true };
    }
    if (!operations.has(String(message.type))) return undefined;
    if (this.busy || this.isBusy()) return { ok: false, error: 'BUSY: Finish or cancel the current Aksara job, then retry.' };
    if (message.type === 'START_MODEL_DOWNLOAD' && message.consent !== true) return { ok: false, error: 'CONSENT_REQUIRED: Use the Download model button in Setup to allow the model download.' };
    const job: ModelJob = { id: crypto.randomUUID(), operation: message.type as ModelOperation, state: 'running', progress: { stage: 'starting', fraction: null }, startedAt: Date.now() };
    const abort = new AbortController();
    this.active = { job, abort }; this.latest = job;
    try { await this.persist(job); } catch (error) { this.active = null; throw error; }
    void this.run(job, abort);
    return { ok: true, jobId: job.id };
  }

  private async run(job: ModelJob, abort: AbortController) {
    const heartbeat = setInterval(() => { this.notify(job); void this.persist(job).catch(() => {}); }, 10_000);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 30 * 60_000);
    const progress = (event: Progress) => { job.progress = event; this.notify(job); };
    try {
      await this.release();
      if (abort.signal.aborted) throw new Error('CANCELLED');
      if (job.operation === 'START_MODEL_DOWNLOAD') {
        progress({ stage: 'checking_gpu', fraction: null });
        await checkGpu(abort.signal);
        if (abort.signal.aborted) throw new Error('CANCELLED');
        await prepareModel(progress, abort.signal);
      } else if (job.operation === 'VERIFY_MODEL') await verifyModel(progress, abort.signal);
      else { progress({ stage: 'model_delete', fraction: null }); await clearModel(); }
      if (abort.signal.aborted) throw new Error('CANCELLED');
      job.state = 'done'; job.progress = { stage: 'done', fraction: 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.state = abort.signal.aborted && !timedOut ? 'cancelled' : 'error';
      job.error = timedOut ? 'MODEL_TIMEOUT: Preparation exceeded 30 minutes. Download again to resume cached parts.'
        : job.state === 'cancelled' ? job.operation === 'VERIFY_MODEL' ? 'Verification cancelled. Downloaded model files are unchanged.' : 'Cancelled. Completed model parts stay on this device; Download resumes them.'
        : /INSUFFICIENT_STORAGE|QuotaExceeded/i.test(message) ? 'INSUFFICIENT_STORAGE: Free disk space, then retry. Partial model files can be removed here.'
        : /MODEL_INTEGRITY_FAILED/.test(message) ? 'MODEL_INTEGRITY_FAILED: A cached model file did not match its checksum and was removed. Download again to repair it.'
        : /WEBGPU_UNAVAILABLE/.test(message) ? 'WEBGPU_UNAVAILABLE: No usable GPU was found. Enable Chrome hardware acceleration or use a supported device.'
        : /MODEL_NOT_READY/.test(message) ? 'MODEL_NOT_READY: Download the missing model files first.'
        : 'MODEL_PREPARATION_FAILED: Check your connection and free disk space, then retry. Completed parts are preserved.';
    } finally {
      clearInterval(heartbeat); clearTimeout(timeout);
      this.active = null;
      await this.persist(job).catch(() => {});
      this.notify(job);
    }
  }
}
