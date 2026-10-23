# Phase 1 — Feasibility findings

Date: 17 October 2026. The core Phase 1 gate passed: an unpacked MV3 extension recognized text in a locally generated image and translated that OCR output using actual NLLB weights in Chrome, with no inference service.

## What was built

- Vite/TypeScript MV3 project with service-worker, content-script, popup, options, offscreen-document, and dedicated-worker entry points.
- A setup/diagnostics page for WebGPU compute checks, local English/Indonesian OCR, model download, sample translation, end-to-end OCR → translation, model release, and report export.
- A pinned model manifest, streaming SHA-256 validation, resumable 16 MiB downloads, and an extension-origin cache that serves weight chunks directly to Transformers.js.
- Versioned JSON messages, a single active diagnostic job, progress updates, a bounded active-job heartbeat, timeout handling, and recovery after service-worker interruption.
- Real Chromium extension tests and package integrity checks. No OCR or inference mocks were used.

## Runtime decisions

| Component | Decision | Reason |
| --- | --- | --- |
| Build | Vite 8.3.4, TypeScript | Explicit extension entry points and local WASM assets |
| OCR | Tesseract.js 7.0.0, offscreen document → dedicated worker | Service workers cannot construct Tesseract's dedicated worker |
| Translation | Transformers.js 4.3.1, NLLB-200 distilled-600M, WebGPU | Validated locally in both background runtime layouts |
| Model variant | q8 | q4f16 encountered allocation failure and later produced empty output; q8 produced the expected translations |
| Primary host | Service worker, as proposed | q8 now passes the requested background-hosted path |
| Alternate host | Offscreen dedicated worker | Can be terminated to reclaim its ONNX WASM heap; useful for longer jobs and explicit resource release |
| Model cache | Verified chunks in Cache Storage | Monolithic downloads were interrupted; concatenating cache entries into another large cache entry also failed. Direct chunk-backed responses completed successfully |

All model files are pinned to revision `261c31d1a5732c67cdd16d80e8d6088507c7ccea`. The q8 asset set totals **911,962,632 bytes**: approximately 419 MB encoder, 476 MB decoder, and 17 MB tokenizer plus small configuration files. A name such as “600M” or “2 GB model” is not a runtime memory budget.

Executable code stays inside the extension package. ONNX Runtime's JavaScript factory is embedded in the bundle, and its WASM binary resolves locally. Service-worker imports are static: Chrome does not support dynamic `import()` there. Transformers.js v4's initial pipeline file discovery did not forward the requested model revision, so Aksara fixes the entire model URL template to the pinned revision and serves only approved manifest entries.

The image-translation message contract in the PRD is for subsequent phases. Phase 1 exposes a smaller extension-only diagnostic API: `START_JOB`, `GET_JOB`, progress events, and internal offscreen OCR/inference requests. Webpage contexts cannot start diagnostic inference jobs.

## Validation results

The recorded machine has a Ryzen 5 5600H, approximately 16 GB RAM, and an AMD GCN 5 WebGPU adapter. Tests used **Chromium 156**, headlessly, with the real GPU and no flag to force or emulate WebGPU support. The test profile is isolated from the user's regular Chrome profile.

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| Local packaged asset checksums and MV3 entry points | Passed |
| WebGPU shader dispatch and readback | Returned `42` in both service worker and offscreen dedicated worker |
| English OCR | `Open the door.` with approximately 95% confidence and a line box |
| Indonesian OCR | `Buka pintunya.` with approximately 95% confidence and a line box |
| OCR → NLLB, service worker | `Open the door.` → `Buka pintunya.` |
| OCR → NLLB, offscreen worker | Same correct result |
| Reused model instance | Translation completed without reloading or downloading weights |
| Offline cold model load and translation | Passed after assets were cached; zero model download bytes |
| Forced service-worker termination during inference | Reported `INTERRUPTED`, closed the orphaned worker, and accepted a successful OCR retry |
| Network requests during cached full test | Zero recorded remote requests |

Representative-pair checks additionally cover Indonesian → English and English → French. The raw evidence report contains the exact outputs and timings. These short samples validate the runtime and language-token wiring; they do not establish translation accuracy across NLLB's language coverage.

On the recorded run, a cached cold service-worker pipeline took about **15 seconds**, including about **5 seconds** to load and **10 seconds** to generate the short phrase. A warm translation took about **8 seconds**. An offscreen cold pipeline took about **16 seconds**. These are measurements on one machine and one small input, not latency guarantees.

Aggregate isolated-browser process memory peaked around **7.1 GiB private committed memory** and **8.9 GiB resident working set** during the cross-host test suite. This includes both host experiments and retained runtime heaps; it is not a single-model allocation measurement. It excludes dedicated GPU VRAM, and summed working sets can count shared pages more than once. This finding rules out advertising a 2 GB RAM requirement. Only the 16 GB test machine is verified so far.

## Limits and next steps

1. Phase 2 adds real webpage image detection and acquisition. The current build exercises the inference plumbing with generated samples and offers a content-script connection check.
2. The minimum Chrome version is declared as 124, but Chrome 124 and other GPU vendors have not been tested. Device memory and GPU capability checks need a broader matrix before a public compatibility claim.
3. Service-worker disposal releases model resources, but its WASM heap may remain allocated until the context is terminated. Offscreen workers are terminated on release to reclaim that heap. The production memory policy belongs in Phase 4.
4. Download errors preserve completed chunks. Files are marked ready only after full SHA-256 validation. The final loader still needs contiguous weight buffers for ONNX; chunked downloading cannot remove every runtime allocation.
5. Automatic source-language detection, arbitrary user images, page overlays, quality evaluation, and general language settings remain in their planned phases.
6. NLLB's noncommercial research terms remain a release constraint. See the [Meta model card](https://huggingface.co/facebook/nllb-200-distilled-600M) before distributing a commercial product.

Reproduce with the commands in [README.md](../README.md). Machine-readable evidence is saved under `docs/evidence/`; fresh test reports and screenshots are generated under `test-results/`.
