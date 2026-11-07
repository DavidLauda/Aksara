import type { OcrLine } from './ocr-result';

export const LIGHT_REGION_LIMITS = Object.freeze({ maxSide: 1024, maxCandidates: 32, maxRecoveryRegions: 4, maxRecoveryPixels: 2_000_000, totalRecoveryPixels: 3_000_000 });
type Box = OcrLine['box'];
export type LightRegion = { id: string; label: number; box: Box; grid: Box; pixels: number };
export type LightRegionMap = { width: number; height: number; sourceWidth: number; sourceHeight: number; labels: Int32Array; regions: LightRegion[] };

/** Pixel hints, not semantic bubble detection. Bright backgrounds touching the
 * image boundary, page-sized areas, tiny patches and irregular slivers are ignored.
 * The caller downsamples to a bounded grid; all returned boxes use source pixels. */
export function findLightRegions(rgba: Uint8ClampedArray, width: number, height: number, sourceWidth = width, sourceHeight = height): LightRegionMap {
  if (![width, height, sourceWidth, sourceHeight].every(Number.isSafeInteger) || width < 1 || height < 1 || sourceWidth < width || sourceHeight < height || width > LIGHT_REGION_LIMITS.maxSide || height > LIGHT_REGION_LIMITS.maxSide || rgba.length !== width * height * 4) throw new Error('Invalid bounded layout grid.');
  const size = width * height, labels = new Int32Array(size), queue = new Int32Array(size);
  for (let index = 0; index < size; index++) {
    const offset = index * 4, r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2];
    labels[index] = Math.min(r, g, b) >= 220 && Math.max(r, g, b) - Math.min(r, g, b) <= 30 ? 0 : -1;
  }
  const scaleX = sourceWidth / width, scaleY = sourceHeight / height, candidates: LightRegion[] = [];
  let label = 0;
  for (let start = 0; start < size; start++) {
    if (labels[start] !== 0) continue;
    label++; let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0, boundary = false;
    labels[start] = label; queue[0] = start;
    const visit = (index: number) => { if (labels[index] === 0) { labels[index] = label; queue[tail++] = index; } };
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) boundary = true;
      if (x > 0) visit(index - 1); if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width); if (y + 1 < height) visit(index + width);
    }
    const grid = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, boxArea = grid.width * grid.height;
    if (boundary || tail < Math.max(150, size * .0005) || boxArea > size * .45 || tail / boxArea < .55 || grid.width * scaleX < 48 || grid.height * scaleY < 24 || grid.width / grid.height > 20) continue;
    const x = Math.floor(left * scaleX), y = Math.floor(top * scaleY);
    candidates.push({ id: `v${label}`, label, grid, pixels: tail, box: { x, y, width: Math.ceil((right + 1) * scaleX) - x, height: Math.ceil((bottom + 1) * scaleY) - y } });
  }
  candidates.sort((a, b) => b.pixels - a.pixels);
  return { width, height, sourceWidth, sourceHeight, labels, regions: candidates.slice(0, LIGHT_REGION_LIMITS.maxCandidates) };
}

/** A line must fit inside one candidate and sample its actual bright interior.
 * Bounding rectangles alone cannot establish shared region membership. */
