import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANGUAGES, SOURCE_LANGUAGES, TARGET_LANGUAGES, languageSettings, ocrLanguage } from '../src/languages.ts';
import { normalizeOcr, mergeRecoveredOcr, OCR_LIMITS } from '../src/ocr-result.ts';

const line = (text, confidence = 95, bbox = { x0: 12, y0: 20, x1: 180, y1: 60 }) => ({ text, confidence, bbox });
const page = (lines, text = 'Open the door.', confidence = 95) => ({ text, confidence, blocks: [{ paragraphs: [{ lines }] }] });
const normalize = data => normalizeOcr(data, 640, 280, DEFAULT_LANGUAGES, 123.4);

test('recovered crop boxes return to natural coordinates with unique IDs and retained uncertainty', () => {
  const a = normalize(page([line('Hello', 95, { x0: 10, y0: 12, x1: 60, y1: 32 })], 'Hello'));
  const b = normalize(page([line('world', 45, { x0: 0, y0: 5, x1: 90, y1: 25 })], 'world', 45));
  const result = mergeRecoveredOcr([{ ocr: a, x: 100, y: 50, visualRegionId: 'v1' }, { ocr: b, x: 600, y: 100, visualRegionId: 'v2' }], 640, 280, DEFAULT_LANGUAGES, 555);
  assert.equal(result.text, 'Hello\n\nworld'); assert.equal(result.elapsedMs, 555);
  assert.deepEqual(result.lines.map(line => line.segmentId), ['s1', 's2']);
  assert.notEqual(result.lines[0].paragraphId, result.lines[1].paragraphId);
  assert.deepEqual(result.lines[0].box, { x: 110, y: 62, width: 50, height: 20 });
  assert.deepEqual(result.lines[1].box, { x: 600, y: 105, width: 40, height: 20 });
  assert.deepEqual(result.lines.map(line => line.visualRegionId), ['v1', 'v2']);
  assert.equal(result.lowConfidence, true); assert.equal(result.confidence, .7);
  assert.equal(mergeRecoveredOcr([], 640, 280, DEFAULT_LANGUAGES, 10, true).truncated, true);
});

test('combining recovered crops preserves global text/line limits and marks partial results', () => {
  const source = normalize(page(Array.from({ length: 300 }, () => line('text')), 'x'.repeat(OCR_LIMITS.maxText)));
  const result = mergeRecoveredOcr([{ ocr: source, x: 0, y: 0, visualRegionId: 'v1' }, { ocr: source, x: 0, y: 0, visualRegionId: 'v2' }], 640, 280, DEFAULT_LANGUAGES, 10);
  assert.equal(result.text.length, OCR_LIMITS.maxText); assert.equal(result.lines.length, OCR_LIMITS.maxLines); assert.equal(result.truncated, true);
});

test('language settings accept only bundled OCR sources and mapped target languages', () => {
  assert.deepEqual(languageSettings(null), DEFAULT_LANGUAGES);
  assert.deepEqual(languageSettings({ sourceLanguage: 'https://example.com/custom', targetLanguage: 'fra_Latn' }), { sourceLanguage: 'eng_Latn', targetLanguage: 'fra_Latn' });
  assert.deepEqual(languageSettings({ sourceLanguage: 'ind_Latn', targetLanguage: '<script>' }), { sourceLanguage: 'ind_Latn', targetLanguage: 'ind_Latn' });
  assert.deepEqual(SOURCE_LANGUAGES.map(source => ocrLanguage(source.code)), ['eng', 'ind']);
  assert.deepEqual(TARGET_LANGUAGES.map(target => target.code), ['ind_Latn', 'eng_Latn', 'fra_Latn']);
});
test('OCR output returns stable line IDs, natural coordinates, normalized confidence and captured languages', () => {
  const result = normalize(page([line(' Open the door.\n'), line('Hello', 89, { x0: 30, y0: 100, x1: 140, y1: 145 })]));
  assert.deepEqual(result.lines[0], { segmentId: 's1', blockId: 'b1', paragraphId: 'b1p1', text: 'Open the door.', confidence: 0.95, lowConfidence: false, box: { x: 12, y: 20, width: 168, height: 40 } });
  assert.equal(result.lines[1].segmentId, 's2');
  assert.equal(result.confidence, 0.95); assert.equal(result.imageWidth, 640); assert.equal(result.imageHeight, 280);
  assert.equal(result.sourceLanguage, 'eng_Latn'); assert.equal(result.targetLanguage, 'ind_Latn'); assert.equal(result.elapsedMs, 123);
});

test('OCR preserves stable paragraph and block boundaries for contextual translation', () => {
  const result = normalize({ text: 'We got this\nmysterious\npackage.\nHello', confidence: 95, blocks: [
    { paragraphs: [{ lines: [line('We got this'), line('mysterious'), line('package.')] }, { lines: [line('Hello')] }] },
    { paragraphs: [{ lines: [line('Next panel')] }] },
  ] });
  assert.deepEqual(result.lines.map(row => [row.segmentId, row.blockId, row.paragraphId]), [
    ['s1', 'b1', 'b1p1'], ['s2', 'b1', 'b1p1'], ['s3', 'b1', 'b1p1'], ['s4', 'b1', 'b1p2'], ['s5', 'b2', 'b2p1'],
  ]);
});
test('boxes are clamped to image bounds and invalid or empty boxes are dropped', () => {
  const result = normalize(page([
    line('clipped', 99, { x0: -4.5, y0: -3, x1: 700, y1: 300 }),
    line('inverted', 99, { x0: 80, y0: 20, x1: 20, y1: 60 }),
    line('not finite', 99, { x0: NaN, y0: 0, x1: 100, y1: 100 }),
    line('off image', 99, { x0: 900, y0: 0, x1: 1000, y1: 10 }), line('   '),
  ]));
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.lines[0].box, { x: 0, y: 0, width: 640, height: 280 });
});
test('low confidence remains visible rather than removing recognized text', () => {
  const result = normalize(page([line('uncertain', 40)], 'uncertain', 90));
  assert.equal(result.text, 'uncertain'); assert.equal(result.lowConfidence, true); assert.equal(result.lines[0].lowConfidence, true);
  assert.equal(normalize(page([line('unknown', Infinity)], 'unknown', -10)).confidence, 0);
  assert.equal(normalize(page([line('good', 101)], 'good', 101)).confidence, 1);
});
test('empty OCR and missing blocks produce an empty result without a fabricated box', () => {
  const result = normalize({ text: '\n\t', confidence: NaN, blocks: null });
  assert.equal(result.text, ''); assert.equal(result.lines.length, 0); assert.equal(result.lowConfidence, false);
  assert.equal(normalize(undefined).text, '');
});
test('output limits bound retained text and line metadata and flag partial output', () => {
  const result = normalize(page(Array.from({ length: OCR_LIMITS.maxLines + 1 }, () => line('x'.repeat(3000))), 'x'.repeat(30_000)));
  assert.equal(result.text.length, OCR_LIMITS.maxText); assert.equal(result.lines.length, OCR_LIMITS.maxLines);
  assert.equal(result.lines[0].text.length, OCR_LIMITS.maxLineText); assert.equal(result.truncated, true);
});
test('text stays literal, while binary control characters are removed', () => {
  const text = '<img src=x onerror=alert(1)>\u0000\u0007\nNext line';
  const result = normalize(page([line(text)], text));
  assert.equal(result.text, '<img src=x onerror=alert(1)>\nNext line');
  assert.equal(result.lines[0].text, result.text);
});
