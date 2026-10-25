import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANGUAGES, SOURCE_LANGUAGES, TARGET_LANGUAGES, languageSettings, ocrLanguage } from '../src/languages.ts';
import { normalizeOcr, OCR_LIMITS } from '../src/ocr-result.ts';

const line = (text, confidence = 95, bbox = { x0: 12, y0: 20, x1: 180, y1: 60 }) => ({ text, confidence, bbox });
const page = (lines, text = 'Open the door.', confidence = 95) => ({ text, confidence, blocks: [{ paragraphs: [{ lines }] }] });
const normalize = data => normalizeOcr(data, 640, 280, DEFAULT_LANGUAGES, 123.4);

test('language settings accept only bundled OCR sources and mapped target languages', () => {
  assert.deepEqual(languageSettings(null), DEFAULT_LANGUAGES);
  assert.deepEqual(languageSettings({ sourceLanguage: 'https://example.com/custom', targetLanguage: 'fra_Latn' }), { sourceLanguage: 'eng_Latn', targetLanguage: 'fra_Latn' });
  assert.deepEqual(languageSettings({ sourceLanguage: 'ind_Latn', targetLanguage: '<script>' }), { sourceLanguage: 'ind_Latn', targetLanguage: 'ind_Latn' });
  assert.deepEqual(SOURCE_LANGUAGES.map(source => ocrLanguage(source.code)), ['eng', 'ind']);
  assert.deepEqual(TARGET_LANGUAGES.map(target => target.code), ['ind_Latn', 'eng_Latn', 'fra_Latn']);
});
test('OCR output returns stable line IDs, natural coordinates, normalized confidence and captured languages', () => {
  const result = normalize(page([line(' Open the door.\n'), line('Hello', 89, { x0: 30, y0: 100, x1: 140, y1: 145 })]));
  assert.deepEqual(result.lines[0], { segmentId: 's1', text: 'Open the door.', confidence: 0.95, lowConfidence: false, box: { x: 12, y: 20, width: 168, height: 40 } });
  assert.equal(result.lines[1].segmentId, 's2');
  assert.equal(result.confidence, 0.95); assert.equal(result.imageWidth, 640); assert.equal(result.imageHeight, 280);
  assert.equal(result.sourceLanguage, 'eng_Latn'); assert.equal(result.targetLanguage, 'ind_Latn'); assert.equal(result.elapsedMs, 123);
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
