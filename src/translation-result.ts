import type { OcrResult, OcrLine } from './ocr-result';
import type { LanguageSettings } from './languages';

export const TRANSLATION_LIMITS = Object.freeze({ timeoutMs: 240_000, idleMs: 60_000, maxCharacters: 2400, maxChunks: 24, chunkCharacters: 240, inputTokens: 128, outputTokens: 128 });
export type TranslationSegment = { segmentId: string; sourceText: string; translatedText: string; box?: OcrLine['box']; sourceLineIds?: string[]; textAlign?: 'left' | 'center'; lowConfidence: boolean };
export type ImageTranslation = LanguageSettings & { text: string; segments: TranslationSegment[]; partial: boolean; skippedSegments: number; sameLanguage: boolean; cold: boolean; elapsedMs: number; model: string | null; inferenceCalls?: number; timing?: { verifyMs: number; loadMs: number; inferenceMs: number } };
export type TranslationProblem = { code: string; userMessage: string };
export type TranslationPlan = { segments: Array<Omit<TranslationSegment, 'translatedText'> & { chunks: string[] }>; skippedSegments: number; partial: boolean };

/** Split on whitespace when possible; never split a Unicode code point. */
export function splitTranslationText(text: string): string[] {
  const points = Array.from(text.trim());
  const chunks: string[] = [];
  while (points.length) {
    let end = Math.min(points.length, TRANSLATION_LIMITS.chunkCharacters);
    if (end < points.length) {
      // Prefer a complete sentence to a word boundary when a long region has
      // to be split. Ordinary short paragraphs remain one model input.
      for (let index = end; index >= Math.floor(end / 2); index--) {
        if (/\s/.test(points[index]) && /[.!?]/.test(points[index - 1])) { end = index; break; }
      }
      for (let index = end; index >= Math.floor(end / 2); index--) {
        if (/\s/.test(points[index])) { end = index; break; }
      }
    }
    const chunk = points.splice(0, end).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

type TextRegion = Omit<TranslationSegment, 'translatedText'>;
const regionLimits = { maxLines: 12, maxCharacters: 960 };
const finiteBox = (box: OcrLine['box']) => [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;

function adjacent(previous: OcrLine, next: OcrLine): boolean {
  if (!finiteBox(previous.box) || !finiteBox(next.box)) return false;
  // Explicit OCR paragraphs/blocks are boundaries. Do not concatenate separate
  // speakers or panels just because their text happens to be nearby.
  if (previous.paragraphId && next.paragraphId && previous.paragraphId !== next.paragraphId) return false;
  if (previous.blockId && next.blockId && previous.blockId !== next.blockId) return false;
  const sameParagraph = !!previous.paragraphId && previous.paragraphId === next.paragraphId;
  const a = previous.box, b = next.box, height = Math.max(a.height, b.height);
  const gap = b.y - a.y - a.height;
  if (Math.max(a.height, b.height) / Math.min(a.height, b.height) > 1.7 || gap < -Math.min(a.height, b.height) * 0.2 || gap > height * (sameParagraph ? 1 : 0.6)) return false;
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const aligned = Math.min(Math.abs(a.x - b.x), Math.abs(a.x + a.width - b.x - b.width), Math.abs(a.x + a.width / 2 - b.x - b.width / 2)) <= height * 0.85;
  if (overlap < Math.min(a.width, b.width) * 0.5 || !aligned) return false;
  // Legacy/unstructured results may join only an unfinished line followed by
  // a lowercase continuation; known paragraph IDs do not need this guess.
  return sameParagraph || !/[.!?:;]["'”’)]*\s*$/.test(previous.text) && /^[\s"'“‘(]*[a-z]/.test(next.text);
}

/** Preserve paragraph context while bounding geometry, speakers and input size. */
export function groupTextRegions(ocr: OcrResult): TextRegion[] {
  if (!ocr.lines.length) return ocr.text.trim() ? [{ segmentId: 'text', sourceText: ocr.text, lowConfidence: ocr.lowConfidence }] : [];
  const groups: OcrLine[][] = [];
  for (const line of ocr.lines) {
    if (!line.text.trim()) continue;
    const current = groups.at(-1);
    if (current && current.length < regionLimits.maxLines && current.reduce((sum, row) => sum + Array.from(row.text).length + 1, 0) + Array.from(line.text).length <= regionLimits.maxCharacters && adjacent(current.at(-1)!, line)) current.push(line);
    else groups.push([line]);
  }
  return groups.map(lines => {
    if (lines.length === 1) {
      const line = lines[0];
      return { segmentId: line.segmentId, sourceText: line.text, lowConfidence: line.lowConfidence, box: line.box };
    }
    const x = Math.min(...lines.map(line => line.box.x)), y = Math.min(...lines.map(line => line.box.y));
    const right = Math.max(...lines.map(line => line.box.x + line.box.width)), bottom = Math.max(...lines.map(line => line.box.y + line.box.height));
    const centers = lines.map(line => line.box.x + line.box.width / 2), lefts = lines.map(line => line.box.x), height = Math.max(...lines.map(line => line.box.height));
    const centered = Math.max(...centers) - Math.min(...centers) < height * 0.6 && Math.max(...lefts) - Math.min(...lefts) > height * 0.25;
    // Visual line wraps become spaces, not separate translation requests.
    const sourceText = lines.map(line => line.text.trim()).join(' ').replace(/\s+/g, ' ');
    return { segmentId: `g-${lines[0].segmentId}`, sourceLineIds: lines.map(line => line.segmentId), sourceText, lowConfidence: lines.some(line => line.lowConfidence), box: { x, y, width: right - x, height: bottom - y }, textAlign: centered ? 'center' : 'left' };
  });
}

/** Keep whole text regions within a bounded sequential inference budget. */
export function planTranslation(ocr: OcrResult): TranslationPlan {
  const candidates = groupTextRegions(ocr);
  const segments: TranslationPlan['segments'] = [];
  let characters = 0, chunksUsed = 0, skippedSegments = 0;
  for (const region of candidates) {
    const chunks = splitTranslationText(region.sourceText);
    const count = Array.from(region.sourceText).length;
    if (characters + count > TRANSLATION_LIMITS.maxCharacters || chunksUsed + chunks.length > TRANSLATION_LIMITS.maxChunks) { skippedSegments++; continue; }
    characters += count; chunksUsed += chunks.length;
    segments.push({ ...region, chunks });
  }
  return { segments, skippedSegments, partial: ocr.truncated || skippedSegments > 0 };
}

/** Never expose runtime stacks, image text or URLs in operational errors. */
export function translationProblem(error: unknown): TranslationProblem {
  const message = error instanceof Error ? error.message : String(error);
  if (/MODEL_NOT_READY/.test(message)) return { code: 'MODEL_NOT_READY', userMessage: 'Text recognized. Open Aksara → Setup and download the translation model, then click Translate again.' };
  if (/MODEL_INTEGRITY_FAILED/.test(message)) return { code: 'MODEL_INTEGRITY_FAILED', userMessage: 'Text recognized. A damaged model file was removed. Open Aksara → Setup and download again to repair it, then retry. Other cached files are preserved.' };
  if (/WEBGPU_UNAVAILABLE|no available backend|no usable gpu/i.test(message)) return { code: 'WEBGPU_UNAVAILABLE', userMessage: 'Local translation needs WebGPU. Enable Chrome hardware acceleration or try a supported device. Recognized text is still available.' };
  if (/out of memory|memory access|allocation|allocate|\boom\b|GPU.*lost|device.*lost|buffer.*size/i.test(message)) return { code: 'MODEL_MEMORY_ERROR', userMessage: 'The translation worker ran out of memory or lost its GPU. Close heavy tabs, then retry with a smaller image. Model files stay cached.' };
  if (/TRANSLATION_LIMIT/.test(message)) return { code: 'TRANSLATION_LIMIT', userMessage: 'This image has too much text for one translation. Try a smaller crop. Recognized text is still available.' };
  if (/CANCELLED|AbortError/.test(message)) return { code: 'CANCELLED', userMessage: 'Translation cancelled. Click Translate to retry.' };
  return { code: 'TRANSLATION_FAILED', userMessage: 'Local translation could not finish. Click Translate to retry, or verify the model in Setup. Recognized text is still available.' };
}
