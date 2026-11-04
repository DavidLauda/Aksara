import { createImageMapping, mapOverlayBox, type ImageMapping, type MappingResult, type OverlayInsets, type OverlayRect } from './overlay-geometry';
import type { OcrResult } from './ocr-result';
import type { ImageTranslation } from './translation-result';

export const OVERLAY_CSS = `
  .image-overlay{position:absolute;overflow:hidden;pointer-events:none;z-index:0;isolation:isolate}
  .translated-segment{position:absolute;pointer-events:auto;user-select:text;cursor:text;padding:2px 4px;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;background:#fffef9;color:#182b20;box-shadow:0 0 0 1px #526b5e55;border-radius:2px;font:500 16px/1.12 system-ui,sans-serif;text-align:left}
  .translated-segment:focus-visible{outline:3px solid #9b6b0c;outline-offset:-3px}
  .image-overlay.high-contrast .translated-segment{background:#fff;color:#000;box-shadow:inset 0 0 0 2px #000;font-weight:600}
  .translated-segment[data-overflow=true]{box-shadow:inset 0 -2px 0 #9b6b0c}
  @media(forced-colors:active){.translated-segment{background:Canvas;color:CanvasText;border:1px solid CanvasText;forced-color-adjust:auto}}
`;

const px = (value: string) => Number.parseFloat(value) || 0;
const rectOf = (rect: DOMRect): OverlayRect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
const insets = (css: CSSStyleDeclaration, kind: 'border' | 'padding'): OverlayInsets => ({
  top: px(kind === 'border' ? css.borderTopWidth : css.paddingTop), right: px(kind === 'border' ? css.borderRightWidth : css.paddingRight),
  bottom: px(kind === 'border' ? css.borderBottomWidth : css.paddingBottom), left: px(kind === 'border' ? css.borderLeftWidth : css.paddingLeft),
});
function boxDimensions(element: HTMLElement, css: CSSStyleDeclaration) {
  const border = insets(css, 'border'), padding = insets(css, 'padding');
  const width = px(css.width), height = px(css.height);
  return { border, padding,
    width: width > 0 ? width + (css.boxSizing === 'border-box' ? 0 : border.left + border.right + padding.left + padding.right) : element.offsetWidth,
    height: height > 0 ? height + (css.boxSizing === 'border-box' ? 0 : border.top + border.bottom + padding.top + padding.bottom) : element.offsetHeight,
  };
}
const hasRadius = (css: CSSStyleDeclaration) => [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius].some(value => value.split(/\s+/).some(part => px(part) !== 0));

/** Rectangular mapping only: a guessed overlay is worse than the readable fallback. */
export function measureImage(image: HTMLImageElement, ocr: OcrResult): { mapping: MappingResult; hidden: boolean; reason?: string } {
  const viewport = window.visualViewport;
  const clips: OverlayRect[] = [{ x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight }];
  const transforms: string[] = [];
  let unsupported = false, hidden = false;
  for (let element: HTMLElement | null = image; element; element = element.parentElement) {
    const css = getComputedStyle(element);
    if (css.visibility !== 'visible' || css.display === 'none' || Number(css.opacity) === 0 || css.contentVisibility === 'hidden') hidden = true;
    transforms.push(css.transform);
    const scale = css.scale;
    if (css.rotate !== 'none' && !/^0(?:deg|rad|turn)?$/.test(css.rotate)) unsupported = true;
    if (scale !== 'none' && scale.split(/\s+/).some(value => !Number.isFinite(Number(value)) || Number(value) <= 0)) unsupported = true;
    if (css.perspective !== 'none' || css.clipPath !== 'none' || css.maskImage !== 'none' || css.getPropertyValue('-webkit-mask-image') !== 'none' && css.getPropertyValue('-webkit-mask-image') !== '') unsupported = true;
    if (css.clip !== 'auto' || css.offsetPath !== 'none') unsupported = true;
    const clipX = /^(hidden|clip|scroll|auto)$/.test(css.overflowX), clipY = /^(hidden|clip|scroll|auto)$/.test(css.overflowY);
    if (element === image || clipX || clipY) if (hasRadius(css)) unsupported = true;
    if (element !== image && element !== document.documentElement && (clipX || clipY)) {
      const rect = element.getBoundingClientRect(), box = boxDimensions(element, css);
      const sx = rect.width / box.width, sy = rect.height / box.height;
      clips.push({ x: clipX ? rect.x + element.clientLeft * sx : clips[0].x, y: clipY ? rect.y + element.clientTop * sy : clips[0].y,
        width: clipX ? element.clientWidth * sx : clips[0].width, height: clipY ? element.clientHeight * sy : clips[0].height });
    }
    // A transformed root also transforms the extension's fixed host.
    if (element === document.documentElement && (css.transform !== 'none' || css.scale !== 'none' || css.translate !== 'none' || px(css.zoom) !== 1)) unsupported = true;
  }
  const css = getComputedStyle(image), box = boxDimensions(image, css);
  if (css.getPropertyValue('object-view-box') && css.getPropertyValue('object-view-box') !== 'none') unsupported = true;
  if (css.imageOrientation !== 'from-image' && css.imageOrientation !== '0deg') unsupported = true;
  if (unsupported) return { mapping: { supported: false, reason: 'unsupported-transform' }, hidden, reason: 'This image uses a rotated, rounded or masked layout. Read the translation in Text details.' };
  return { mapping: createImageMapping({ borderBox: rectOf(image.getBoundingClientRect()), layoutWidth: box.width, layoutHeight: box.height, border: box.border, padding: box.padding,
    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, sourceWidth: ocr.imageWidth, sourceHeight: ocr.imageHeight,
    objectFit: css.objectFit, objectPosition: css.objectPosition, clips, transforms }), hidden };
}

