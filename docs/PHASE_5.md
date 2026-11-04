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

Implementation date: 4 November 2026. Version: 0.5.0. Aligned text uses an opaque backing; it does not erase or reconstruct the original pixels.

## Implementation

`src/overlay-geometry.ts` maps each natural OCR box into the rendered image using the CSS content box. Border and padding are subtracted before resolving fit and position. Browser intrinsic dimensions govern `none` and `scale-down`; OCR bitmap dimensions govern the returned text coordinates. Noncenter percentages, pixel offsets, keywords and simple computed percentage/pixel calculations are supported. Percentages resolve against content size minus painted size, following [CSS Images 3](https://www.w3.org/TR/css-images-3/#the-object-position). Positive axis-aligned transform matrices and independent CSS scale are supported. A source/intrinsic aspect mismatch over 1% produces a fallback.

`src/image-overlay.ts` measures DOM geometry, validates the image/ancestor transform chain, and creates a separate clipped layer. It intersects the viewport, painted image, content box and rectangular overflow ancestors. Full text-box geometry stays at its source position; clipping never moves cropped words onto another part of the image. Fully cropped boxes are hidden. Rotations, skew, reflection, perspective, masks, clip paths, rounded clipping, incompatible orientation and nondefault object-view-box use the text fallback. Transformed document roots are also unsupported because they alter the fixed overlay host's coordinate system.

Each translated segment uses safe textContent, its captured segment ID, a selectable focusable region and the target language. Font fitting runs only when a segment's size or contrast changes, with a maximum of six reductions and a 12 px minimum. If text still overflows, the card names that limitation and provides the complete string in Text details. The overlay is rectangular, so it does not inpaint photographic backgrounds or rotate text.

The content script retains the existing image acquisition, bounded chunks, worker-instance checks and progress/error contracts. Geometry is refreshed by scroll/resize, mutation and resize observers, visual-viewport events, and an 80 ms tracker while a request/result is visible. No model or image pixels are processed by that tracker. Hidden documents stop tracking. `currentSrc`, source attributes, image removal, full-page navigation and same-document route changes invalidate results. Navigation also invalidates a pending upload or authoritative source snapshot.

The normal Vite build emits module entries for extension contexts. A dedicated IIFE build now bundles content helpers into one classic `content.js`, preserving Chrome scripting compatibility. Build verification parses that entry as a classic script and checks local executable assets. Development watch uses the same two build paths.

## Controls and accessibility

- **Show original / Show translation** changes only the overlay's visibility and preserves the result for comparison. The button exposes its pressed state and controlled layer.
- **Copy translation** copies the entire translation after a trusted click. Secure contexts use the Clipboard API; ordinary HTTP uses a temporary selected text field and user-gesture copy fallback. The [clipboard API limitations](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard) apply. No new clipboard permission or clipboard-reading capability is requested. If copying is blocked, Aksara opens and selects Text details for manual copying.
- **Retry translation** starts a fresh user-requested job with the latest language preferences; prior results are cleared. **Cancel** retains the Phase 4 hard worker termination behavior.
- **Text details** has an expanded state and a connected panel. It is collapsed for a successful aligned result and automatically available for an unsupported layout. Both original/translated fields have connected labels. **Dismiss** removes all result text and returns focus to Translate.
- **High contrast** switches to white/black backing with a strong border and saves the boolean preference. Text regions and controls have visible keyboard focus and target-language metadata. Reduced-motion and system forced-colors styles are included. Automatically hidden controls return focus to a visible action when appropriate.
- The result panel prefers space below the image when available and remains clamped to the viewport. It can cover part of the image where surrounding space is limited. Keyboard users can reach both selectable segments and the complete details fields.

## Site preferences and privacy

`chrome.storage.local.siteSettings` contains only `{disabledOrigins: ["https://example.com"]}`. Origins are exact, canonical HTTP(S) origins including scheme and nondefault port; paths, queries, credentials and image/text data are rejected. At most 100 exclusions are retained; adding another returns a useful limit message rather than silently re-enabling a saved site. Re-allowing an origin removes its exclusion. `overlaySettings` separately stores `{highContrast: boolean}`.

The popup verifies the active tab ID and origin before saving or injecting controls. Disabling an origin cancels pending work and removes overlays and controls from already activated pages. Re-allowing it requires manual Enable image controls for that page. The service worker independently checks the saved exclusion before acquiring an image. No new host permission, automatic injection or automatic translation is added. Stored preferences are reread and repaired rather than trusting page-supplied flags; asynchronous initial reads cannot override newer preference updates.

Results remain in the activated page's memory until cleared or the document is destroyed; there is no persistent translation history. The website can read output placed in its DOM, as in earlier previews. No remote inference, telemetry or additional model networking is introduced. Model management and licensing remain as documented in [Phase 4](PHASE_4.md).

## Validation

The completed run and screenshots are recorded in [Phase 5 evidence](evidence/phase-5/QA.md). Geometry unit tests cover all five fit modes, density-corrected dimensions, clipping, percent/px/edge positions, borders/padding, supported scales and explicit fallback cases. Site-setting tests cover canonicalization, origin separation, bounds and boolean repair. Browser inference uses the real packaged OCR and existing cached NLLB weights. The script separately labels hostile strings, excessive text, navigation replay and independent-image tests that use rendering fixtures, so they are not mistaken for model-quality results.

The supported layout matrix is rectangular images in ordinary top-level HTTP(S) documents. Native Chrome popup/permission windows, full screen-reader operation, a broad GPU/browser matrix, page occlusion by unrelated foreground elements and extreme root transforms still need release-stage coverage. No approved matching pixel baseline exists, so pixel regression remains INCONCLUSIVE even when coordinate assertions and visual inspection pass. Phase 6 remains hardening and release assessment.
