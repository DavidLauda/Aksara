# Phase 3 UI QA — local unpacked extension — 25 October 2026

Scope: Aksara 0.3.0, Chromium 156.0.8078.4 on Windows. Disposable `.test-profile-ocr`, copied test extension and loopback HTTP fixtures; no user accounts or production site mutations. Fixtures use public-looking hostnames mapped to loopback only in this browser.

## Smoke and privacy

- Production build and 28 automated package, policy and OCR-result checks pass.
- All 20 real browser cases pass. Captured page/console errors and unexpected external HTTP(S) requests: zero.
- English and Indonesian inline OCR pass with the browser offline. No translation weights are loaded by these tests.
- Every case ends with zero staged image records. Cancellation during OCR closes the offscreen host; forced background-target termination recovers and accepts a new read.
- Existing WebGPU compute and English/Indonesian diagnostic OCR smoke tests pass. Full NLLB inference was not rerun because this phase leaves translation code/assets unchanged.

## Interactions

- Trusted keyboard Enter starts OCR; page-script synthetic clicks do not.
- Language choices persist on reopening the popup and match returned OCR metadata.
- Natural-coordinate boxes, text and confidence are verified for a single English line and two Indonesian lines.
- Empty input returns `NO_TEXT_FOUND` with a retry suggestion. A real noisy-image result remains selectable with a low-confidence warning.
- Cancel releases resources and permits retry. Dismiss returns focus to Translate.
- Dynamic insertion, reinjection, same-origin/CDN access, missing-host guidance, data/blob chunks, source replacement, SVG and dimension-limit rejection pass.
- Responsive `currentSrc` changes clear completed OCR text before reading the new image.
- Reloading the unpacked extension through Chrome's development API interrupts the active read and permits controls to be enabled again without duplicates. Chrome's native Reload button is not automated.
- No auth, checkout, payment, account or destructive product flow exists in this preview.

## Layout and visual review

Rendered captures at 375×812, 768×900 and 1440×900 were visually inspected. The full result card remains inside the viewport, text wraps, and the page has no horizontal overflow. The original image remains in place. Long OCR text scrolls inside a bounded field; uncertainty/error copy fits. The popup preserves the existing 330-pixel content width and can scroll to host permission guidance.

Matching approved/committed screenshot baselines do not exist. Pixel visual regression is **INCONCLUSIVE**, rather than a claimed pass. The saved images are candidates for user review and a future baseline.

## Accessibility

Axe reports zero WCAG-tagged violations in the popup and at each tested page width. Keyboard activation, text focus, Cancel, Dismiss and focus restoration pass. Source/target selects and the read-only text field have accessible labels; statuses use live regions. The idle Translate control and popup eyebrow contrast were improved while retaining the existing palette. The reduced-motion rule disables the short opacity transition.

This does not establish full WCAG conformance. Screen-reader behavior and Chrome's native popup/permission grant-or-deny dialog still require manual verification. Host access is pre-granted only in the copied CDN fixture manifest; the missing-host case verifies no fetch and correct guidance.

## Fixture performance

Recorded fixture LCP: **56 ms**. Cumulative layout shift: **0**. No qualifying Event Timing entry was observed, so **INP is not measured**. These are controlled local fixture observations, not field performance or a latency guarantee. OCR runs in a worker; recognition latency varies with image complexity.

## Verdict

**INCONCLUSIVE for release visual regression**, because a matching approved baseline and the manual checks above are unavailable. The **Phase 3 functional exit gate passes**. This is a development preview; Phase 4 translation and Phase 5 overlays remain outstanding.

Evidence: [browser report](images-report.json), [runtime report](runtime-report.json), [design record](design-evidence.json), [narrow layout](ocr-375.png), [tablet](ocr-768.png), [desktop](ocr-1440.png), [popup](ocr-popup.png), [Indonesian](ocr-indonesian.png), [low confidence](ocr-low-confidence.png), [empty](ocr-empty.png), [loading](ocr-loading.png).
