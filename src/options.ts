import './style.css';
import { backgroundMessage, isEnvelope, type Job, type Operation } from './protocol';
import model from './model-manifest.json';

const status = document.querySelector<HTMLElement>('#status')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const report = document.querySelector<HTMLElement>('#report')!;
const buttons = ['check', 'ocr', 'translate', 'pipeline', 'unload'].map(id => document.getElementById(id) as HTMLButtonElement);
const reports: Job[] = [];
let current: Job | null = null;
document.querySelector('#model-size')!.textContent = `${Math.ceil(model.files.reduce((sum, file) => sum + file.bytes, 0) / 1_000_000)} MB`;
function show(job: Job) {
  current = job;
  const busy = job.state === 'running';
  buttons.forEach(button => { button.disabled = busy; });
  status.textContent = job.error || `${job.operation.replaceAll('_', ' ').toLowerCase()} · ${job.progress.stage.replaceAll('_', ' ')}${job.elapsedMs ? ` · ${(job.elapsedMs / 1000).toFixed(1)}s` : ''}`;
  progress.hidden = !busy;
  if (job.progress.fraction === null) progress.removeAttribute('value'); else progress.value = job.progress.fraction;
  report.textContent = JSON.stringify(job, null, 2);
  if (!busy && !reports.some(previous => previous.id === job.id)) reports.push(structuredClone(job));
  document.body.dataset.jobState = job.state;
}
async function start(operation: Operation) {
  try {
    status.textContent = 'Starting…';
    buttons.forEach(button => { button.disabled = true; });
    const host = (document.querySelector('#host') as HTMLSelectElement).value;
    const response = await chrome.runtime.sendMessage(backgroundMessage('START_JOB', { operation, host }));
    if (!response.ok) throw new Error(response.error);
    document.body.dataset.jobState = 'running';
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); buttons.forEach(button => { button.disabled = false; }); }
}
for (const [id, operation] of [['check', 'CHECK_GPU'], ['ocr', 'OCR_SAMPLE'], ['translate', 'TRANSLATE_SAMPLE'], ['pipeline', 'PIPELINE_SAMPLE'], ['unload', 'UNLOAD_MODEL']] as const) document.getElementById(id)!.addEventListener('click', () => { void start(operation); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && isEnvelope(message, 'diagnostics') && message.type === 'JOB_UPDATED') show(message.job as Job);
});
document.querySelector('#export')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: '0.1.0', generatedAt: new Date().toISOString(), jobs: reports.length ? reports : [current] }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'aksara-diagnostics.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void chrome.runtime.sendMessage(backgroundMessage('GET_JOB')).then(response => { if (response.job) show(response.job); });
