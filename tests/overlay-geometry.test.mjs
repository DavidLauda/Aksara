import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageMapping, intersectRects, isAxisAlignedTransform, mapOverlayBox } from '../src/overlay-geometry.ts';

const input = (overrides = {}) => ({
  borderBox: { x: 100, y: 50, width: 400, height: 400 }, layoutWidth: 400, layoutHeight: 400,
  naturalWidth: 200, naturalHeight: 100, sourceWidth: 200, sourceHeight: 100,
  objectFit: 'none', objectPosition: '50% 50%', ...overrides,
});
const mapping = overrides => {
  const result = createImageMapping(input(overrides));
  assert.equal(result.supported, true, result.reason);
  return result;
};

test('fill maps OCR pixels independently from browser density-corrected natural dimensions', () => {
  const result = mapping({ borderBox: { x: 100, y: 50, width: 500, height: 250 }, layoutWidth: 500, layoutHeight: 250, naturalWidth: 1000, naturalHeight: 500, sourceWidth: 2000, sourceHeight: 1000, objectFit: 'fill' });
  assert.deepEqual(result.content, { x: 100, y: 50, width: 500, height: 250 });
  assert.deepEqual(mapOverlayBox(result, { x: 200, y: 100, width: 400, height: 200 }), {
    rect: { x: 150, y: 75, width: 100, height: 50 }, visibleRect: { x: 150, y: 75, width: 100, height: 50 }, clipped: false,
  });
  const stretched = mapping({ objectFit: 'fill' });
  assert.equal(stretched.scaleX, 2); assert.equal(stretched.scaleY, 4);
});

test('border and padding are excluded before positive CSS scaling is applied', () => {
  const inset = { top: 10, right: 10, bottom: 10, left: 10 };
  const result = mapping({ borderBox: { x: 10, y: 20, width: 1080, height: 580 }, layoutWidth: 540, layoutHeight: 290, border: inset, padding: inset, naturalWidth: 500, naturalHeight: 250, sourceWidth: 500, sourceHeight: 250, objectFit: 'fill', transforms: ['matrix(2, 0, 0, 2, 7, 9)'] });
  assert.deepEqual(result.content, { x: 50, y: 60, width: 1000, height: 500 });
  assert.deepEqual(mapOverlayBox(result, { x: 20, y: 30, width: 100, height: 50 }).rect, { x: 90, y: 120, width: 200, height: 100 });
});

test('contain preserves the aspect ratio and positions the letterboxed image', () => {
  const result = mapping({ borderBox: { x: 100, y: 50, width: 300, height: 300 }, layoutWidth: 300, layoutHeight: 300, naturalWidth: 400, naturalHeight: 200, sourceWidth: 400, sourceHeight: 200, objectFit: 'contain' });
  assert.deepEqual(result.painted, { x: 100, y: 125, width: 300, height: 150 });
  assert.deepEqual(result.clip, result.painted);
  assert.deepEqual(mapOverlayBox(result, { x: 100, y: 50, width: 100, height: 50 }).rect, { x: 175, y: 162.5, width: 75, height: 37.5 });
});

test('cover clips cropped source boxes without moving them onto the visible image', () => {
  const result = mapping({ borderBox: { x: 100, y: 50, width: 300, height: 300 }, layoutWidth: 300, layoutHeight: 300, naturalWidth: 400, naturalHeight: 200, sourceWidth: 400, sourceHeight: 200, objectFit: 'cover' });
  assert.deepEqual(result.painted, { x: -50, y: 50, width: 600, height: 300 });
  assert.deepEqual(result.clip, result.content);
  assert.equal(mapOverlayBox(result, { x: 0, y: 0, width: 100, height: 50 }), null);
  assert.deepEqual(mapOverlayBox(result, { x: 50, y: 0, width: 100, height: 50 }), {
    rect: { x: 25, y: 50, width: 150, height: 75 }, visibleRect: { x: 100, y: 50, width: 75, height: 75 }, clipped: true,
  });
});

test('none and scale-down respect intrinsic CSS dimensions without upscaling', () => {
  const none = mapping({ objectFit: 'none' });
  const scaleDown = mapping({ objectFit: 'scale-down' });
  assert.deepEqual(none.painted, { x: 200, y: 200, width: 200, height: 100 });
  assert.deepEqual(scaleDown.painted, none.painted);
  const small = mapping({ borderBox: { x: 10, y: 20, width: 100, height: 100 }, layoutWidth: 100, layoutHeight: 100, objectFit: 'scale-down' });
  assert.deepEqual(small.painted, { x: 10, y: 45, width: 100, height: 50 });
});

test('object-position supports percentages, pixel lengths, reordered keywords and edge offsets', () => {
  const cases = [
    ['right bottom', 300, 350], ['bottom right', 300, 350], ['left top', 100, 50], ['top left', 100, 50],
    ['20% 80%', 140, 290], ['10px 20px', 110, 70], ['right', 300, 200], ['top', 200, 50], ['10px', 110, 200],
    ['top center', 200, 50], ['center right', 300, 200], ['right 10px', 300, 60], ['center 10px', 200, 60],
    ['right 10px bottom 20px', 290, 330], ['bottom 20px right 10px', 290, 330], ['left 10% top 20%', 120, 110],
    ['right 10px center', 290, 200], ['center bottom 20px', 200, 330], ['left top 20px', 100, 70],
    ['calc(100% - 10px) calc(100% - 20px)', 290, 330], ['calc(10px + 25%) 0px', 160, 50],
    ['-25% 150%', 50, 500], ['0 0', 100, 50],
  ];
  for (const [objectPosition, x, y] of cases) {
    const result = mapping({ objectPosition });
    assert.deepEqual([result.painted.x, result.painted.y], [x, y], objectPosition);
  }
});

