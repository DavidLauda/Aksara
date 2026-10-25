import type { OcrResult, OcrLine } from './ocr-result';
import type { LanguageSettings } from './languages';

export const TRANSLATION_LIMITS = Object.freeze({ timeoutMs: 240_000, idleMs: 60_000, maxCharacters: 2400, maxChunks: 24, chunkCharacters: 240, inputTokens: 128, outputTokens: 128 });
export type TranslationSegment = { segmentId: string; sourceText: string; translatedText: string; box?: OcrLine['box']; lowConfidence: boolean };
export type ImageTranslation = LanguageSettings & { text: string; segments: TranslationSegment[]; partial: boolean; skippedSegments: number; sameLanguage: boolean; cold: boolean; elapsedMs: number; model: string | null };
export type TranslationProblem = { code: string; userMessage: string };
export type TranslationPlan = { segments: Array<Omit<TranslationSegment, 'translatedText'> & { chunks: string[] }>; skippedSegments: number; partial: boolean };

/** Split on whitespace when possible; never split a Unicode code point. */
export function splitTranslationText(text: string): string[] {
  const points = Array.from(text.trim());
  const chunks: string[] = [];
  while (points.length) {
    let end = Math.min(points.length, TRANSLATION_LIMITS.chunkCharacters);
    if (end < points.length) {
      for (let index = end; index >= Math.floor(end / 2); index--) {
        if (/\s/.test(points[index])) { end = index; break; }
      }
    }
    const chunk = points.splice(0, end).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/** Keep whole OCR lines within a bounded sequential inference budget. */
export function planTranslation(ocr: OcrResult): TranslationPlan {
  const candidates = ocr.lines.length ? ocr.lines : [{ segmentId: 'text', text: ocr.text, lowConfidence: ocr.lowConfidence, box: undefined }];
  const segments: TranslationPlan['segments'] = [];
  let characters = 0, chunksUsed = 0, skippedSegments = 0;
  for (const line of candidates) {
    if (!line.text.trim()) continue;
    const chunks = splitTranslationText(line.text);
    const count = Array.from(line.text).length;
    if (characters + count > TRANSLATION_LIMITS.maxCharacters || chunksUsed + chunks.length > TRANSLATION_LIMITS.maxChunks) { skippedSegments++; continue; }
    characters += count; chunksUsed += chunks.length;
    segments.push({ segmentId: line.segmentId, sourceText: line.text, lowConfidence: line.lowConfidence, ...(line.box ? { box: line.box } : {}), chunks });
  }
  return { segments, skippedSegments, partial: ocr.truncated || skippedSegments > 0 };
}

/** Never expose runtime stacks, image text or URLs in operational errors. */
export function translationProblem(error: unknown): TranslationProblem {
  const message = error instanceof Error ? error.message : String(error);
  if (/MODEL_NOT_READY/.test(message)) return { code: 'MODEL_NOT_READY', userMessage: 'Text recognized. Open Aksara → Setup and download the translation model, then click Translate again.' };
  if (/WEBGPU_UNAVAILABLE|no available backend|no usable gpu/i.test(message)) return { code: 'WEBGPU_UNAVAILABLE', userMessage: 'Local translation needs WebGPU. Enable Chrome hardware acceleration or try a supported device. Recognized text is still available.' };
  if (/out of memory|memory access|allocation|allocate|\boom\b|GPU.*lost|device.*lost|buffer.*size/i.test(message)) return { code: 'MODEL_MEMORY_ERROR', userMessage: 'The translation worker ran out of memory or lost its GPU. Close heavy tabs, then retry with a smaller image. Model files stay cached.' };
  if (/TRANSLATION_LIMIT/.test(message)) return { code: 'TRANSLATION_LIMIT', userMessage: 'This image has too much text for one translation. Try a smaller crop. Recognized text is still available.' };
  if (/CANCELLED|AbortError/.test(message)) return { code: 'CANCELLED', userMessage: 'Translation cancelled. Click Translate to retry.' };
  return { code: 'TRANSLATION_FAILED', userMessage: 'Local translation could not finish. Click Translate to retry, or verify the model in Setup. Recognized text is still available.' };
}