export function visualRegionForLine(map: LightRegionMap, box: Box): string | undefined {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
  const votes = new Map<number, number>();
  for (let row = 0; row < 5; row++) for (let col = 0; col < 9; col++) {
    const x = Math.floor((box.x + box.width * (col + .5) / 9) * map.width / map.sourceWidth);
    const y = Math.floor((box.y + box.height * (row + .5) / 5) * map.height / map.sourceHeight);
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
    const label = map.labels[y * map.width + x];
    if (map.regions.some(region => region.label === label)) votes.set(label, (votes.get(label) ?? 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]), winner = ranked[0];
  if (!winner || winner[1] < 12 || winner[1] / ranked.reduce((sum, [, count]) => sum + count, 0) < .9) return;
  const region = map.regions.find(region => region.label === winner[0])!;
  if (box.x < region.box.x || box.y < region.box.y || box.x + box.width > region.box.x + region.box.width || box.y + box.height > region.box.y + region.box.height) return;
  return region.id;
}

/** Fill interior holes (letters) while excluding the border and surrounding art.
 * A one-grid-cell inset removes antialiased boundary pixels after downsampling.
 * Nothing from the OCR transcript or benchmark annotations enters this mask. */
function regionGridBounds(map: LightRegionMap, region: LightRegion) {
  const left = Math.max(0, region.grid.x - 2), top = Math.max(0, region.grid.y - 2);
  const right = Math.min(map.width, region.grid.x + region.grid.width + 2), bottom = Math.min(map.height, region.grid.y + region.grid.height + 2);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function lightRegionMask(map: LightRegionMap, region: LightRegion) {
  const { x: left, y: top, width, height } = regionGridBounds(map, region);
  const outside = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const visit = (x: number, y: number) => {
    const index = y * width + x;
    if (!outside[index] && map.labels[(y + top) * map.width + x + left] !== region.label) { outside[index] = 1; queue[tail++] = index; }
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    if (x > 0) visit(x - 1, y); if (x + 1 < width) visit(x + 1, y);
    if (y > 0) visit(x, y - 1); if (y + 1 < height) visit(x, y + 1);
  }
  const pixels = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x;
    if (!outside[index] && !outside[index - 1] && !outside[index + 1] && !outside[index - width] && !outside[index + width]) pixels[index] = 1;
  }
  return { x: left, y: top, width, height, pixels };
}

type RegionMask = ReturnType<typeof lightRegionMask>;
export function lightRegionCrop(map: LightRegionMap, mask: Pick<RegionMask, 'x' | 'y' | 'width' | 'height'>): Box {
  const x = Math.floor(mask.x * map.sourceWidth / map.width), y = Math.floor(mask.y * map.sourceHeight / map.height);
  return { x, y, width: Math.min(map.sourceWidth, Math.ceil((mask.x + mask.width) * map.sourceWidth / map.width)) - x,
    height: Math.min(map.sourceHeight, Math.ceil((mask.y + mask.height) * map.sourceHeight / map.height)) - y };
}

export function planLightRegionRecovery(map: LightRegionMap) {
  const selected: Array<{ region: LightRegion; crop: Box }> = [];
  let pixels = 0, skipped = 0;
  for (const region of map.regions) {
    const crop = lightRegionCrop(map, regionGridBounds(map, region)), area = crop.width * crop.height;
    if (selected.length >= LIGHT_REGION_LIMITS.maxRecoveryRegions || area > LIGHT_REGION_LIMITS.maxRecoveryPixels || pixels + area > LIGHT_REGION_LIMITS.totalRecoveryPixels) { skipped++; continue; }
    selected.push({ region, crop }); pixels += area;
  }
  selected.sort((a, b) => a.crop.y - b.crop.y || a.crop.x - b.crop.x);
  return { selected, pixels, skipped };
}

/** Paint only excluded source pixels white. Natural resolution and glyph pixels
 * are retained; recovered OCR coordinates only need the crop's x/y offset. */
export function applyLightRegionMask(rgba: Uint8ClampedArray, crop: Box, map: LightRegionMap, mask: RegionMask) {
  if (rgba.length !== crop.width * crop.height * 4) throw new Error('Invalid layout crop.');
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const gridX = Math.floor((crop.x + x + .5) * map.width / map.sourceWidth) - mask.x;
    const gridY = Math.floor((crop.y + y + .5) * map.height / map.sourceHeight) - mask.y;
    if (gridX < 0 || gridY < 0 || gridX >= mask.width || gridY >= mask.height || !mask.pixels[gridY * mask.width + gridX]) {
      const index = (y * crop.width + x) * 4; rgba[index] = rgba[index + 1] = rgba[index + 2] = rgba[index + 3] = 255;
    }
  }
}
