import manifest from './model-manifest.json';

type ModelStatus = { ready: boolean; totalBytes: number; cachedBytes: number; revision: string };
type ModelJob = {
  id: string;
  operation: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  progress: { stage: string; fraction: number | null; loadedBytes?: number; totalBytes?: number };
  error?: string;
};

const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
const mb = (bytes: number) => `${Math.ceil(bytes / 1_000_000)} MB`;
const request = (type: string, fields: Record<string, unknown> = {}) => chrome.runtime.sendMessage({ schemaVersion: 1, target: 'background', type, ...fields });

function progressText(job: ModelJob) {
  const stage = job.progress.stage;
  const label = stage === 'model_download' ? 'Downloading model'
    : stage === 'model_verify' ? 'Verifying model files'
    : stage === 'model_delete' || job.operation === 'DELETE_MODEL' ? 'Removing model files'
    : stage === 'check_gpu' || stage === 'gpu_check' || stage === 'checking_gpu' ? 'Checking WebGPU'
    : 'Preparing translation model';
  return `${label}${typeof job.progress.fraction === 'number' ? ` · ${Math.round(Math.max(0, Math.min(1, job.progress.fraction)) * 100)}%` : '…'}`;
}

/** The popup observes readiness; only the setup page can explicitly start downloads. */
export function mountModelUi() {
  const summary = document.querySelector<HTMLElement>('#model-summary');
  const status = document.querySelector<HTMLElement>('#model-status');
  const storage = document.querySelector<HTMLElement>('#model-storage');
  const progress = document.querySelector<HTMLProgressElement>('#model-progress');
  const download = document.querySelector<HTMLButtonElement>('#model-download');
  const cancel = document.querySelector<HTMLButtonElement>('#model-cancel');
  const verify = document.querySelector<HTMLButtonElement>('#model-verify');
  const remove = document.querySelector<HTMLButtonElement>('#model-delete');
  const refresh = document.querySelector<HTMLButtonElement>('#model-refresh');
  const removeHelp = document.querySelector<HTMLElement>('#model-remove-help');
  const size = document.querySelector<HTMLElement>('#model-size');
  if (size) size.textContent = mb(totalBytes);
  if (download) download.textContent = `Download ${mb(totalBytes)} on this device`;

  let model: ModelStatus | null = null;
  let job: ModelJob | null = null;
  let pending = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let failure = '';
  let restoreActionFocus = false;
  let updateVersion = 0;
  let loadVersion = 0;

  function render() {
    const focused = document.activeElement;
    const running = job?.state === 'running';
    const busy = pending || running;
    const partial = !!model && model.cachedBytes > 0 && !model.ready;
    const saved = model ? `${mb(model.cachedBytes)} of ${mb(model.totalBytes)} stored locally` : '';
    const readiness = !model ? 'Checking local model files…'
      : model.ready ? 'Model ready · return to a webpage and choose Translate.'
      : partial ? 'Download incomplete · resume to prepare translation.'
      : 'No model downloaded. Download once to enable local translation.';
    const cancelled = job?.operation === 'VERIFY_MODEL' && model?.ready ? 'Verification cancelled. Previously verified files remain available.'
      : model?.ready ? 'Preparation cancelled. The downloaded model is still ready.'
      : partial ? 'Preparation cancelled. Downloaded parts are kept; resume when ready.'
      : 'Preparation cancelled. Download the model when you are ready.';
    const completed = job?.operation === 'VERIFY_MODEL' && model?.ready ? 'Model files verified · translation is ready.'
      : job?.operation === 'DELETE_MODEL' && model?.cachedBytes === 0 ? 'Model removed. Download again when you need translation.' : readiness;
    const message = failure || (pending ? 'Starting…' : running ? progressText(job!)
      : job?.state === 'error' ? job.error || 'Preparation failed. Retry to continue.'
      : job?.state === 'cancelled' ? cancelled
      : job?.state === 'done' ? completed : readiness);
    if (status) status.textContent = message;
    if (storage) storage.textContent = saved;
    if (summary) summary.textContent = failure ? 'Model status unavailable. Open setup to retry.'
      : running ? progressText(job!)
      : job?.state === 'error' ? 'Model setup needs attention. Open setup to retry.'
      : model?.ready ? 'Translation model ready · works offline.'
      : partial ? `${mb(model!.cachedBytes)} downloaded · resume in setup.`
      : model ? `Translation needs a one-time ${mb(model.totalBytes)} download.` : 'Checking translation model…';
    if (progress) {
      progress.hidden = !busy;
      const fraction = running ? job!.progress.fraction : null;
      if (typeof fraction === 'number' && Number.isFinite(fraction)) progress.value = Math.max(0, Math.min(1, fraction));
      else progress.removeAttribute('value');
    }
    if (download) {
      download.hidden = !!model?.ready;
      download.disabled = busy || !model;
      download.textContent = partial ? 'Resume model download' : job?.state === 'error' ? 'Retry model download' : `Download ${mb(model?.totalBytes || totalBytes)} on this device`;
    }
    // Cache deletion is one short transaction and cannot be stopped midway.
    if (cancel) { cancel.hidden = !running || job?.operation === 'DELETE_MODEL'; cancel.disabled = pending; }
    if (verify) { verify.hidden = !model?.ready; verify.disabled = busy; }
    if (remove) { remove.hidden = !model || model.cachedBytes <= 0; remove.disabled = busy; }
    if (removeHelp) removeHelp.hidden = !model || model.cachedBytes <= 0;
    if (refresh) refresh.disabled = pending;
    if ([download, cancel, verify, remove].some(button => button && focused === button && button.hidden)) restoreActionFocus = true;
    if (restoreActionFocus && !busy) {
      const next = model?.ready ? verify : download;
      if (next && !next.hidden && !next.disabled) { next.focus(); restoreActionFocus = false; }
    }
    document.body.dataset.modelState = running ? 'running' : failure || job?.state === 'error' ? 'error' : model?.ready ? 'ready' : partial ? 'partial' : 'empty';
    // Progress events can arrive many times per second. Keep the scheduled
    // status refresh so byte counts still update throughout a download.
    if (!running) { clearTimeout(poll); poll = undefined; }
    else if (!poll && !disposed) poll = setTimeout(() => { poll = undefined; void load(); }, 4000);
  }

  async function load() {
    const version = ++loadVersion;
    const before = updateVersion;
    try {
      const response = await request('GET_MODEL_STATUS');
      if (!response?.ok) throw new Error(response?.error || 'Model status is unavailable. Refresh to retry.');
      // A newer broadcast or request wins over an older asynchronous snapshot.
      if (disposed || version !== loadVersion || before !== updateVersion) return;
      model = response.model;
      job = response.job || null;
      failure = '';
    } catch (error) {
      if (disposed || version !== loadVersion || before !== updateVersion) return;
      failure = error instanceof Error ? error.message : 'Could not read model status. Refresh to retry.';
    }
    if (!disposed) render();
  }

  async function act(type: string, fields: Record<string, unknown> = {}) {
    if (pending) return;
    failure = ''; pending = true; render();
    try {
      const response = await request(type, fields);
      if (!response?.ok) throw new Error(response?.error || 'Could not start this action. Try again.');
      if (response.job) job = response.job;
      await load();
    } catch (error) { failure = error instanceof Error ? error.message : 'Could not complete this action. Try again.'; }
    finally { pending = false; if (!disposed) render(); }
  }

  download?.addEventListener('click', () => { void act('START_MODEL_DOWNLOAD', { consent: true }); });
  cancel?.addEventListener('click', () => { void act('CANCEL_MODEL_JOB'); });
  verify?.addEventListener('click', () => { void act('VERIFY_MODEL'); });
  remove?.addEventListener('click', () => { void act('DELETE_MODEL'); });
  refresh?.addEventListener('click', () => { void load(); });
  const onMessage = (message: { schemaVersion?: number; target?: string; type?: string; model?: ModelStatus; job?: ModelJob | null }, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || message.schemaVersion !== 1 || message.target !== 'model-ui' || message.type !== 'MODEL_UPDATED') return;
    updateVersion++;
    if (message.model) model = message.model;
    if ('job' in message) job = message.job || null;
    failure = '';
    render();
    if (job?.state !== 'running') void load();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(poll); chrome.runtime.onMessage.removeListener(onMessage); }, { once: true });
  void load();
}
