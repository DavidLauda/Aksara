/** Pure CSS geometry. No DOM objects or image/text content are retained here. */
export type OverlayRect = { x: number; y: number; width: number; height: number };
export type OverlayInsets = { top: number; right: number; bottom: number; left: number };
export type ImageMappingInput = {
  borderBox: OverlayRect;
  /** Untransformed CSS border-box dimensions, including border and padding. */
  layoutWidth: number;
  layoutHeight: number;
  border?: OverlayInsets;
  padding?: OverlayInsets;
  /** Browser intrinsic CSS dimensions determine object-fit none/scale-down. */
  naturalWidth: number;
  naturalHeight: number;
  /** OCR bitmap dimensions may differ because of image density correction. */
  sourceWidth: number;
  sourceHeight: number;
  objectFit?: string;
  objectPosition?: string;
  /** Computed transforms of the image and its ancestors; all must be supported. */
  transforms?: string[];
  /** Viewport and rectangular overflow clips in the same viewport coordinates. */
  clips?: OverlayRect[];
};
export type ImageMapping = {
  supported: true;
  content: OverlayRect;
  painted: OverlayRect;
  clip: OverlayRect | null;
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
};
export type MappingResult = ImageMapping | { supported: false; reason: 'invalid-dimensions' | 'unsupported-transform' | 'unsupported-fit' | 'unsupported-position' | 'source-aspect-mismatch' };
export type OverlayPlacement = { rect: OverlayRect; visibleRect: OverlayRect; clipped: boolean };

const zero: OverlayInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const finite = (value: number) => Number.isFinite(value);
const positive = (value: number) => finite(value) && value > 0;
const validRect = (rect: OverlayRect) => [rect.x, rect.y, rect.width, rect.height].every(finite) && rect.width >= 0 && rect.height >= 0 && finite(rect.x + rect.width) && finite(rect.y + rect.height);

export function intersectRects(...rects: OverlayRect[]): OverlayRect | null {
  if (!rects.length || rects.some(rect => !validRect(rect))) return null;
  const x = Math.max(...rects.map(rect => rect.x));
  const y = Math.max(...rects.map(rect => rect.y));
  const right = Math.min(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.min(...rects.map(rect => rect.y + rect.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** A bounding rectangle alone cannot recover rotation, reflection or perspective. */
export function isAxisAlignedTransform(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || text === 'none') return true;
  const match = /^(matrix|matrix3d)\(([^)]+)\)$/.exec(text);
  if (!match) return false;
  const entries = match[2].split(',').map(entry => Number(entry.trim()));
  if (entries.some(entry => !finite(entry)) || match[2].split(',').some(entry => !entry.trim())) return false;
  if (match[1] === 'matrix') return entries.length === 6 && entries[0] > 0 && entries[3] > 0 && entries[1] === 0 && entries[2] === 0;
  // Accept only a 3D serialization that is exactly a positive 2D scale/translate.
  return entries.length === 16 && entries[0] > 0 && entries[5] > 0 && entries[10] === 1 && entries[15] === 1
    && [1, 2, 3, 4, 6, 7, 8, 9, 11, 14].every(index => entries[index] === 0);
}

type Position = { percent: number; pixels: number };
const center: Position = { percent: 0.5, pixels: 0 };
const numberPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const scalarPattern = new RegExp(`^(${numberPattern})(%|px)$`);
const calculationPattern = new RegExp(`^calc\\(\\s*(${numberPattern})(%|px)\\s+([+-])\\s+(${numberPattern})(%|px)\\s*\\)$`);

function scalar(value: string): Position | null {
  if (/^[+-]?0(?:\.0+)?$/.test(value)) return { percent: 0, pixels: 0 };
  const match = scalarPattern.exec(value);
  if (match) {
    const amount = Number(match[1]);
    return finite(amount) ? match[2] === '%' ? { percent: amount / 100, pixels: 0 } : { percent: 0, pixels: amount } : null;
  }
  // Browsers serialize edge offsets as calc(100% - 10px). Support only this
  // linear percentage/px form, never guess arbitrary calc(), min(), var(), etc.
  const calculation = calculationPattern.exec(value);
  if (!calculation || calculation[2] === calculation[5]) return null;
  const first = Number(calculation[1]);
  const second = Number(calculation[4]) * (calculation[3] === '-' ? -1 : 1);
  if (![first, second].every(finite)) return null;
  return calculation[2] === '%' ? { percent: first / 100, pixels: second } : { percent: second / 100, pixels: first };
}

const horizontal = (token: string) => token === 'left' || token === 'right';
const vertical = (token: string) => token === 'top' || token === 'bottom';
const keyword = (token: string): Position | null => token === 'center' ? center : horizontal(token) || vertical(token) ? { percent: token === 'right' || token === 'bottom' ? 1 : 0, pixels: 0 } : null;

function parsePosition(value: string): { x: Position; y: Position } | null {
  const tokens = value.trim().toLowerCase().match(/calc\([^)]*\)|[^\s]+/g) ?? [];
  if (!tokens.length || tokens.length > 4) return null;
  if (tokens.length === 1) {
    const token = tokens[0], position = keyword(token) ?? scalar(token);
    return position ? vertical(token) ? { x: center, y: position } : { x: position, y: center } : null;
  }
  if (tokens.length === 2) {
    const [first, second] = tokens;
    // Reversed keywords are permitted; reversed numeric components are not.
    if (vertical(first) && (horizontal(second) || second === 'center')) return { x: keyword(second)!, y: keyword(first)! };
    if (first === 'center' && horizontal(second)) return { x: keyword(second)!, y: center };
    if (vertical(first) || horizontal(second)) return null;
    const x = keyword(first) ?? scalar(first), y = keyword(second) ?? scalar(second);
    return x && y ? { x, y } : null;
  }
  const components: Array<{ axis: 'x' | 'y' | null; value: Position }> = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === 'center') { components.push({ axis: null, value: center }); continue; }
    if (!horizontal(token) && !vertical(token)) return null;
    let position = keyword(token)!;
    const offset = index + 1 < tokens.length ? scalar(tokens[index + 1]) : null;
    if (offset) {
      index++;
      position = token === 'right' || token === 'bottom' ? { percent: 1 - offset.percent, pixels: -offset.pixels } : offset;
    }
    components.push({ axis: horizontal(token) ? 'x' : 'y', value: position });
  }
  if (components.length !== 2) return null;
  if (components[0].axis === null) components[0].axis = components[1].axis === 'x' ? 'y' : 'x';
  if (components[1].axis === null) components[1].axis = components[0].axis === 'x' ? 'y' : 'x';
  if (components[0].axis === components[1].axis) return null;
  return { x: components.find(component => component.axis === 'x')!.value, y: components.find(component => component.axis === 'y')!.value };
}

