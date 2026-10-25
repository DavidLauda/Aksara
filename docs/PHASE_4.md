# Phase 4 — Local translation and model management

Date: 25 October 2026. Version: 0.4.0.

## Design contract

The existing popup, setup page and image card remain the product surfaces. Users first choose source/target languages, explicitly prepare the local model, then read translated text on a page. The quiet green controls, warm neutral surfaces, compact type and gold focus ring are the local visual reference. Setup prioritizes model readiness and a clearly labeled 912 MB download; diagnostics sit below. The popup prioritizes language settings and page activation. The image card puts translation before recognized text, with readable labels and a shared Dismiss/Cancel control.

Targets: page/setup widths 375, 768 and 1440 pixels; popup width 330 pixels. Text areas are read-only, selectable, bounded and scrollable. Output uses textContent/value, never interpreted HTML. The existing source-change invalidation, keyboard focus, reduced-motion support and viewport clamping remain.

| State | Visible result and next action |
| --- | --- |
| Loading | Download/verification/model-load/translation stage and available percentage; Cancel for cancellable work |
| Empty | No model downloaded; explicit download button. No image text retains the existing OCR guidance. |
| Permission | Setup explains the provider, size and local processing before the download button; existing named image-host grant remains separate. |
| Partial | Incomplete cached download offers Resume. Translation budget/uncertain OCR retains available text and labels its limitations. |
| Error | Actionable storage, integrity, network, WebGPU, memory, interruption or timeout message; explicit retry/repair |
| Success | Model ready/verified or translated text, with source/target labels and Dismiss |

## Architecture and memory

