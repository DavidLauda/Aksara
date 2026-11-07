import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLightRegions, visualRegionForLine, lightRegionMask, lightRegionCrop, applyLightRegionMask, planLightRegionRecovery, LIGHT_REGION_LIMITS } from '../src/light-regions.ts';

function image(width = 240, height = 160, color = 90) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  function rect(x, y, w, h, value) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const index = (row * width + col) * 4; pixels[index] = pixels[index + 1] = pixels[index + 2] = value; pixels[index + 3] = 255;
    }
  }
  rect(0, 0, width, height, color);
  return { pixels, width, height, rect, analyze: () => findLightRegions(pixels, width, height) };
}
test('layout analysis rejects unbounded/invalid input before allocating component buffers', () => {
  assert.throws(() => findLightRegions(new Uint8ClampedArray(4), 1025, 1), /bounded/);
  assert.throws(() => findLightRegions(new Uint8ClampedArray(4), 1, 1, 0, 1), /bounded/);
  assert.throws(() => findLightRegions(new Uint8ClampedArray(3), 1, 1), /bounded/);
});
test('plain backgrounds, page-size interiors and edge-connected patches provide no region hint', () => {
  assert.equal(image(240, 160, 255).analyze().regions.length, 0);
  const page = image(); page.rect(2, 2, 236, 156, 255);
  assert.equal(page.analyze().regions.length, 0);
  const edge = image(); edge.rect(0, 20, 70, 50, 255);
  assert.equal(edge.analyze().regions.length, 0);
});
test('separate enclosed regions retain distinct pixel identities and natural line membership', () => {
  const source = image(); source.rect(15, 20, 80, 60, 255); source.rect(130, 85, 80, 60, 255);
  source.rect(30, 35, 4, 14, 0); source.rect(145, 100, 4, 14, 0);
  const map = source.analyze(); assert.equal(map.regions.length, 2);
  const first = visualRegionForLine(map, { x: 25, y: 30, width: 55, height: 25 });
  const second = visualRegionForLine(map, { x: 140, y: 95, width: 55, height: 25 });
  assert.ok(first && second); assert.notEqual(first, second);
  assert.equal(visualRegionForLine(map, { x: 70, y: 60, width: 100, height: 45 }), undefined);
});
test('a bounding rectangle does not assign text in a nonrectangular region notch', () => {
  const source = image(); source.rect(20, 20, 100, 45, 255); source.rect(20, 65, 45, 45, 255);
  const map = source.analyze(); assert.equal(map.regions.length, 1);
  assert.equal(visualRegionForLine(map, { x: 75, y: 75, width: 30, height: 20 }), undefined);
});
test('hole-filled masks preserve glyph pixels and clear connected border/artwork', () => {
  const source = image(); source.rect(15, 20, 90, 60, 0); source.rect(18, 23, 84, 54, 255);
  source.rect(35, 35, 8, 18, 0); source.rect(37, 39, 4, 10, 255); // A glyph with its own white hole.
  const map = source.analyze(), region = map.regions[0], mask = lightRegionMask(map, region), crop = lightRegionCrop(map, mask);
  const pixels = new Uint8ClampedArray(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) pixels.set(source.pixels.subarray(((crop.y + y) * source.width + crop.x + x) * 4, ((crop.y + y) * source.width + crop.x + x) * 4 + 4), (y * crop.width + x) * 4);
  applyLightRegionMask(pixels, crop, map, mask);
  const value = (x, y) => pixels[((y - crop.y) * crop.width + x - crop.x) * 4];
  assert.equal(value(35, 40), 0, 'Glyph stroke remains.');
  assert.equal(value(38, 42), 255, 'Glyph hole remains white.');
  assert.equal(value(crop.x, crop.y), 255, 'Outside corner is removed.');
  assert.equal(value(16, 35), 255, 'Bubble border is removed.');
});
test('downsampled masks map to bounded natural-resolution crop coordinates', () => {
  const source = image(); source.rect(20, 30, 80, 50, 255);
  const map = findLightRegions(source.pixels, source.width, source.height, source.width * 4, source.height * 4);
  const region = map.regions[0]; assert.deepEqual(region.box, { x: 80, y: 120, width: 320, height: 200 });
  assert.equal(visualRegionForLine(map, { x: 110, y: 140, width: 200, height: 100 }), region.id);
  const crop = lightRegionCrop(map, lightRegionMask(map, region));
  assert.equal(crop.x, 72); assert.equal(crop.y, 112); assert.equal(crop.width, 336); assert.equal(crop.height, 216);
});
test('recovery plans cap candidate count, individual pixels and total work, then restore reading order', () => {
  const source = image(800, 700);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) source.rect(25 + col * 250, 30 + row * 320, 180, 200, 255);
  const map = source.analyze(), plan = planLightRegionRecovery(map);
  assert.equal(plan.selected.length, LIGHT_REGION_LIMITS.maxRecoveryRegions); assert.equal(plan.skipped, 2);
  assert.ok(plan.pixels <= LIGHT_REGION_LIMITS.totalRecoveryPixels);
  assert.ok(plan.selected.every(item => item.crop.width * item.crop.height <= LIGHT_REGION_LIMITS.maxRecoveryPixels));
  assert.deepEqual(plan.selected.map(item => item.crop.y), plan.selected.map(item => item.crop.y).toSorted((a, b) => a - b));
  const huge = findLightRegions(source.pixels, source.width, source.height, 8000, 7000);
  assert.equal(planLightRegionRecovery(huge).selected.length, 0, 'Oversized recovery crops are skipped before allocation.');
});
