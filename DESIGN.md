# Aksara overlay design audit — 0.7.0

Scope: the injected image controls. Popup and Setup retain their existing layout. This is a local visual audit, using the user's screenshot and the 0.6.1 evidence in `docs/evidence/region-ocr-fix`, followed by rendered review of the actual extension. Scores are design judgments out of ten, not accessibility certification or user research.

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
