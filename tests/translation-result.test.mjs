import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATION_LIMITS, groupTextRegions, planTranslation, splitTranslationText, translationProblem } from '../src/translation-result.ts';

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

test('long regions prefer complete sentence boundaries when chunking', () => {
  const first = 'This sentence supplies its own context. '.repeat(4).trim();
  const next = 'A different sentence supplies more context and continues for several more words. '.repeat(4);
  const chunks = splitTranslationText(`${first} ${next}`);
  assert.ok(chunks[0].endsWith('.'));
  assert.deepEqual(chunks.flatMap(chunk => chunk.split(/\s+/)), `${first} ${next}`.trim().split(/\s+/));
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= TRANSLATION_LIMITS.chunkCharacters));
});

const bubble = (texts, { x = 185, y = 56, paragraphId = 'b1p1', blockId = 'b1', width = 152 } = {}) => texts.map((text, index) => ({
  ...line(text, index + 1), paragraphId, blockId, box: { x: x + index * 7, y: y + index * 34, width: width - index * 14, height: 30 },
}));

test('wrapped comic sentence becomes one model input and one union box with source line IDs', () => {
  const source = ocr(bubble(['We got this', 'mysterious', 'package.']));
  const plan = planTranslation(source);
  assert.equal(plan.segments.length, 1);
  assert.deepEqual(plan.segments[0], {
    segmentId: 'g-s1', sourceText: 'We got this mysterious package.', sourceLineIds: ['s1', 's2', 's3'], lowConfidence: false,
    box: { x: 185, y: 56, width: 152, height: 98 }, textAlign: 'center', chunks: ['We got this mysterious package.'],
  });
  assert.equal(plan.partial, false);
  assert.equal(source.lines.length, 3, 'Original OCR lines remain available for inspection.');
});

test('nearby separate paragraphs and panels never become one translated sentence', () => {
  const rows = [...bubble(['We got this', 'mysterious']), ...bubble(['package.'], { y: 124, paragraphId: 'b1p2' })];
  assert.deepEqual(groupTextRegions(ocr(rows)).map(region => region.sourceText), ['We got this mysterious', 'package.']);
  rows[2].paragraphId = 'b1p1'; rows[2].blockId = 'b2';
  assert.equal(groupTextRegions(ocr(rows)).length, 2, 'A conflicting block boundary is never ignored.');
});

test('geometry splits columns, large gaps, mismatched type sizes and overlapping rows despite reused paragraph IDs', () => {
  for (const changed of [
    { x: 400, y: 90, width: 138, height: 30 },
    { x: 192, y: 180, width: 138, height: 30 },
    { x: 192, y: 90, width: 138, height: 60 },
    { x: 192, y: 60, width: 138, height: 30 },
  ]) {
    const rows = bubble(['We got this', 'mysterious']); rows[1].box = changed;
    assert.equal(groupTextRegions(ocr(rows)).length, 2, JSON.stringify(changed));
  }
});

test('unstructured OCR joins only nearby lowercase continuation and preserves complete independent sentences', () => {
  const rows = bubble(['We got this', 'mysterious', 'package.']);
  for (const row of rows) { delete row.blockId; delete row.paragraphId; }
  assert.equal(planTranslation(ocr(rows)).segments[0].sourceText, 'We got this mysterious package.');
  rows[0].text = 'We got this.';
  assert.equal(groupTextRegions(ocr(rows)).length, 2);
  rows[0].text = 'We got this'; rows[1].text = 'Another speaker';
  assert.equal(groupTextRegions(ocr(rows)).length, 2);
});

test('grouped confidence and left-aligned paragraph layout preserve uncertainty', () => {
  const rows = bubble(['Read the entire', 'sentence together.']); rows[1].box.x = rows[0].box.x; rows[1].lowConfidence = true;
  const [region] = groupTextRegions(ocr(rows));
  assert.equal(region.lowConfidence, true); assert.equal(region.textAlign, 'left');
});

test('region limits prevent an OCR paragraph becoming an unbounded input', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ ...line('continued text', index + 1), blockId: 'b1', paragraphId: 'b1p1' }));
  const regions = groupTextRegions(ocr(rows));
  assert.ok(regions.length >= 4); assert.ok(regions.every(region => !region.sourceLineIds || region.sourceLineIds.length <= 12));
  assert.equal(regions.reduce((sum, region) => sum + (region.sourceLineIds?.length || 1), 0), 40);
  const long = bubble(['x'.repeat(700), 'y'.repeat(700)]);
  assert.equal(groupTextRegions(ocr(long)).length, 2);
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
    ['MODEL_INTEGRITY_FAILED: Secret OCR text https://private.example/model', 'MODEL_INTEGRITY_FAILED'],
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