test('percent positions use negative free space when cover crops the image', () => {
  const result = mapping({ borderBox: { x: 0, y: 0, width: 200, height: 200 }, layoutWidth: 200, layoutHeight: 200, objectFit: 'cover', objectPosition: '25% 50%' });
  assert.deepEqual(result.painted, { x: -50, y: 0, width: 400, height: 200 });
  assert.equal(mapOverlayBox(result, { x: 0, y: 0, width: 20, height: 20 }), null);
});

test('viewport and ancestor clips intersect the painted content and preserve clipping metadata', () => {
  const result = mapping({ objectFit: 'fill', clips: [{ x: 0, y: 0, width: 350, height: 400 }, { x: 150, y: 100, width: 400, height: 150 }] });
  assert.deepEqual(result.clip, { x: 150, y: 100, width: 200, height: 150 });
  assert.deepEqual(mapOverlayBox(result, { x: 0, y: 0, width: 200, height: 100 }), {
    rect: result.painted, visibleRect: result.clip, clipped: true,
  });
  assert.equal(mapping({ clips: [{ x: 0, y: 0, width: 10, height: 10 }] }).clip, null);
  assert.equal(mapping({ clips: [{ x: 0, y: 0, width: 0, height: 10 }] }).clip, null);
  assert.deepEqual(intersectRects({ x: -10, y: -10, width: 20, height: 20 }, { x: 0, y: 0, width: 10, height: 10 }), { x: 0, y: 0, width: 10, height: 10 });
  assert.equal(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), null);
});

test('unreliable transforms and ambiguous position calculations return explicit fallbacks', () => {
  for (const value of ['none', 'matrix(2, 0, 0, .5, 10, -10)', 'matrix3d(2,0,0,0,0,3,0,0,0,0,1,0,10,20,0,1)']) assert.equal(isAxisAlignedTransform(value), true, value);
  for (const value of ['matrix(-1,0,0,1,0,0)', 'matrix(1,.01,0,1,0,0)', 'matrix(0,1,-1,0,0,0)', 'matrix(1,0,0,0,0,0)', 'matrix(1,,0,1,0,0)', 'matrix(NaN,0,0,1,0,0)', 'rotate(90deg)', 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,.01,0,0,0,1)']) {
    assert.equal(isAxisAlignedTransform(value), false, value);
    assert.deepEqual(createImageMapping(input({ transforms: ['none', value] })), { supported: false, reason: 'unsupported-transform' });
  }
  for (const objectPosition of ['left right', 'top 10px', '10px left', 'calc(50% * 2) 50%', 'min(10px, 20px) center', 'var(--image-position)', 'left 10px 20px', '10em 50%', '0 0 0']) assert.deepEqual(createImageMapping(input({ objectPosition })), { supported: false, reason: 'unsupported-position' }, objectPosition);
  assert.deepEqual(createImageMapping(input({ objectFit: 'unknown' })), { supported: false, reason: 'unsupported-fit' });
});

test('invalid dimensions and incompatible source orientation fail before coordinates are produced', () => {
  for (const key of ['layoutWidth', 'layoutHeight', 'naturalWidth', 'naturalHeight', 'sourceWidth', 'sourceHeight']) {
    for (const value of [0, -1, NaN, Infinity]) assert.deepEqual(createImageMapping(input({ [key]: value })), { supported: false, reason: 'invalid-dimensions' }, `${key}=${value}`);
  }
  assert.deepEqual(createImageMapping(input({ padding: { top: 0, right: 250, bottom: 0, left: 250 } })), { supported: false, reason: 'invalid-dimensions' });
  assert.deepEqual(createImageMapping(input({ border: { top: -1, right: 0, bottom: 0, left: 0 } })), { supported: false, reason: 'invalid-dimensions' });
  assert.deepEqual(createImageMapping(input({ sourceWidth: 100, sourceHeight: 200 })), { supported: false, reason: 'source-aspect-mismatch' });
  assert.deepEqual(createImageMapping(input({ clips: [{ x: NaN, y: 0, width: 10, height: 10 }] })), { supported: false, reason: 'invalid-dimensions' });
  const result = mapping({ objectFit: 'fill' });
  for (const box of [{ x: 0, y: 0, width: 0, height: 5 }, { x: NaN, y: 0, width: 2, height: 5 }, { x: 0, y: 0, width: -2, height: 5 }, { x: 500, y: 0, width: 2, height: 5 }]) assert.equal(mapOverlayBox(result, box), null);
  const partlyOutside = mapOverlayBox(result, { x: -10, y: 0, width: 20, height: 10 });
  assert.equal(partlyOutside.clipped, true);
  assert.equal(partlyOutside.visibleRect.x, result.content.x);
});
