# Aksara

A Chrome Manifest V3 extension for private image translation using Tesseract.js and Transformers.js. **Version 0.7.1 is a research preview**, with a compact glass toolbar, local translations over matching image text, bounded OCR recovery and a packaged privacy notice. Sources are English and Indonesian; targets are Indonesian, English and French. The original image stays in place, with selectable DOM text on an opaque backing. See the [PRD](PRD.md), [toolbar design](docs/OVERLAY_UI.md), [popup and rounded text surfaces](docs/POPUP_UI.md), [OCR/context fix](docs/REGION_OCR_FIX.md), [hardening and release decision](docs/PHASE_6.md) and [overlay details](docs/PHASE_5.md).

## Build and load

Requires Node.js 22.12+ or 24 and desktop Chrome. Translation needs WebGPU and sufficient available RAM/GPU memory; OCR and same-language reads do not require model weights.

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist` folder.
3. Open Aksara → **Set up** (or **Settings**). Choose **Download 912 MB on this device** to explicitly allow the pinned model download. Progress, cancellation, resume, checksum verification and removal are available there. This installation is separate from the automated test profile.
4. Open an ordinary HTTP(S) webpage and open Aksara's popup. Choose **From** (English or Indonesian) and **To** (Indonesian, English or French), then **Enable translation**.
5. Hover over an image or use Tab to reach **Translate**, then click it or press Enter. Translations appear over the recognized regions. A small toolbar offers **Original**, **Copy**, **More** and **Close**. More contains **Translate again** and **High contrast**; Escape or clicking outside closes it. Close removes the result and restores focus to Translate. During processing, the close icon cancels work. Without a model, **Read text** preserves recognized text and **Open setup** opens model settings; it never starts a download.
6. If an image uses a separate CDN host, Aksara may ask you to open its popup, choose **Allow image host** for the named origin, and retry Translate. Chrome handles that optional permission grant.

Enable the controls again after navigating to a new document. Tiny images, images outside the viewport, browser pages and nested frames do not receive controls. Images must be readable PNG, JPEG, GIF or WebP, at most 8 MiB and 16 megapixels, with no dimension above 8192 pixels. Redirects, non-default URL ports, private IP literals and local hostnames are rejected. Confidence stays in OCR metadata; blank images suggest checking the source language or choosing a clearer image. See [Phase 3 details](docs/PHASE_3.md) and the historical [acquisition policy](docs/PHASE_2.md).

The popup's **Allow on this site** remembers an exact origin. Turning it off cancels current work and clears results on that origin's open pages. Turning it on permits manual activation with **Enable translation**; it does not scan pixels or translate automatically. High contrast is saved separately. Ordinary rectangular images support `fill`, `contain`, `cover`, `none` and `scale-down`, noncenter positioning, padding/borders, scrolling and positive scaling. Rotated, rounded or masked layouts show a selectable reader instead. Cropped or overflowing text offers **Read** for the full translation; skipped text is marked **Partial**. Blocked clipboard access also opens selectable text. The old Text details panel and generic confidence warning are removed from the reading view.

Version 0.5.1 preserves context across wrapped OCR lines. Nearby lines in the same OCR paragraph become one translation region and one wrapped overlay. For example, `We got this / mysterious / package.` is sent as `We got this mysterious package.` instead of three independent phrases. Explicit paragraph/block boundaries and geometry keep separate bubbles apart. Source line IDs and coordinates remain in the processing result. This is conservative text grouping, not visual scene understanding; recognition errors and model limitations can still affect results. See [the context fix](docs/TEXT_CONTEXT_FIX.md).

Version 0.6.1 adds enclosed light-region hints for nearby unfinished sentences that OCR splits across paragraphs/blocks. Different regions and complete independent paragraphs remain separate. If automatic and sparse OCR both find no text, up to four masked region crops can be retried within the existing deadline and pixel budgets. Original source coordinates and full text remain available. The starter corpus's wrapped parcel sentence now stays together, and its previously missed `We got this!` bubble can be read. Open, dark, touching or oversized bubbles may still be missed. See [implementation and measured limits](docs/REGION_OCR_FIX.md).

**Setup & diagnostics** also offers WebGPU, sample OCR and cached translation checks. Diagnostics cannot start model downloads. Same-language results are labeled and need no translation model. Long images are bounded to 2,400 source characters and 24 sequential chunks; skipped lines or OCR truncation are explicitly marked as partial. See [Phase 4 details](docs/PHASE_4.md).

`npm run dev` rebuilds on changes. Reload the unpacked extension in Chrome after rebuilding, then refresh open webpages before enabling controls again when upgrading from an older preview. Vite's web development server and its injected scripts are not used inside the extension.

## Local runtime

- The service worker validates messages, owns the single-job admission gate, and manages explicit model downloads. Busy requests get a retry message rather than creating an unbounded backlog.
- Image acquisition uses the clicked document's isolated content script as its source reference. HTTP(S) images are fetched with host access, without credentials or a page referrer. Readable `data:` and `blob:` images use bounded PNG chunks. Temporary image blobs are staged in extension-origin IndexedDB for the offscreen decoder and deleted after the job.
- An offscreen document normalizes the decoded still image and creates the packaged Tesseract WASM worker. English and Indonesian OCR data ship locally. Each job terminates its OCR worker; recognized text is not saved to extension storage. Language preferences stay in `chrome.storage.local`.
- The classic content script bundles its geometry helpers into a single IIFE. Each image gets a disposable, clipped overlay using OCR coordinates and CSS image sizing. Scroll/resize events update immediately; an 80 ms timer tracks other movement only while a result or request is visible. Source replacement, page navigation, site disable and Dismiss clear results. Page hiding for navigation clears all retained results; text is never used as HTML.
- Glass is limited to the active 44 px toolbar, with a 10 px CSS blur. Other controls, menus, readers and translated text use opaque or nearly opaque backgrounds. High contrast, forced colors and reduced transparency turn blur off. The redesign adds no UI dependency or remote assets; identical control states skip DOM rendering. This bounds the effect's cost but does not establish performance on every GPU.
- Page translation uses a dedicated worker inside the offscreen document. OCR is released before inference. Cancellation terminates the host; a warm translation worker terminates after 60 seconds idle to reclaim its WASM heap and GPU sessions. Service-worker inference remains available as a diagnostic path, with host switching that prevents duplicate model instances.
- NLLB is pinned to `Xenova/nllb-200-distilled-600M` at revision `261c31d1a5732c67cdd16d80e8d6088507c7ccea`. The selected **q8** files total **911,962,632 bytes**. The larger q4f16 candidate returned empty text in testing and is not the default.
- Large files download in resumable 16 MiB ranges, with a 60-second deadline and one retry per request. Completed files and every cold inference load are SHA-256 verified against the committed [model manifest](src/model-manifest.json). Corrupt assets are removed for explicit repair. The cache serves a virtual concatenation of chunks; model bytes never enter `chrome.storage` or runtime JSON messages. Runtime memory can substantially exceed the download size.
- All executable JS and WASM are bundled. Only pinned model data downloads from Hugging Face after explicit consent. After caching, translation works offline for available image pixels. URL-based image acquisition still needs its image server. Text visible in the webpage DOM can also be read by that page's scripts; local processing does not isolate the result from its host website.
- Image reading, translation, diagnostics and model management share one workload gate. Deadlines: acquisition 30 seconds, OCR 90 seconds, translation 240 seconds, overall page request 380 seconds, diagnostics 10 minutes, model preparation 30 minutes. Orphaned image workers are reclaimed after a background restart. Model downloads resume complete chunks. Only opaque lifecycle metadata and model progress are persisted; page text, translations and pixels are not.

## Verify

```powershell
npm run build
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.browser"
npx playwright install chromium --no-shell
npm run test:images
npm run test:browser
npm run test:model
npm run test:translation
npm run test:overlays
npm run test:glass
npm run test:popup
npm run test:hardening
```

`test:images` runs real Chromium image/OCR fixtures, including both languages, natural-coordinate boxes, offline inline reads, saved preferences, low-confidence metadata and empty results, cancellation, forced worker interruption, responsive source changes and temporary-storage cleanup. It also audits the popup and fallback reader with axe at 375, 768 and 1440 pixel page widths. It binds a local fixture server to port 80 and recreates its own `.test-profile-ocr` profile, using a copied extension with test-only host grants and browser DNS overrides. The actual Chrome host-permission grant dialog is not automated; test that interaction manually in the unpacked extension.

`test:browser` checks real WebGPU compute, both OCR languages, JSON messaging, and the unpacked extension. `test:model` tests both inference hosts, warm/offline inference and worker restart. To explicitly prepare missing weights for tests, use `npm run test:model -- --download-model`. `test:translation` covers real webpage OCR → NLLB, missing-model consent, same-language reads, cache verification, warm/offline translation, cancellation, restart and responsive UI. These use the isolated `.test-profile-current` directory; run them sequentially. The translation suite also recreates its own `.test-profile-translation-empty` for first-use checks. They never touch your regular Chrome profile. The test-only `--enable-unsafe-extension-debugging` flag permits unpacked loading and a real action/activeTab grant through Chromium's development API.

`npm run test:translation -- --host-switch-only` checks multi-line translation and switching inference hosts after a background restart. `npm run test:translation -- --download-probe` explicitly downloads a bounded portion of the real model in a separate disposable `.test-profile-translation-download`, exercises Setup's Cancel/Resume/Remove controls, and removes those partial model files. It does not replace the complete cached model used by inference tests. Image/translation fixture scripts share port 80 and must run sequentially.

`test:overlays` uses the supplied comic-panel regression fixtures with actual OCR → NLLB to verify a wrapped sentence becomes one request and two bubbles remain separate. It also checks the controlled cross-block sentence and recovered single-line bubble, including natural coordinates and responsive accessibility. Initial translation/Retry, geometry across fit/position/crop/scale/scroll/resize layouts, copy, original toggle, fallback reading, contrast, site disable and invalidation remain covered. Hostile/long-text and independent-image render fixtures are explicitly labeled in the report and do not claim inference quality. It shares `.test-profile-current` and port 80, so run it after other browser suites finish. It does not download model weights.

`test:glass` replays a saved real OCR/NLLB result to isolate UI rendering. It checks toolbar density, keyboard menus, copy/fallback reading, partial/error/setup states, three widths, light/dark/busy pages, zoom, accessibility and a single active blur across multiple images. It uses its disposable `.test-profile-glass`, shares port 80, makes no external requests and does not run inference. Rendering replay does not establish translation quality. Actual pipeline coverage remains in the suites above.

`test:popup` checks Chrome's actual action popup through its DevTools target, including intrinsic sizing, keyboard selection, site access, activation, focus restoration, reactivation, Setup and unsupported pages. Loading/model-state variants are separately labeled rendering fixtures. It also checks three document widths, enlarged text and opaque/forced-color fallbacks. The normal popup is 360×448 px instead of the reproduced 146 px column. Translation backings share the controls' 16 px rounded corners without adding per-text blur. This suite uses `.test-profile-popup` and port 80; run it after other page suites finish. See [the follow-up evidence](docs/evidence/popup-ui/QA.md).

`test:hardening` uses its own disposable `.test-profile-hardening` and `.test-extension-hardening` copy. It checks real Chromium CacheStorage with tiny pinned fixture files, chunk eviction/repair, checksum corruption, a low-quota preflight and a browser without a usable GPU. HTTP(S) networking is blocked in this suite. It also checks the packaged privacy page and its popup/Setup links with keyboard navigation, three viewport sizes and axe. These fixture faults do not claim physical GPU exhaustion or full-size cache stress. The image suite additionally covers strict CSP, multi-tab ownership, cross-document navigation, rejected redirects and oversized streaming bodies.

Reports and screenshots are written to `test-results/`. Image and translation page tests do not download weights. Model assertions use actual OCR/NLLB and no external translation API. Cache unit tests use tiny fixtures for failure paths; the overlay suite separately marks synthetic DOM rendering cases. See [Phase 5 findings](docs/PHASE_5.md), [Phase 4 findings](docs/PHASE_4.md), [Phase 3 findings](docs/PHASE_3.md), [Phase 2 findings](docs/PHASE_2.md) and the historical [Phase 1 findings](docs/PHASE_1.md).

The manifest's minimum version is Chrome 124; validation here uses Chromium 156 on one Windows/AMD machine. Older Chrome versions and other GPU vendors still need device coverage. Download size is not runtime memory usage.

`npm run benchmark` runs the [local speed/quality starter benchmark](benchmarks/README.md): two actual comic panels and eight controlled text layouts, each cold and warm. It records OCR/grouping errors and stage timing with a translation-review worksheet; it does not automatically grade meaning or establish representative comic accuracy. Use `-- --memory` for optional Windows process-memory sampling. Results remain under ignored `test-results/benchmark/`; no fixture or benchmark code ships in the extension.

## Model licensing

NLLB weights use CC-BY-NC-4.0. Meta describes the model as intended for research. Resolve model rights and intended use before commercial distribution. The extension does not change that license by converting, caching, or quantizing the model. Dependency notices are packaged under `dist/licenses`; review distribution notices again before release.

Open **Privacy & local data** from the popup or Setup to review local storage, image-host requests, model downloads and deletion controls. The page ships locally and makes no network requests. A public release still needs a published privacy-policy URL, completed dependency/data provenance review and a broader device/manual QA matrix. The Phase 6 decision is **DO NOT SHIP publicly or commercially**; continue local research testing. It is not a Chrome Web Store approval.
