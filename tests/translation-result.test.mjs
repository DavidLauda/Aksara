import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATION_LIMITS, planTranslation, splitTranslationText, translationProblem } from '../src/translation-result.ts';

const line = (text, index = 1, lowConfidence = false) => ({ segmentId: `s${index}`, text, confidence: lowConfidence ? 0.4 : 0.95, lowConfidence, box: { x: 10, y: index * 40, width: 260, height: 30 } });
const ocr = (lines, fields = {}) => ({ sourceLanguage: 'eng_Latn', targetLanguage: 'ind_Latn', text: lines.map(item => item.text).join('\n'), lines, confidence: 0.95, lowConfidence: false, truncated: false, imageWidth: 1000, imageHeight: 2000, elapsedMs: 12, ...fields });

test('translation chunks preserve Unicode code points and bounded input', () => {
  const text = `${'🙂'.repeat(241)}漢字`;
  const chunks = splitTranslationText(text);
  assert.equal(chunks.join(''), text);
  assert.deepEqual(chunks.map(chunk => Array.from(chunk).length), [240, 3]);
  assert.ok(chunks.every(chunk => !/[\ud800-\udfff]/u.test(chunk)), 'A complete surrogate pair must not be split into invalid Unicode.');
  assert.deepEqual(splitTranslationText(' \n\t '), []);
});

test('chunk splitting prefers word boundaries without losing words', () => {
  const text = Array.from({ length: 150 }, (_, index) => `word${index}`).join(' ');
  const chunks = splitTranslationText(text);
  assert.deepEqual(chunks.flatMap(chunk => chunk.split(/\s+/)), text.split(' '));
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= TRANSLATION_LIMITS.chunkCharacters));
});

test('translation plan retains stable segment IDs, natural boxes and uncertain OCR', () => {
  const source = ocr([line('Open the door.'), line('Uncertain text', 2, true)]);
  const result = planTranslation(source);
  assert.deepEqual(result, { segments: [
    { segmentId: 's1', sourceText: 'Open the door.', lowConfidence: false, box: source.lines[0].box, chunks: ['Open the door.'] },
    { segmentId: 's2', sourceText: 'Uncertain text', lowConfidence: true, box: source.lines[1].box, chunks: ['Uncertain text'] },
  ], partial: false, skippedSegments: 0 });
});

test('character budget skips whole lines and explicitly flags partial output', () => {
  const source = ocr([line('x'.repeat(TRANSLATION_LIMITS.maxCharacters + 1)), line('Still fits.', 2)]);
  const result = planTranslation(source);
  assert.equal(result.partial, true); assert.equal(result.skippedSegments, 1);
  assert.deepEqual(result.segments.map(segment => segment.segmentId), ['s2']);
  assert.equal(source.lines[0].text.length, TRANSLATION_LIMITS.maxCharacters + 1, 'The original recognized text remains available.');
});

test('sequential chunk budget prevents unbounded inference despite short OCR lines', () => {
  const source = ocr(Array.from({ length: TRANSLATION_LIMITS.maxChunks + 6 }, (_, index) => line('Short text.', index + 1)));
  const result = planTranslation(source);
  assert.equal(result.segments.length, TRANSLATION_LIMITS.maxChunks);
  assert.equal(result.skippedSegments, 6); assert.equal(result.partial, true);
});

test('text without OCR boxes is translated without inventing image coordinates', () => {
  const result = planTranslation(ocr([], { text: 'Readable words', lowConfidence: true, truncated: true }));
  assert.deepEqual(result.segments, [{ segmentId: 'text', sourceText: 'Readable words', lowConfidence: true, chunks: ['Readable words'] }]);
  assert.equal(result.partial, true); assert.equal(result.skippedSegments, 0);
  assert.deepEqual(planTranslation(ocr([], { text: '  ' })).segments, []);
});

test('runtime failures become actionable bounded errors without source text, URLs or stacks', () => {
  const cases = [
    ['MODEL_NOT_READY: https://private.example/image.png', 'MODEL_NOT_READY'],
    ['WEBGPU_UNAVAILABLE: no adapter', 'WEBGPU_UNAVAILABLE'],
    ['no available backend found', 'WEBGPU_UNAVAILABLE'],
    ['memory allocation failed at 0x10', 'MODEL_MEMORY_ERROR'],
    ['GPU device lost', 'MODEL_MEMORY_ERROR'],
    ['TRANSLATION_LIMIT: Secret OCR text', 'TRANSLATION_LIMIT'],
    ['AbortError: Secret OCR text', 'CANCELLED'],
    ['Secret OCR text\nat https://private.example/worker.js:20', 'TRANSLATION_FAILED'],
  ];
  for (const [message, code] of cases) {
    const result = translationProblem(new Error(message));
    assert.equal(result.code, code);
    assert.doesNotMatch(result.userMessage, /Secret OCR text|private\.example|0x10|worker\.js/);
    assert.ok(result.userMessage.length < 300);
  }
});