/** One disposable layer per image. Text never enters markup or persistent storage. */
export class ImageOverlay {
  readonly element = document.createElement('div');
  private nodes: HTMLDivElement[] = [];
  private signatures: string[] = [];
  private translation: ImageTranslation | null = null;
  constructor(parent: ShadowRoot, imageId: string) {
    this.element.className = 'image-overlay'; this.element.dataset.imageId = imageId; this.element.id = `overlay-${imageId}`;
    this.element.setAttribute('role', 'region'); this.element.setAttribute('aria-label', 'Translated image text'); this.element.hidden = true;
    parent.prepend(this.element);
  }
  setResult(translation: ImageTranslation) {
    if (this.translation === translation) return;
    this.translation = translation; this.element.replaceChildren(); this.nodes = []; this.signatures = [];
    this.element.lang = translation.targetLanguage === 'ind_Latn' ? 'id' : translation.targetLanguage === 'fra_Latn' ? 'fr' : 'en';
    for (const segment of translation.segments) {
      const node = document.createElement('div'); node.className = 'translated-segment'; node.dataset.segmentId = segment.segmentId;
      node.textContent = segment.translatedText; node.tabIndex = 0; node.hidden = true;
      node.style.textAlign = segment.textAlign ?? 'left';
      this.element.append(node); this.nodes.push(node);
    }
  }
  update(mapping: ImageMapping, original: boolean, highContrast: boolean): { shown: number; missing: number; cropped: number; overflow: number } {
    const clip = mapping.clip;
    this.element.hidden = original || !clip;
    this.element.classList.toggle('high-contrast', highContrast);
    const summary = { shown: 0, missing: 0, cropped: 0, overflow: 0 };
    if (!clip || !this.translation) return summary;
    setRect(this.element, clip);
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index], segment = this.translation.segments[index];
      const placement = segment.box ? mapOverlayBox(mapping, segment.box) : null;
      node.hidden = !placement;
      if (!placement) { summary.missing++; continue; }
      summary.shown++; if (placement.clipped) summary.cropped++;
      const { rect } = placement;
      const signature = `${rect.width.toFixed(2)},${rect.height.toFixed(2)},${highContrast}`;
      setRect(node, { ...rect, x: rect.x - clip.x, y: rect.y - clip.y });
      if (this.signatures[index] !== signature && !original) {
        this.signatures[index] = signature;
        const rows = segment.sourceLineIds?.length ?? 1;
        let size = Math.max(12, Math.min(44, rows > 1 ? rect.height / rows * 0.9 : rect.height * 0.72));
        node.style.fontSize = `${size}px`;
        // At most seven bounded measurements per changed segment size. Idle
        // tracking only changes position, so it does not repeat font fitting.
        for (let step = 0; step < 6 && size > 12 && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1); step++) {
          size = Math.max(12, size * 0.8); node.style.fontSize = `${size}px`;
        }
        node.dataset.overflow = String(node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
      }
      if (node.dataset.overflow === 'true') summary.overflow++;
    }
    return summary;
  }
  hide() { this.element.hidden = true; }
  dispose() { this.element.remove(); this.translation = null; this.nodes = []; this.signatures = []; }
}

function setRect(node: HTMLElement, rect: OverlayRect) {
  for (const [key, value] of [['left', rect.x], ['top', rect.y], ['width', rect.width], ['height', rect.height]] as const) {
    const next = `${value}px`; if (node.style[key] !== next) node.style[key] = next;
  }
}