The MV3 service worker is the coordinator. Page inference uses an offscreen document's dedicated module worker, the fallback allowed by the PRD. Phase 1 established that inference works in the service worker, but terminating a dedicated worker gives cancellation a reliable realm-level boundary for both WASM heaps and GPU sessions. The diagnostic host selector preserves both paths. Offscreen workers are supported by Chrome's [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen); offscreen messages also participate in the [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

One workload is admitted at a time across all tabs, diagnostics and model management. Further requests return BUSY with retry guidance; no image/text backlog is retained. Tesseract, the bitmap, canvas backing store and staged image Blob are released before translation begins. The dedicated translator stays warm for at most 60 seconds idle. Cancel closes the host and retains the workload lock until its promise settles. A background restart with active-image metadata closes the orphaned host. Switching to service-worker diagnostics unconditionally unloads any offscreen translator, including one left warm across a service-worker restart.

The pinned q8 asset set is **911,962,632 bytes**, using `Xenova/nllb-200-distilled-600M` revision `261c31d1a5732c67cdd16d80e8d6088507c7ccea`. q8 is explicit; no automatic higher-precision fallback occurs. Transformers.js documents separate [dtype selection](https://huggingface.co/docs/transformers.js/main/en/guides/dtypes) and WebGPU execution. All JS/WASM remains bundled. Only model data may download, from the pinned manifest, after explicit setup consent.

Large weights remain 16 MiB CacheStorage parts plus a small verified virtual-file marker. SHA-256 verification streams their concatenation and does not allocate another model-sized buffer. ORT still needs full graph/runtime allocations during model load: download size is not a RAM/VRAM ceiling. Phase 1's isolated-browser aggregate reached approximately 7.1 GiB private commit on the tested 16 GB machine; that historical figure includes multiple processes/contexts and is not a new Phase 4 peak measurement or a minimum hardware guarantee. Browser APIs cannot reliably predict available GPU memory. Capability checks precede download/load, graph memory arenas are disabled, only one model runs, source/generation lengths are bounded, and allocation/device-loss errors terminate the worker and offer a retry with lighter device load.

## Model lifecycle

- GET_MODEL_STATUS reads structural cache metadata without network access or even creating a cache. `ready` means all expected markers/chunks are present; explicit verification and cold loads check actual SHA bytes.
- START_MODEL_DOWNLOAD requires `consent: true` and an authenticated extension UI sender. Opening Setup, activating page controls, clicking Translate or running diagnostic translation never downloads model data.
- Downloads reserve estimated disk room for missing bytes plus bounded overhead. The GPU preflight has a 15-second overall deadline, accepts cancellation and destroys devices that arrive after cancellation. Each fetch/body has a 60-second deadline and at most one retry. Cancellation preserves completed parts. A 30-minute overall preparation deadline prevents indefinite jobs.
- Every completed file is SHA verified. Reused files are verified during resume, and every cold inference load verifies the full pinned set. Corruption removes the affected file and its parts; another explicit Download repairs it. Missing/evicted parts require explicit resume.
- Verify reads local assets only. Remove terminates inference and deletes only the selected pinned model cache. It does not erase unrelated extension/browser data. Removal is atomic and cannot be cancelled once started.
- Only lifecycle/progress metadata is saved in session storage. Restarted preparation reports INTERRUPTED; it never resumes networking automatically. Source/target preferences remain local. Page pixels, recognized text and translated text are not stored as application history.

## Translation policy

Source languages remain English and Indonesian with bundled Tesseract data; targets are Indonesian, English and French. Settings are captured at job start. Same-language selection returns the original recognized text with an explicit label and needs no weights/GPU.

OCR lines retain their segment IDs, natural-coordinate boxes and uncertainty flags. Lines are translated sequentially, splitting at whitespace where possible into at most 240 Unicode code points per chunk. Limits are 2,400 source code points, 24 chunks, 128 input tokens and 128 generated tokens per chunk, with one beam. Oversized lines/token sequences and outputs near the generation ceiling are omitted and counted; available lines return `partial: true`. With no usable line box, bounded full OCR text can be translated without inventing coordinates. The card continues to show all retained OCR text for comparison.

Acquisition retains its 30-second deadline; OCR has 90 seconds; model loading/translation has 240 seconds; the content script bounds the overall request at 380 seconds. Runtime errors preserve OCR text where available. Closing/navigating the page or replacing the image cancels the work and invalidates its result. Source text visible in the webpage DOM remains visible to that website's scripts.

## Message contracts

Existing schema version 1, authenticated image port, chunk upload, owner snapshot, cancellation and worker-instance checks remain. Content scripts cannot call the model-management UI API. Model bytes never cross runtime JSON.

Extension UI → background:

```json
{"schemaVersion":1,"target":"background","type":"START_MODEL_DOWNLOAD","consent":true}
```

The other types are `GET_MODEL_STATUS`, `VERIFY_MODEL`, `DELETE_MODEL` and `CANCEL_MODEL_JOB`. Mutating starts return `{ "ok": true, "jobId": "opaque-id" }` or `{ "ok": false, "error": "CODE: guidance" }`. Status returns `{ok, model, job}`; `model` includes `ready`, `cachedBytes`, `totalBytes`, `missingBytes`, `revision`, `modelId`, `dtype` and `cache`. No pixel or OCR content is included.

Background → extension UI:

```json
{"schemaVersion":1,"target":"model-ui","type":"MODEL_UPDATED","job":{"id":"opaque-id","operation":"START_MODEL_DOWNLOAD","state":"running","progress":{"stage":"model_download","fraction":0.5,"loadedBytes":455981316,"totalBytes":911962632},"startedAt":1792930000000}}
```

States are `running`, `done`, `error` or `cancelled`. Error text is bounded operational guidance. The UI polls while running to recover missed messages and refresh stored-byte counts.

After `READ_IMAGE`, background sends its trusted OCR result to the offscreen host with `{schemaVersion:1,target:'offscreen',type:'TRANSLATE_IMAGE',jobId,ocr}`. The dedicated worker receives structured-cloned bounded text/boxes, not the image. `IMAGE_PROGRESS` adds `model_prepare`, `model_verify` and `translate` with a nullable fraction. `IMAGE_READY.image` retains image metadata/`ocr`, adding either `translation` or `translationError`:

```json
{"translation":{"text":"Buka pintunya.","sourceLanguage":"eng_Latn","targetLanguage":"ind_Latn","segments":[{"segmentId":"s1","sourceText":"Open the door.","translatedText":"Buka pintunya.","box":{"x":56,"y":130,"width":421,"height":58},"lowConfidence":false}],"partial":false,"skippedSegments":0,"sameLanguage":false,"cold":true,"elapsedMs":14000,"model":"Xenova/nllb-200-distilled-600M"}}
```

The example timing/box are illustrative. Missing model returns `translationError: {code:'MODEL_NOT_READY', userMessage:'…Setup…'}` while preserving OCR. Other operational codes include WEBGPU_UNAVAILABLE, MODEL_MEMORY_ERROR, TRANSLATION_LIMIT and TRANSLATION_FAILED. Background deadlines/interruption continue to use IMAGE_ERROR. Source strings and runtime stacks are excluded from operational error messages.

## Validation and limits

Results are recorded in [Phase 4 evidence](evidence/phase-4/QA.md). Unit tests exercise cache cancellation/resume, timeouts/retry, malformed ranges, checksums/corruption repair, quota handling, offline cache-only access and scoped deletion with small deterministic files. Translation-policy tests cover Unicode boundaries, whole-line budgets, stable boxes, partial flags and sanitized errors. Browser tests use actual bundled OCR and NLLB/WebGPU without inference stubs.

The build and **53 automated tests pass**. Real browser checks passed cold/warm English → Indonesian, Indonesian → English, English → French, cold offline inference, matching line boxes, initialization cancellation/retry, one-job rejection, actual background termination/recovery and host switching after idle background restart. Two-line OCR translated to “Buka pintunya.” and “Selamat pagi.” with separate retained boxes. First-use checks passed without model network requests, including rejection of download requests from content scripts. Setup, popup and translated cards pass the scoped axe/viewport checks after fixing the setup footer's contrast; the initial failed contrast run is preserved as historical evidence, with a passing targeted rerun.

On this machine, the initial full-cache verification took 13.2 seconds; a cold page translation took 29.2 seconds end to end, warm translation 10.4 seconds, and cold offline translation 27.2 seconds. These are small fixture measurements, not general translation benchmarks. Page model verification/inference made zero remote requests. A separate fresh-profile test clicked the actual Download control, cancelled after 34,113,594 bytes were stored, resumed from the next missing 16 MiB range to 50,890,810 bytes, then removed the partial cache to zero. All remote requests in that explicit probe were Hugging Face model GETs with no request body; it intentionally did not download the complete model again.

Aligned text replacement, inpainting, original/translated toggles and per-site preferences remain Phase 5. Chrome 124 is the declared minimum; automated validation is on Chromium 156/Windows/one AMD device. Actual GPU memory exhaustion was not induced; bounded probe failure/late-device cleanup and error classification have deterministic tests, and hard worker cancellation is browser-verified. Native Chrome permission/action-popup interaction and assistive-technology testing remain manual. No approved screenshot baseline exists for pixel regression. Licensing still restricts NLLB to CC-BY-NC-4.0; this phase is not a commercial release approval.
