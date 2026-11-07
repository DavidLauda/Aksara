import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, textErrors, evaluateCase } from '../scripts/benchmark/metrics.mjs';

test('edit errors count insertions, removals, substitutions and Unicode code points', () => {
  assert.equal(editDistance(['a', 'b'], ['a', 'c', 'b']), 1);
  assert.equal(editDistance(['a', 'b'], []), 2);
  assert.equal(editDistance([], ['a']), 1);
  assert.equal(textErrors('😀a', '😀b').characterEdits, 1);
  assert.equal(textErrors('😀a', '😀b').referenceCharacters, 2);
});
test('OCR normalization ignores layout/case/smart quotes but retains character punctuation', () => {
  const result = textErrors('  DON’T\nopen it! ', "don't open it!");
  assert.equal(result.cer, 0); assert.equal(result.wer, 0);
  assert.equal(textErrors('Wait...', 'wait').characterEdits, 3);
  assert.equal(textErrors('Wait...', 'wait').wer, 0);
  assert.equal(textErrors('one', 'one two three').wer, 2, 'Insertions can exceed a 100% word error rate.');
});
test('empty references are explicitly unscorable rather than perfect', () => {
  assert.equal(textErrors('', 'unexpected').cer, null);
  assert.equal(textErrors('', '').wer, null);
  assert.equal(textErrors('hello', '').wer, 1);
});
const annotation = { regions: [
  { id: 'a', text: 'We got this package.', box: { x: 0, y: 0, width: 200, height: 100 } },
  { id: 'b', text: 'Open it.', box: { x: 300, y: 0, width: 200, height: 100 } },
] };
const lines = [
  { segmentId: 's1', text: 'We got this', box: { x: 10, y: 10, width: 100, height: 20 } },
  { segmentId: 's2', text: 'package.', box: { x: 20, y: 40, width: 100, height: 20 } },
  { segmentId: 's3', text: 'Open it.', box: { x: 310, y: 10, width: 100, height: 20 } },
];
const image = segments => ({ ocr: { text: 'We got this\npackage.\nOpen it.', lines }, translation: { segments } });
test('correct wrapped-region grouping keeps speakers separate without scoring translation semantics', () => {
  const result = evaluateCase(annotation, image([{ segmentId: 'g1', sourceLineIds: ['s1', 's2'] }, { segmentId: 's3' }]));
  assert.equal(result.ocr.wer, 0); assert.equal(result.grouping.precision, 1); assert.equal(result.grouping.recall, 1);
  assert.deepEqual(result.grouping.mergedGroups, []); assert.deepEqual(result.grouping.missingRegions, []);
  assert.equal(result.translationReview, 'pending-human-review');
});
test('merged speakers and broken wrapped sentences produce different grouping errors', () => {
  const merged = evaluateCase(annotation, image([{ segmentId: 'g', sourceLineIds: ['s1', 's2', 's3'] }]));
  assert.equal(merged.grouping.mergedPairs, 2); assert.equal(merged.grouping.precision, 1 / 3);
  assert.deepEqual(merged.grouping.mergedGroups, ['g']);
  const split = evaluateCase(annotation, image(lines.map(line => ({ segmentId: line.segmentId }))));
  assert.equal(split.grouping.splitPairs, 1); assert.equal(split.grouping.recall, 0);
  assert.deepEqual(split.grouping.splitRegions, ['a']);
});
test('missed and untranslated regions cannot silently pass as correct grouping', () => {
  const empty = evaluateCase(annotation, { ocr: { text: '', lines: [] } });
  assert.deepEqual(empty.grouping.missingRegions, ['a', 'b']); assert.equal(empty.ocr.wer, 1);
  assert.equal(empty.grouping.precision, null); assert.equal(empty.grouping.recall, null);
  const skipped = evaluateCase(annotation, image([]));
  assert.equal(skipped.grouping.untranslatedLines, 3); assert.equal(skipped.grouping.recall, 0);
  const partialImage = image([]); partialImage.translation.partial = true;
  assert.equal(evaluateCase(annotation, partialImage).partial, true);
});
test('unassigned boxes and duplicate source memberships are exposed', () => {
  const source = image([{ segmentId: 'g1', sourceLineIds: ['s1', 's2'] }, { segmentId: 'g2', sourceLineIds: ['s2', 's3'] }]);
  source.ocr.lines = [...lines, { segmentId: 'extra', text: 'noise', box: { x: 600, y: 600, width: 10, height: 10 } }];
  const result = evaluateCase(annotation, source);
  assert.equal(result.grouping.unassignedLines, 1); assert.equal(result.grouping.multiplyAssignedLines, 1);
});
