# Aksara

A Chrome Manifest V3 extension for private image translation using Tesseract.js and Transformers.js. **The current Phase 2 preview detects and prepares webpage images locally.** It adds a Translate control, reads supported images after a click, and confirms that their pixels reached the background OCR context. OCR and translation of clicked images, and translated text overlays, follow in the later phases of the [PRD](PRD.md).

## Build and load

Requires Node.js 22.12+ or 24 and desktop Chrome. WebGPU is needed for the translation diagnostics; image preparation itself does not load a model.

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist` folder.
3. Open an ordinary HTTP(S) webpage, open Aksara's popup, and choose **Enable image controls**.
4. Hover over a visible image or use Tab to reach **Translate**, then click it or press Enter. A successful preparation reports **Image ready** and its dimensions.
5. If an image uses a separate CDN host, Aksara may ask you to open its popup, choose **Allow image host** for the named origin, and retry Translate. Chrome handles that optional permission grant.

Enable the controls again after navigating to a new document. Tiny images, images outside the viewport, browser pages and nested frames do not receive controls. Images must be readable PNG, JPEG, GIF or WebP, at most 8 MiB and 16 megapixels, with no dimension above 8192 pixels. Redirects, non-default URL ports, private IP literals and local hostnames are rejected. See [Phase 2 scope and limits](docs/PHASE_2.md).

**Setup & diagnostics** still offers the Phase 1 sample checks: **Check WebGPU**, **Read sample image**, and **Download & test translation**. The last action explicitly starts a model download on first use. Clicking a webpage image does not start that download or translate its text yet.

`npm run dev` rebuilds on changes. Reload the unpacked extension in Chrome after rebuilding. Vite's web development server and its injected scripts are not used inside the extension.

## Local runtime

- The service worker validates messages, owns job state, and can host WebGPU translation.
- Image acquisition uses the clicked document's isolated content script as its source reference. HTTP(S) images are fetched with host access, without credentials or a page referrer. Readable `data:` and `blob:` images use bounded PNG chunks. Temporary image blobs are staged in extension-origin IndexedDB for the offscreen decoder and deleted after the job.
- An offscreen document creates the packaged Tesseract WASM worker. English and Indonesian OCR data ship locally.
- The diagnostics page also offers an offscreen dedicated translation worker. It can be terminated to reclaim the ONNX runtime heap.
- NLLB is pinned to `Xenova/nllb-200-distilled-600M` at revision `261c31d1a5732c67cdd16d80e8d6088507c7ccea`. The selected **q8** files total **911,962,632 bytes**. The larger q4f16 candidate returned empty text in testing and is not the default.
- Large files download in resumable 16 MiB ranges. Completed files are SHA-256 verified against the committed [model manifest](src/model-manifest.json). The extension cache serves those chunks directly to Transformers.js; model bytes are never put in `chrome.storage` or sent through runtime messages.
- All executable JS and WASM are bundled. Only pinned model data downloads from Hugging Face. After caching, the sample OCR/translation flow works offline. Downloads in the isolated test profile are separate from your regular Chrome extension installation.
- Image preparation and diagnostics share one workload gate. Image jobs have a 30-second acquisition deadline, cancellation and stale-source checks. Worker interruption is reported explicitly and orphaned offscreen workers are closed before another job is accepted. A ten-minute watchdog limits diagnostic-job heartbeats; idle extensions have no keepalive.

## Verify

```powershell
npm run build
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.browser"
npx playwright install chromium --no-shell
npm run test:images
npm run test:browser
npm run test:model
```

`test:images` runs real Chromium image fixtures, including same-origin/CDN acquisition, missing-host guidance, inline transfers, trusted input, cancellation, source changes and temporary-storage cleanup. It binds a local fixture server to port 80, uses a copied extension with test-only host grants and browser DNS overrides, and uses `.test-profile-images`. The actual Chrome host-permission grant dialog is not automated; test that interaction manually in the unpacked extension.

`test:browser` checks real WebGPU compute, both OCR languages, JSON messaging, and the unpacked extension. `test:model` additionally downloads missing model files, tests both inference hosts, checks warm/offline inference, and forces a service-worker restart. These use an isolated `.test-profile-current` directory and do not touch your normal Chrome profile. The test-only `--enable-unsafe-extension-debugging` flag permits loading the current unpacked build through Chromium's development API.

Reports and screenshots are written to `test-results/`. Image tests do not download model weights. OCR and model diagnostics use actual OCR/NLLB, with no inference mocks or external translation API. See [Phase 2 findings](docs/PHASE_2.md) and the historical [Phase 1 findings](docs/PHASE_1.md) for results and remaining limits.

The manifest's minimum version is Chrome 124; validation here uses Chromium 156 on one Windows/AMD machine. Older Chrome versions and other GPU vendors still need device coverage. Download size is not runtime memory usage.

## Model licensing

NLLB weights use CC-BY-NC-4.0. Meta describes the model as intended for research. Resolve model rights and intended use before commercial distribution. The extension does not change that license by converting, caching, or quantizing the model. Dependency notices are packaged under `dist/licenses`; review distribution notices again before release.
