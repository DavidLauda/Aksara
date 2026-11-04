# Phase 5 QA — local unpacked extension — 4 November 2026

The **Phase 5 functional exit gate passes** for Aksara 0.5.0 on Chromium 156.0.8078.4 / Windows. The test machine has an AMD Ryzen 5 5600H and 16 GB RAM; the final capability probe selected NVIDIA Turing WebGPU. This is one machine, not a browser/GPU support matrix. Pixel regression remains **INCONCLUSIVE** because there is no approved matching baseline.

## Verification

- Production build, TypeScript and **68 automated tests pass**. The distributable content entry parses as a classic script and its runtime helpers are bundled locally.
- **16 overlay browser scenarios pass**. Initial two-line recognition and translation, plus Retry, use actual packaged Tesseract and cached NLLB q8/WebGPU. Outputs include “Buka pintunya.” and “Selamat pagi.” with the source line IDs and natural-coordinate boxes. No model downloads or external requests occur.
- Numeric browser assertions check geometry within 2 CSS pixels for fill, contain, cover, none and scale-down, including percentages, pixel positions, four-value edge offsets, borders/padding, positive transforms, independent CSS scale, ancestor scale, scrolling, DOM movement and resize. Overflow ancestors and visual-viewport zoom at 150% retain clipping and reachable controls.
- Original/translated toggle, full-text Copy, details expansion, persisted high contrast and focus restoration on Dismiss pass. Clipboard verification only pastes the known fixture text after Aksara confirms its own trusted copy action. The harness does not read unrelated clipboard content.
- Site disable clears existing results, persists across popup reload, cancels an actual in-progress job and closes its worker host. Re-allowing an origin does not reactivate controls automatically; manual activation works. Origin separation and the 100-origin bound also have unit coverage.
- Invisibility hides overlays/controls and restores the saved result when pixels become visible again. Source replacement and same-document route changes invalidate results. Two images have separate original toggles and Dismiss actions.
- Hostile/long text, navigation replay and two-image independence use **explicit rendering fixtures** derived from the real result. They test DOM behavior, not inference quality. Literal HTML-like strings remain text, no image/script element is created, long content is bounded and the complete translation remains in Text details.
- All **20 image/OCR regression scenarios pass**, including permission guidance, two OCR languages, offline inline reads, blank images, cancellation, worker restart/reload, responsive source replacement and temporary-image cleanup.
- **Three first-use browser scenarios pass** in a separate empty profile: no requests when consent is missing, OCR remains readable without weights, and same-language results need no model/network. Content-script model-download requests are rejected.
- Final WebGPU/OCR smoke passes compute value 42 in both hosts and local English/Indonesian OCR. Captured page/extension errors and unexpected requests are empty in the passing reports.

The test run caught and repaired automatic detail opening when a supported image changes to an unsupported layout. An early two-image assertion also needed to wait for the next layout frame; the corrected complete suite passes. Production results below are from the final run.

## Rendered review and accessibility

Page captures at **375×812, 768×900 and 1440×900** were visually inspected. Translated regions align with the image text, use an opaque warm backing and scale with the image. Labels and text remain readable; the compact panel fits the viewport and prefers space below the image. It can cover image content where space is limited, particularly under zoom. Text details supplies complete text when regions are cropped or too small.

The popup fits its 330 px content column, with the source/target fields, site checkbox, activation and model status in approximately 550 vertical pixels for the fixture origin. The unsupported-layout capture automatically opens selectable original/translated fields and explains the fallback. High contrast, loading, empty, long-text and disabled-site captures were reviewed. Native Chrome popup sizing and grant/deny windows are not claimed as automated.

Axe reports **zero violations** for the result page at all three target widths and the popup. Keyboard activation, original toggle, details, copying, high contrast, Dismiss and focus restoration are exercised. Controls have visible focus and labels; detail fields have connected labels; overlay regions carry the target language. Reduced-motion emulation is used for layout checks. The visible-result tracker avoids rewriting unchanged live text or resetting text-field values. A full screen-reader pass and forced-colors OS integration remain manual; passing axe is not full WCAG conformance.

## Performance and limits

The real two-line cold journey took **33.0 seconds** including OCR/verification/loading/inference; Retry took **12.9 seconds**. These are fixture measurements on this machine. The complete scenario sequence records LCP 48 ms, maximum Event Timing 32 ms and cumulative layout shift 1.6163. That sequence intentionally changes image sizes, positions, zoom, layout and routes, so its CLS is not a passive extension-impact score. Event Timing is not field INP. No production latency or memory ceiling is inferred.

Rounded/masked/rotated/skewed/perspective layouts use the text fallback. Image inpainting, arbitrary foreground occlusion, native permission/UI behavior, assistive-technology testing and broader device coverage remain release-stage work. The model's noncommercial license remains unchanged. No commercial release approval is implied.

## Evidence

- [Overlay scenarios and geometry](overlay-report.json)
- [Image/OCR regression](images-report.json)
- [First-use and no-download checks](translation-empty-report.json)
- [GPU and bundled OCR smoke](browser-report.json)
- [Design evidence](design-evidence.json)
- [Actual translated image](overlay-success.png), [narrow](overlay-375.png), [tablet](overlay-768.png), [desktop](overlay-1440.png)
- [Zoom](overlay-zoom.png), [ancestor clipping](overlay-ancestor-clip.png), [unsupported layout](overlay-unsupported.png)
- [High contrast](overlay-high-contrast.png), [literal long text fixture](overlay-literal-long-text.png), [loading](overlay-loading.png), [empty OCR](ocr-empty.png)
- [Popup](overlay-popup.png), [site disabled](overlay-site-disabled.png), [image-host guidance](images-permission.png)
