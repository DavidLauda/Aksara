# Phase 5 — Aligned overlays and page controls

## Design contract

The image itself is the primary reading surface. Preserve Aksara's quiet green controls, warm neutral background, system typography and visible gold focus. The primary action remains Translate on the chosen image. A completed translation places high-contrast, selectable text over its matching OCR region; a compact status panel offers Show original, Copy translation, Retry, High contrast and Dismiss. Expandable Text details retains the full translation and recognized text without covering the image by default. Unsupported mappings show text details with a reason instead of guessed positions.

The original image and its page layout must remain unchanged. Coordinate mapping supports ordinary rectangular images, object-fit modes and object-position, including positive axis-aligned CSS scaling. Scroll, resize, zoom, layout movement and clipping ancestors must update the overlay. Rotation, skew, perspective and other shapes that cannot be mapped reliably require a readable fallback. Source changes and document changes invalidate results. Text is always assigned through textContent/value, never interpreted HTML.

Targets: 375×812, 768×900 and 1440×900 for page layouts; 330-pixel popup content. Existing Phase 4 captures are the local reference. Labels, native buttons, visible focus, status announcements, reduced motion and a high-contrast option support keyboard and low-vision use. Copy occurs only after a trusted user click; failure offers the selectable text field. Dismiss restores focus to Translate. Site preferences are remembered per exact HTTP(S) origin without adding browsing permissions or automatic translation.

| State | Trigger, visible feedback and next action |
| --- | --- |
| Loading | Existing acquisition/OCR/model/translation progress; Cancel |
| Empty | No recognized text or model; existing guidance and retry/setup |
| Error | Mapping unsupported or runtime failure; explain and expose selectable text/retry |
| Partial | Some regions clipped, too small, overflowing, missing boxes or skipped by inference budget; full text remains in Text details |
| Success | Aligned segments with source/target status and original/copy/retry/dismiss controls |
| Permission | Remembered site control preference and separate existing named image-host permission flow |

Implementation and measured validation are recorded below after completion. Aligned text uses an opaque/lightly translucent backing; it does not erase or reconstruct the original pixels.
