# Compact overlay UI — design contract

The reading surface is the comic/image. Replace the always-open result card with a single small toolbar, normally Original, Copy, More and Close. Remove the normal Text details control, confidence percentages and generic accuracy disclaimer. Retry and high contrast belong in a disclosure opened by More. Full text is an exceptional reading fallback for unsupported/clipped/partial output or blocked clipboard access, rather than a default information panel. OCR/model behavior is outside this change.

Use Aksara's dark green ink with a pale neutral glass surface, hairline highlight, soft shadow and rounded control edges. The glass has a purpose: a small floating tool on varied host pages. Use CSS only, one active blurred toolbar, bounded 10 px blur, solid menus/readers and solid fallbacks for high contrast, forced colors and reduced transparency. No image-sized filters, animated refraction, remote assets, new UI packages or framework migration. Keep translated text backing opaque and readable.

Primary action: Translate the hovered image. Loading: short progress and Cancel. Success: one compact toolbar; the Translate trigger disappears. More: native buttons with Tab navigation, Escape/outside dismissal and focus restoration; only one menu opens at a time. Empty/error: concise, actionable feedback with Try again and Close. OCR without a model: preserve selectable source text and offer Setup. Partial/unsupported mapping: expose a contextual Read action and full selectable text. Copy feedback is brief and does not expand a card. Dismiss removes result text and restores Translate focus.

Menus/readers open relative to a stable toolbar anchor, flip above when needed and stay inside the visual viewport. Scroll, resize, zoom, source/navigation invalidation, cancellation and per-site disable retain existing behavior. Use labeled native buttons, connected disclosure states, polite announcements, visible focus and at least 36 px control targets. Test at 375×812, 768×900 and 1440×900, at 150% zoom, on bright/dark/busy backgrounds, with reduced motion and opaque/forced-color fallbacks.

Local references: the user's supplied screenshot and the 0.6.1 captures in docs/evidence/region-ocr-fix. The screenshot's large card obscures the second comic panel and repeats secondary controls/status. Keep the existing image-coordinate contract and full text recovery while reducing persistent controls to a single row. Pixel regression is inconclusive until a matching new baseline is approved.

## Implemented surface

`src/image-controls.ts` owns the toolbar and disclosure lifecycle. `src/content.ts` supplies state, retains image acquisition/invalidation, and positions the bar inside the image's upper corner. The result card no longer participates in normal success layout. Copy flashes a checkmark for 1.8 seconds and announces completion without opening anything. Menus receive keyboard focus, close on Escape/outside focus or pointer input, and restore focus to More on Escape. Read/Partial opens a selectable translation; OCR without translation offers Read text. Unsupported image mapping opens the reader automatically. Dismiss clears retained text and restores Translate.

`design-tokens.json` and [the design audit](../DESIGN.md) record the visual choices. The glass surface uses CSS and static inline SVG controls. It adds no dependency, animation loop or model operation. The existing geometry tracker still runs only while a request/result is visible; identical control states skip DOM updates. Only the last hovered/focused/used image can have an active blur surface. The filter is 10 px and the normal result toolbar is approximately 212×44 px; menus and full text are unblurred. This bounds filter area, but does not guarantee a particular power draw on every device.

## Setup message

The only new runtime request is:

```json
{ "schemaVersion": 1, "target": "background", "type": "OPEN_SETUP" }
```

It returns `{ "ok": true }` or `{ "ok": false, "error": "UNAUTHORIZED_CONTEXT" }` / `SETUP_UNAVAILABLE`. The background accepts its own top-frame HTTP(S) content script or exact popup/options page and calls `chrome.runtime.openOptionsPage()` with a fixed destination. The message contains no image, text, model consent or arbitrary URL. It does not download weights. Existing image/translation port contracts and privileged diagnostics/model-management restrictions remain in force.

## Verification

`npm run test:glass` isolates rendering with a saved real OCR/NLLB result. It explicitly labels the replay, checks 13 UI journeys, and makes no inference-quality claim. `test:images`, `test:overlays` and `test:translation` exercise the actual packaged pipeline. Reports, screenshots, manual observations and limits are recorded in [the local QA evidence](evidence/glass-ui/QA.md).

To try version 0.7.0, rebuild with `npm run build`, reload Aksara at `chrome://extensions`, refresh the webpage, enable image controls, and translate an image. Existing cached model data does not need to be downloaded again. The change simplifies the controls; OCR/model accuracy and cold inference time still have their existing limitations.
