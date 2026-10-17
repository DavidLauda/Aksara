# Aksara

A Chrome Manifest V3 extension for private image translation using Tesseract.js and Transformers.js. **Phase 1 is a feasibility build:** the setup page tests local OCR and NLLB translation. Image hover controls and webpage overlays follow in later phases of the [PRD](PRD.md).

## Build and load

Requires Node.js 22.12+ or 24 and desktop Chrome with WebGPU.

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist` folder.
3. Open Aksara's popup, then **Open setup & diagnostics**.
4. Run **Check WebGPU**, **Read sample image**, and **Download & test translation**. The latter explicitly starts a model download on first use.

Use **Connect this tab** on an ordinary website to test the Phase 1 content-script connection. It reports the number of image elements; image translation controls are not included in this phase.

`npm run dev` rebuilds on changes. Reload the unpacked extension in Chrome after rebuilding. Vite's web development server and its injected scripts are not used inside the extension.

## Local runtime

- The service worker validates messages, owns job state, and can host WebGPU translation.
- An offscreen document creates the packaged Tesseract WASM worker. English and Indonesian OCR data ship locally.
- The diagnostics page also offers an offscreen dedicated translation worker. It can be terminated to reclaim the ONNX runtime heap.
- NLLB is pinned to `Xenova/nllb-200-distilled-600M` at revision `261c31d1a5732c67cdd16d80e8d6088507c7ccea`. The selected **q8** files total **911,962,632 bytes**. The larger q4f16 candidate returned empty text in testing and is not the default.
- Large files download in resumable 16 MiB ranges. Completed files are SHA-256 verified against the committed [model manifest](src/model-manifest.json). The extension cache serves those chunks directly to Transformers.js; model bytes are never put in `chrome.storage` or sent through runtime messages.
- All executable JS and WASM are bundled. Only pinned model data downloads from Hugging Face. After caching, the sample OCR/translation flow works offline. Downloads in the isolated test profile are separate from your regular Chrome extension installation.
- One diagnostic job runs at a time. Worker interruption is reported explicitly and orphaned offscreen workers are closed before another job is accepted. A ten-minute watchdog limits active-job heartbeats; idle extensions have no keepalive.

## Verify

```powershell
npm run build
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.browser"
npx playwright install chromium --no-shell
npm run test:browser
npm run test:model
```

`test:browser` checks real WebGPU compute, both OCR languages, JSON messaging, and the unpacked extension. `test:model` additionally downloads missing model files, tests both inference hosts, checks warm/offline inference, and forces a service-worker restart. It uses an isolated `.test-profile-current` directory and does not touch your normal Chrome profile. The test-only `--enable-unsafe-extension-debugging` flag permits loading the current unpacked build through Chromium's development API.

Reports and screenshots are written to `test-results/`. The tests use actual OCR and NLLB weights, with no inference mocks or external translation API. See [Phase 1 findings](docs/PHASE_1.md) for measured results and remaining limits.

The manifest's minimum version is Chrome 124; validation here uses Chromium 156 on one Windows/AMD machine. Older Chrome versions and other GPU vendors still need device coverage. Download size is not runtime memory usage.

## Model licensing

NLLB weights use CC-BY-NC-4.0. Meta describes the model as intended for research. Resolve model rights and intended use before commercial distribution. The extension does not change that license by converting, caching, or quantizing the model. Dependency notices are packaged under `dist/licenses`; review distribution notices again before release.
