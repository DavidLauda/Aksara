# Aksara overlay design audit — 0.7.0

Scope of the 0.7.0 audit: the injected image controls. The popup follow-up is recorded below. This is a local visual audit, using the user's screenshot and the 0.6.1 evidence in `docs/evidence/region-ocr-fix`, followed by rendered review of the actual extension. Scores are design judgments out of ten, not accessibility certification or user research.

The user's job is to read a comic without losing the artwork. The old 280 px result card occupied a large part of a neighboring panel. Its language status, six actions, generic warning and expandable text competed with the translation. The replacement keeps one 44 px row in the image's corner. Original is the labeled primary action after translation; familiar Copy, More and Close icons retain accessible names and native titles. More holds retry and contrast. Read appears only when a full-text fallback is useful. An actual partial result is marked Partial; a low OCR confidence score alone no longer expands a warning.

The surface uses Aksara's existing dark green ink, neutral pale background and amber focus. A hairline highlight, slight translucency and soft shadow supply the requested glass appearance. Only the active toolbar uses backdrop blur, capped at 10 px. Menus/readers have nearly solid surfaces; translated text keeps its opaque backing. No custom fonts, decorative animation, image-sized filter, canvas shader or new UI package is introduced. System fonts suit a small tool that must coexist with arbitrary pages. This is deliberately local glass on the control surface, rather than a glass card around the content.

Tokens live in `design-tokens.json`, with color custom properties emitted by `src/image-controls.ts:4`. Native buttons and textareas, 36 px targets, explicit labels, focus outlines, Escape/outside dismissal and reduced motion/transparency/forced-color fallbacks provide the interaction foundation. An automated axe pass covers only part of accessibility; screen-reader use and native Chrome permission dialogs still need manual coverage.

| Dimension | Before → after | Observation and implementation reference |
|---|---:|---|
| Color consistency | 7 → 8 | Retained the existing green family, consolidated control colors into imported tokens (`src/image-controls.ts:4`). Supporting opaque reader and focus colors stay explicit. |
| Typography hierarchy | 6 → 8 | Removed routine metadata from the visible success state; 12 px control labels and 14 px reader text have distinct jobs (`src/image-controls.ts:7`, `src/image-controls.ts:15`). |
| Spacing rhythm | 6 → 8 | A 44 px bar with 36 px targets replaces wrapped rows and repeated margins (`src/image-controls.ts:7`). Small 2/3 px optical gaps are intentional. |
| Component consistency | 6 → 8 | One controller creates all native buttons with the same SVG and focus treatment (`src/image-controls.ts:39`). |
| Responsive behavior | 7 → 8 | Compact labels, viewport clamping and independent menu positioning cover narrow and zoomed layouts (`src/content.ts:145`, `src/image-controls.ts:164`). |
| Dark pages | 6 → 8 | Neutral light surfaces preserve contrast over dark/busy hosts; this is not an extension-wide dark theme (`src/image-controls.ts:7`, `src/image-controls.ts:13`). |
| Animation | 8 → 9 | Only the progress spinner moves. Reduced motion disables it; no decorative transitions (`src/image-controls.ts:12`, `src/image-controls.ts:22`). |
| Accessibility | 6 → 8 | Named native controls, connected disclosures, keyboard menus and visible focus (`src/image-controls.ts:9`, `src/image-controls.ts:108`). Remaining manual checks prevent a higher score. |
| Information density | 3 → 9 | Four controls in the normal success state; no permanent card, confidence warning or Text details (`src/image-controls.ts:138`). |
| Polish and recovery | 6 → 8 | Brief copy confirmation, selectable blocked-copy fallback, cancel/retry and a fixed Setup destination (`src/image-controls.ts:126`, `src/content.ts:92`, `src/background.ts:176`). |

The evidence contract is `docs/OVERLAY_UI.md`; rendered captures and measured checks are under `docs/evidence/glass-ui`. Screenshot comparison remains inconclusive until a matching baseline is approved. Local fixture timing cannot establish universal GPU performance or field Core Web Vitals. No public release decision is changed by this visual redesign.

## Popup and translation surfaces — 0.7.1

The next user screenshots exposed two gaps: text backings still looked square, and the native popup collapsed into a scrolling column. A real Chrome action view reproduced a 146 px width and an 873 px document. An explicit document width replaces the viewport-dependent width constraint; the normal popup now measures 360×448 px with no overflow. The primary action, language choices and settings all fit together. From/To selects, a site switch, a short ready/setup row and Privacy replace the repeated descriptive copy. Errors remain visible; routine saved messages are announced without adding rows.

`src/popup.css` is a dedicated entry, so generic Setup styles cannot constrain this window. `src/popup.ts` imports the same color/radius tokens as the toolbar. `src/image-overlay.ts` uses the 16 px panel corner token and 8 px horizontal padding; its backing stays opaque and has no blur. Chrome's popup is a separate document, so its glass appearance comes from static tint, highlights and rounded edges inside the window. It cannot blur the webpage behind Chrome's popup window. This avoids a whole-window filter and repeated text-region filters.

| Dimension | Popup before → after | Reference |
|---|---:|---|
| Color consistency | 6 → 8 | Shared color custom properties, pale green neutral tint (`src/popup.ts`, `src/popup.css`). |
| Typography hierarchy | 4 → 8 | Compact wordmark, small Local badge, clear From/To labels; model state reduced to one row (`popup.html`). |
| Spacing rhythm | 5 → 8 | Whole-pixel line heights, 8/12/16/18/20 px spacing and 44 px primary controls (`src/popup.css`). |
| Component consistency | 4 → 8 | Shared radius family across selectors, buttons, popup shell and translated regions (`design-tokens.json`, `src/image-overlay.ts`). |
| Responsive behavior | 2 → 9 | Actual native-window sizing check; long hostnames truncate with a full-origin title (`scripts/popup-browser-smoke.mjs`). |
| Dark hosts | 6 → 8 | The same neutral light surface works over dark browser/page surroundings; an extension-wide dark theme is outside this surface. |
| Animation | 8 → 9 | Static popup styling and switch; only the existing processing spinner animates on the page. |
| Accessibility | 6 → 8 | Native selects/switch/buttons, visible focus, save-focus restoration and live status; manual screen-reader checks remain (`src/popup.ts`). |
| Information density | 3 → 9 | One page action, side-by-side languages, site access and settings; technical diagnostics stay in Setup (`popup.html`). |
| Polish and recovery | 4 → 8 | Enabled-page detection, accurate reactivation after a site disable, visible save errors, missing/partial model and host-access recovery (`src/popup.ts`, `src/model-ui.ts`). |

See `docs/POPUP_UI.md` for the contract and `docs/evidence/popup-ui` for native captures, labeled rendering fixtures and limitations.
