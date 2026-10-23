export const SCHEMA_VERSION = 1;
export type Host = 'service-worker' | 'offscreen-worker';
export const PAIRS = {
  'en-id': { text: 'Open the door.', source: 'eng_Latn', target: 'ind_Latn' },
  'id-en': { text: 'Buka pintunya.', source: 'ind_Latn', target: 'eng_Latn' },
  'en-fr': { text: 'Open the door.', source: 'eng_Latn', target: 'fra_Latn' },
} as const;
export type Pair = keyof typeof PAIRS;
export type Operation = 'CHECK_GPU' | 'OCR_SAMPLE' | 'TRANSLATE_SAMPLE' | 'PIPELINE_SAMPLE' | 'UNLOAD_MODEL';
export type Progress = { stage: string; fraction: number | null; file?: string; loadedBytes?: number; totalBytes?: number };
export type Job = { id: string; operation: Operation; host: Host; pair: Pair; state: 'running' | 'done' | 'error'; progress: Progress; result?: unknown; error?: string; startedAt: number; elapsedMs?: number };
export const SAMPLE_TEXT = 'Open the door.';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isEnvelope(value: unknown, target: string): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === SCHEMA_VERSION && value.target === target && typeof value.type === 'string';
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function backgroundMessage(type: string, fields: Record<string, unknown> = {}) {
  return { schemaVersion: SCHEMA_VERSION, target: 'background', type, ...fields };
}
