import type { LanguageSettings } from './languages';

export const OCR_LIMITS = Object.freeze({ timeoutMs: 90_000, maxText: 20_000, maxLines: 500, maxLineText: 2000, lowConfidence: 0.6 });
export type OcrLine = { segmentId: string; text: string; confidence: number; lowConfidence: boolean; box: { x: number; y: number; width: number; height: number } };
export type OcrResult = LanguageSettings & { text: string; confidence: number; lowConfidence: boolean; truncated: boolean; lines: OcrLine[]; imageWidth: number; imageHeight: number; elapsedMs: number };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const confidence = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0;

/** Return only bounded text and natural-image coordinates; never Tesseract's full page graph. */
export function normalizeOcr(data: unknown, width: number, height: number, languages: LanguageSettings, elapsedMs: number): OcrResult {
  const page = object(data), text = clean(page.text), lines: OcrLine[] = [];
  let truncated = text.length > OCR_LIMITS.maxText;
  for (const block of list(page.blocks)) for (const paragraph of list(object(block).paragraphs)) for (const candidate of list(object(paragraph).lines)) {
    const line = object(candidate), lineText = clean(line.text), box = object(line.bbox);
    if (!lineText) continue;
    if (lines.length >= OCR_LIMITS.maxLines) { truncated = true; continue; }
    if (![box.x0, box.y0, box.x1, box.y1].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
    const x = Math.max(0, Math.min(width, Math.floor(Number(box.x0)))), y = Math.max(0, Math.min(height, Math.floor(Number(box.y0))));
    const right = Math.max(0, Math.min(width, Math.ceil(Number(box.x1)))), bottom = Math.max(0, Math.min(height, Math.ceil(Number(box.y1))));
    if (right <= x || bottom <= y) continue;
    const score = confidence(line.confidence);
    truncated ||= lineText.length > OCR_LIMITS.maxLineText;
    lines.push({ segmentId: `s${lines.length + 1}`, text: lineText.slice(0, OCR_LIMITS.maxLineText), confidence: score, lowConfidence: score < OCR_LIMITS.lowConfidence, box: { x, y, width: right - x, height: bottom - y } });
  }
  const score = confidence(page.confidence);
  return { ...languages, text: text.slice(0, OCR_LIMITS.maxText), confidence: score, lowConfidence: Boolean(text) && (score < OCR_LIMITS.lowConfidence || lines.some(line => line.lowConfidence)), truncated, lines, imageWidth: width, imageHeight: height, elapsedMs: Math.max(0, Math.round(elapsedMs)) };
}