/** CSS Images 3: position is resolved against content size minus painted size. */
export function createImageMapping(input: ImageMappingInput): MappingResult {
  const { borderBox, layoutWidth, layoutHeight, naturalWidth, naturalHeight, sourceWidth, sourceHeight } = input;
  const border = input.border ?? zero, padding = input.padding ?? zero;
  const insets = [border.top, border.right, border.bottom, border.left, padding.top, padding.right, padding.bottom, padding.left];
  if (!validRect(borderBox) || ![borderBox.width, borderBox.height, layoutWidth, layoutHeight, naturalWidth, naturalHeight, sourceWidth, sourceHeight].every(positive)
    || insets.some(value => !finite(value) || value < 0) || input.clips?.some(rect => !validRect(rect))) return { supported: false, reason: 'invalid-dimensions' };
  if (input.transforms?.some(transform => !isAxisAlignedTransform(transform))) return { supported: false, reason: 'unsupported-transform' };
  if (Math.abs((sourceWidth / sourceHeight) / (naturalWidth / naturalHeight) - 1) > 0.01) return { supported: false, reason: 'source-aspect-mismatch' };
  const fit = input.objectFit ?? 'fill';
  if (!['fill', 'contain', 'cover', 'none', 'scale-down'].includes(fit)) return { supported: false, reason: 'unsupported-fit' };
  const position = parsePosition(input.objectPosition ?? '50% 50%');
  if (!position) return { supported: false, reason: 'unsupported-position' };
  const width = layoutWidth - border.left - border.right - padding.left - padding.right;
  const height = layoutHeight - border.top - border.bottom - padding.top - padding.bottom;
  if (!positive(width) || !positive(height)) return { supported: false, reason: 'invalid-dimensions' };
  const elementScaleX = borderBox.width / layoutWidth, elementScaleY = borderBox.height / layoutHeight;
  const contain = Math.min(width / naturalWidth, height / naturalHeight);
  const objectScale = fit === 'cover' ? Math.max(width / naturalWidth, height / naturalHeight) : fit === 'contain' ? contain : fit === 'scale-down' ? Math.min(1, contain) : 1;
  const paintedWidth = fit === 'fill' ? width : naturalWidth * objectScale;
  const paintedHeight = fit === 'fill' ? height : naturalHeight * objectScale;
  const localX = (width - paintedWidth) * position.x.percent + position.x.pixels;
  const localY = (height - paintedHeight) * position.y.percent + position.y.pixels;
  const content: OverlayRect = { x: borderBox.x + (border.left + padding.left) * elementScaleX, y: borderBox.y + (border.top + padding.top) * elementScaleY, width: width * elementScaleX, height: height * elementScaleY };
  const painted: OverlayRect = { x: content.x + localX * elementScaleX, y: content.y + localY * elementScaleY, width: paintedWidth * elementScaleX, height: paintedHeight * elementScaleY };
  if (!validRect(content) || !validRect(painted) || !positive(painted.width) || !positive(painted.height)) return { supported: false, reason: 'invalid-dimensions' };
  return { supported: true, content, painted, clip: intersectRects(content, painted, ...input.clips ?? []), scaleX: painted.width / sourceWidth, scaleY: painted.height / sourceHeight, sourceWidth, sourceHeight };
}

/** Return the full mapped box plus its visible portion; never move cropped text. */
export function mapOverlayBox(mapping: ImageMapping, naturalBox: OverlayRect): OverlayPlacement | null {
  if (!mapping.clip || !validRect(naturalBox) || !positive(naturalBox.width) || !positive(naturalBox.height)) return null;
  const rect: OverlayRect = { x: mapping.painted.x + naturalBox.x * mapping.scaleX, y: mapping.painted.y + naturalBox.y * mapping.scaleY, width: naturalBox.width * mapping.scaleX, height: naturalBox.height * mapping.scaleY };
  const visibleRect = intersectRects(rect, mapping.clip);
  if (!visibleRect) return null;
  const clipped = (['x', 'y', 'width', 'height'] as const).some(key => Math.abs(rect[key] - visibleRect[key]) > 0.0001);
  return { rect, visibleRect, clipped };
}
