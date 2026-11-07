export const normalizeText = text => String(text ?? '').normalize('NFKC').replace(/[‘’]/g, "'").toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
export function editDistance(reference, actual) {
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let row = 1; row <= reference.length; row++) {
    const next = [row];
    for (let col = 1; col <= actual.length; col++) next[col] = Math.min(next[col - 1] + 1, previous[col] + 1, previous[col - 1] + Number(reference[row - 1] !== actual[col - 1]));
    previous = next;
  }
  return previous[actual.length];
}
export function textErrors(reference, actual) {
  const expected = normalizeText(reference), observed = normalizeText(actual);
  const chars = Array.from(expected), actualChars = Array.from(observed);
  const words = expected.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [], actualWords = observed.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
  const characterEdits = editDistance(chars, actualChars), wordEdits = editDistance(words, actualWords);
  return { characterEdits, referenceCharacters: chars.length, cer: chars.length ? characterEdits / chars.length : null,
    wordEdits, referenceWords: words.length, wer: words.length ? wordEdits / words.length : null };
}
const area = box => Math.max(0, box.width) * Math.max(0, box.height);
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export function evaluateCase(annotation, image) {
  const lines = image?.ocr?.lines ?? [], segments = image?.translation?.segments ?? [];
  const assignments = lines.map(line => {
    const matches = annotation.regions.map(region => ({ id: region.id, coverage: area(line.box) ? overlap(line.box, region.box) / area(line.box) : 0 })).sort((a, b) => b.coverage - a.coverage);
    const owners = segments.filter(segment => (segment.sourceLineIds ?? [segment.segmentId]).includes(line.segmentId)).map(segment => segment.segmentId);
    return { lineId: line.segmentId, expectedRegion: matches[0]?.coverage >= .5 ? matches[0].id : null, groups: owners };
  });
  let truePairs = 0, mergedPairs = 0, splitPairs = 0;
  for (let i = 0; i < assignments.length; i++) for (let j = i + 1; j < assignments.length; j++) {
    const a = assignments[i], b = assignments[j]; if (!a.expectedRegion || !b.expectedRegion) continue;
    const sameExpected = a.expectedRegion === b.expectedRegion, sameActual = a.groups.some(group => b.groups.includes(group));
    if (sameExpected && sameActual) truePairs++;
    else if (!sameExpected && sameActual) mergedPairs++;
    else if (sameExpected) splitPairs++;
  }
  const regions = annotation.regions.map(region => {
    const members = assignments.filter(row => row.expectedRegion === region.id), ids = new Set(members.map(row => row.lineId));
    const groups = [...new Set(members.flatMap(row => row.groups))];
    return { id: region.id, expectedText: region.text, observedText: lines.filter(line => ids.has(line.segmentId)).map(line => line.text).join(' '),
      ocr: textErrors(region.text, lines.filter(line => ids.has(line.segmentId)).map(line => line.text).join(' ')), detectedLines: members.length,
      groups, split: groups.length > 1, untranslatedLines: members.filter(row => !row.groups.length).length };
  });
  const mergedGroups = segments.filter(segment => new Set(assignments.filter(row => row.groups.includes(segment.segmentId) && row.expectedRegion).map(row => row.expectedRegion)).size > 1).map(segment => segment.segmentId);
  return { ocr: textErrors(annotation.regions.map(region => region.text).join(' '), image?.ocr?.text ?? ''), regions,
    grouping: { truePairs, mergedPairs, splitPairs, precision: truePairs + mergedPairs ? truePairs / (truePairs + mergedPairs) : null,
      recall: truePairs + splitPairs ? truePairs / (truePairs + splitPairs) : null, mergedGroups, splitRegions: regions.filter(region => region.split).map(region => region.id),
      missingRegions: regions.filter(region => !region.detectedLines).map(region => region.id), unassignedLines: assignments.filter(row => !row.expectedRegion).length,
      untranslatedLines: assignments.filter(row => !row.groups.length).length, multiplyAssignedLines: assignments.filter(row => row.groups.length > 1).length },
    partial: Boolean(image?.ocr?.truncated || image?.translation?.partial), translationReview: 'pending-human-review' };
}
