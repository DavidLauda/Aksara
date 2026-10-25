# Aksara

A Chrome Manifest V3 extension for private image translation using Tesseract.js and Transformers.js. **The Phase 4 preview recognizes English and Indonesian images and translates into Indonesian, English or French locally.** It shows selectable original and translated text beside the image. Aligned replacement text remains Phase 5 of the [PRD](PRD.md).

## Build and load

Requires Node.js 22.12+ or 24 and desktop Chrome. Translation needs WebGPU and sufficient available RAM/GPU memory; OCR and same-language reads do not require model weights.

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist` folder.
3. Open Aksara → **Setup & diagnostics**. Choose **Download 912 MB on this device** to explicitly allow the pinned model download. Progress, cancellation, resume, checksum verification and removal are available there. This installation is separate from the automated test profile.
4. Open an ordinary HTTP(S) webpage and open Aksara's popup. Choose **Text in image** (English or Indonesian) and **Translate to** (Indonesian, English or French), then **Enable image controls**.
5. Hover over an image or use Tab to reach **Translate**, then click it or press Enter. The card shows original and translated text. Cancel stops the worker; Dismiss clears the result. Without a downloaded model, the card keeps recognized text and explains how to finish setup; it never starts a download.
6. If an image uses a separate CDN host, Aksara may ask you to open its popup, choose **Allow image host** for the named origin, and retry Translate. Chrome handles that optional permission grant.

Enable the controls again after navigating to a new document. Tiny images, images outside the viewport, browser pages and nested frames do not receive controls. Images must be readable PNG, JPEG, GIF or WebP, at most 8 MiB and 16 megapixels, with no dimension above 8192 pixels. Redirects, non-default URL ports, private IP literals and local hostnames are rejected. Low-confidence results are labeled; blank images suggest checking the source language or choosing a clearer image. See [Phase 3 details](docs/PHASE_3.md) and the historical [acquisition policy](docs/PHASE_2.md).

**Setup & diagnostics** also offers WebGPU, sample OCR and cached translation checks. Diagnostics cannot start model downloads. Same-language results are labeled and need no translation model. Long images are bounded to 2,400 source characters and 24 sequential chunks; skipped lines or OCR truncation are explicitly marked as partial. See [Phase 4 details](docs/PHASE_4.md).

`npm run dev` rebuilds on changes. Reload the unpacked extension in Chrome after rebuilding, then refresh open webpages before enabling controls again when upgrading from an older preview. Vite's web development server and its injected scripts are not used inside the extension.

## Local runtime

- The service worker validates messages, owns the single-job admission gate, and manages explicit model downloads. Busy requests get a retry message rather than creating an unbounded backlog.
- Image acquisition uses the clicked document's isolated content script as its source reference. HTTP(S) images are fetched with host access, without credentials or a page referrer. Readable `data:` and `blob:` images use bounded PNG chunks. Temporary image blobs are staged in extension-origin IndexedDB for the offscreen decoder and deleted after the job.
- An offscreen document normalizes the decoded still image and creates the packaged Tesseract WASM worker. English and Indonesian OCR data ship locally. Each job terminates its OCR worker; recognized text is not saved to extension storage. Language preferences stay in `chrome.storage.local`.
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
```

`test:images` runs real Chromium image/OCR fixtures, including both languages, natural-coordinate boxes, offline inline reads, saved preferences, low-confidence and empty results, cancellation, forced worker interruption, responsive source changes and temporary-storage cleanup. It also audits the popup and result card with axe at 375, 768 and 1440 pixel page widths. It binds a local fixture server to port 80 and recreates its own `.test-profile-ocr` profile, using a copied extension with test-only host grants and browser DNS overrides. The actual Chrome host-permission grant dialog is not automated; test that interaction manually in the unpacked extension.

`test:browser` checks real WebGPU compute, both OCR languages, JSON messaging, and the unpacked extension. `test:model` tests both inference hosts, warm/offline inference and worker restart. To explicitly prepare missing weights for tests, use `npm run test:model -- --download-model`. `test:translation` covers real webpage OCR → NLLB, missing-model consent, same-language reads, cache verification, warm/offline translation, cancellation, restart and responsive UI. These use the isolated `.test-profile-current` directory; run them sequentially. The translation suite also recreates its own `.test-profile-translation-empty` for first-use checks. They never touch your regular Chrome profile. The test-only `--enable-unsafe-extension-debugging` flag permits unpacked loading and a real action/activeTab grant through Chromium's development API.

`npm run test:translation -- --host-switch-only` checks multi-line translation and switching inference hosts after a background restart. `npm run test:translation -- --download-probe` explicitly downloads a bounded portion of the real model in a separate disposable `.test-profile-translation-download`, exercises Setup's Cancel/Resume/Remove controls, and removes those partial model files. It does not replace the complete cached model used by inference tests. Image/translation fixture scripts share port 80 and must run sequentially.

Reports and screenshots are written to `test-results/`. Image and translation page tests do not download weights. Browser inference uses actual OCR/NLLB, with no inference mocks or external translation API. Cache unit tests use tiny fixtures to exercise failure paths without downloading large weights. See [Phase 4 findings](docs/PHASE_4.md), [Phase 3 findings](docs/PHASE_3.md), [Phase 2 findings](docs/PHASE_2.md) and the historical [Phase 1 findings](docs/PHASE_1.md).

The manifest's minimum version is Chrome 124; validation here uses Chromium 156 on one Windows/AMD machine. Older Chrome versions and other GPU vendors still need device coverage. Download size is not runtime memory usage.

## Model licensing

NLLB weights use CC-BY-NC-4.0. Meta describes the model as intended for research. Resolve model rights and intended use before commercial distribution. The extension does not change that license by converting, caching, or quantizing the model. Dependency notices are packaged under `dist/licenses`; review distribution notices again before release.
