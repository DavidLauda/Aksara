# Aksara — Product Requirements Document

**Status:** Draft for approval  
**Date:** 17 October 2026  
**Target:** Chrome Manifest V3, desktop Chrome 124+  
**Product promise:** Translate text found inside webpage images with on-device OCR and translation, without an inference server or API charges.

## 1. Product overview

Aksara adds a small **Translate** control to eligible images on a webpage. On click, it recognizes text in the image, translates the recognized text into the user's selected language, and places editable, selectable DOM text over the corresponding parts of the image. The user can reveal the original, retry, change languages, or remove the overlay at any time.

The extension runs OCR and translation inside Chrome. An optional first-use download of model weights and OCR language data is still a network transfer; after those assets are cached, inference needs no model service or API key. Page images may also require retrieval from their original website or CDN. No image pixels, recognized text, or translations are sent to Aksara servers.

### Goals

1. Translate text in ordinary webpage `<img>` elements on explicit user action.
2. Preserve reading position by placing translations near the original text regions.
3. Keep image contents and extracted text on the user's device.
4. Work across tabs without loading a separate copy of the translation model per tab.
5. Fail visibly and recoverably when image access, storage, memory, WebGPU, OCR, or translation fails.

### Initial scope and assumptions

- **MVP:** Desktop Chrome 124+, normal web pages, static `<img>` elements, one clicked image at a time per browser profile. English and Indonesian OCR packs; the initial demonstrated route is English → Indonesian. The translation model can support more languages, but the UI must show only source languages with installed and verified OCR data.
- **Later:** More OCR packs, CSS background images, complex galleries, canvas/video, image editing or inpainting, automatic page-wide translation, and advanced text layout.
- **Excluded in MVP:** Browser-internal pages, Chrome Web Store pages, protected frames where content scripts cannot run, DRM content, and inaccessible images. Aksara must not claim to translate these.
- Source language is **explicitly selected** in MVP. Language auto-detection is a later feature; NLLB's language codes do not replace OCR language identification.

## 2. Core features and user flow

### First run

1. User opens the extension popup/options, selects a target language, and sees the estimated model download and storage requirement.
2. Aksara checks WebGPU availability, the selected model variant, available storage, and installed OCR data. Download starts only after the user chooses **Download model**.
3. A progress view reports downloading, verifying, preparing, ready, and retryable failure states. An optional offline package/import path may be offered later for environments where even the initial download is undesirable.
4. Settings persist locally. Model files are cached under the extension origin; an **Erase downloaded models** action removes them.

### Translate an image

1. Content script watches eligible `<img>` elements, including images inserted later. It uses lazy observation so ordinary browsing does not trigger OCR or model loading.
2. A subtle hover/focus control appears only for images above a size threshold. Keyboard users can reach it. The control does not cover important image content while idle.
3. User clicks **Translate**. The UI shows a per-image progress indicator and optional source language choice.
4. Content script identifies the current image resource and its natural dimensions. The service worker acquires the image when permitted; inline or blob-backed images use a bounded pixel-transfer path.
5. OCR returns text, confidence, and line/word bounding boxes in natural-image coordinates. Low-confidence or empty output produces an honest message, with a way to view recognized text when useful.
6. Translation runs on short grouped text regions using the selected NLLB language codes. The content script receives text and box geometry and renders positioned text overlays. The original image remains in place.
7. User can toggle original/translated, copy translated text, change target language, retry, or dismiss. On resize, scroll, zoom, `srcset` change, or DOM movement, overlays track the displayed image or are invalidated and removed.

### UX requirements

- State labels: **Ready**, **Preparing model**, **Reading image**, **Translating**, **Done**, and specific error states.
- Overlay uses contrast-aware, semi-opaque backing rather than pretending to erase original pixels. It scales with the image; long text can wrap and may expand beyond the exact OCR box when necessary.
- Text is inserted with safe text APIs, never interpreted as HTML. Overlay controls and text have accessible labels, focus order, and screen-reader output.
- A page-level setting can disable the hover control for a site. No automatic scanning of image pixels or translation occurs before a click.

## 3. Technical architecture

### Execution contexts

```text
Webpage <img>
  ↕ DOM and image geometry
Content script (button, image reference, overlays)
  ↕ versioned Chrome JSON messages
MV3 background service worker (validation, permissions, job queue, routing,
                               model/cache state, WebGPU translation host)
  ↕ internal Chrome messages
Extension offscreen document (Tesseract.js controller)
  ↕ dedicated worker
Tesseract.js WASM OCR worker
```

**Necessary adjustment to the proposed flow:** Chrome supports WebGPU in extension service workers from Chrome 124, so the service worker is a valid *candidate* for Transformers.js inference. However, Tesseract.js normally spawns a dedicated `Worker`, and the `Worker()` constructor is unavailable inside a service worker. OCR therefore runs in an extension-owned offscreen document, which creates Tesseract's dedicated worker. The service worker remains the background entry point and returns the final result to the content script. This runtime placement must be verified in Phase 1. If NLLB loading or generation proves unreliable under service-worker lifetime limits, the same background API will route translation to a dedicated worker owned by the offscreen document. The user-facing flow and message contract stay the same. [Chrome WebGPU support](https://developer.chrome.com/docs/extensions/whats-new), [Worker constructor availability](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker), [offscreen `WORKERS` reason](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

### Build and packaged assets

- Use **Vite** with explicit entry points for content script, service worker, popup/options, and offscreen document; ensure emitted worker and WASM paths resolve inside the extension. A different bundler is acceptable only if Phase 1 shows a Vite incompatibility.
- Bundle all executable JavaScript, Tesseract worker scripts, Tesseract core WASM, and ONNX Runtime WASM within the extension. Configure extension-page CSP for `wasm-unsafe-eval` as needed. Do not fetch executable code from a CDN. [MV3 code policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), [extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [Tesseract local files](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).
- Model weights and OCR traineddata are data, not runtime code. Pin exact revisions, file names, sizes, checksums, and licenses. Download only from approved model sources after user action. Cache under the extension origin; never put model files in content-script or page-origin storage. Verify the Chrome Web Store packaging and remote-data interpretation before release.
- Request only needed permissions: `storage`, `offscreen`, content-script access on enabled sites, and image-host permission when required. A separate model-source host permission is needed if assets download from the Hugging Face Hub. Permission strategy must be tested with an unpacked build. No `cookies` permission.

### Image acquisition and security

- For HTTP(S) images, content script sends `currentSrc` plus dimensions, not image bytes. The service worker fetches only after validating the sender, scheme, user gesture/job, host permission, redirect chain, response type, content length, and pixel/decode limits. Content-script fetches remain subject to the page's same-origin rules, even when the extension has host permissions. [Chrome cross-origin request guidance](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
- Do not turn the worker into a general cross-origin fetch proxy. Reject `file:`, `chrome:`, loopback/private-network targets, unsupported schemes, suspicious redirects, oversized payloads, and non-image responses. Do not return raw fetched bytes to the page or unrelated scripts.
- For `data:` or page-created `blob:` images, attempt a same-page, origin-clean extraction and send bounded base64 chunks; a tainted canvas or inaccessible blob becomes a clear **Image cannot be read** error. Limit decoded image bytes and pixels before OCR. Never serialize a full large `Blob` in a Chrome runtime message.
- Prevent duplicate processing with image identity plus request ID. Discard late results if the page navigates, image source changes, frame closes, or user cancels.

### Model loading and memory plan

The model name **600M** describes parameters, not a single fixed 2 GB download. The current Transformers.js-compatible NLLB export has multiple encoder/decoder graphs and quantizations. For example, its `q4f16` encoder is about **612 MB** and merged decoder about **642 MB**, before tokenizer and runtime overhead. This is roughly **1.25 GB of weight files**, not a promise about total RAM or VRAM. Some variants and graph combinations are much larger. Phase 1 must validate the exact files Transformers.js loads for the chosen device and quantization. [Model files](https://huggingface.co/Xenova/nllb-200-distilled-600M/tree/main/onnx), [Transformers.js dtypes](https://huggingface.co/docs/transformers.js/en/guides/dtypes).

1. **One model host, one active translation job.** Load lazily after the user requests translation; serialize translation and OCR jobs initially. Reuse a loaded pipeline only while its context remains alive. Do not spawn a model per image or tab.
2. **Quantized default.** Try a verified WebGPU-compatible quantized variant first. Keep alternate dtype/device choices behind measured compatibility checks, not an unconditional fallback that may allocate much more memory.
3. **Preflight and budget.** Check WebGPU adapter, required features/limits, storage estimate and device capability. Browser GPU memory is not reliably knowable; therefore the UI must say **unsupported or insufficient memory** when preparation fails, rather than promise success based on a guessed threshold. Avoid redundant copies of model bytes and avoid loading all graph variants.
4. **Persistent, recoverable cache.** Use Transformers.js browser cache or a verified custom cache, keyed by pinned model revision and dtype. Verify files before marking the model ready. A partial or evicted cache returns to download-needed state. Cache availability does not mean the model remains in RAM.
5. **Service-worker lifecycle.** Chrome may terminate the service worker after idle time or long operations. Persist job metadata and model state outside global variables, report heartbeat/progress only during active work, and make all jobs idempotent. On restart, rehydrate from cached files and retry at most once where safe. Never rely on keeping the service worker alive indefinitely. If real NLLB jobs do not survive reliably, move the model host into an offscreen document's dedicated worker, with the service worker routing messages. [Chrome lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Transformers.js extension example](https://huggingface.co/blog/transformersjs-chrome-extension).
6. **Bound work.** Cap image dimensions, decoded bytes, OCR region count, source text length, and generated tokens. Release image buffers and temporary tensors after each job. Provide cancellation and a timeout that ends cleanly.
7. **No automatic heavyweight CPU fallback.** If WebGPU is unavailable, show an explicit unsupported-device state until a CPU path has been tested for acceptable memory and speed. OCR alone may remain available for diagnostics.

### Translation and overlay pipeline

- Tesseract uses installed source-language traineddata and returns line/word boxes. Group words into reading-order text blocks; omit empty and low-confidence regions according to a configurable threshold. Preserve original coordinates.
- Map the selected source and target to NLLB FLORES-style language tokens. Translate bounded sentences/blocks to preserve context while maintaining a stable box mapping. Do not send an entire large image's OCR text as one unbounded model input.
- Return translated segments with source boxes and confidence. Overlay coordinates are normalized from natural-image dimensions; content script recalculates CSS positions against the rendered image box, including `object-fit`/`object-position`. Initial support can reject display modes whose mapping is not reliable.
- Cache results for the same image content, languages, and model version within the local extension only, with a small retention policy and a clear-data control. Never log or persist raw recognized text by default.

## 4. Message-passing contract

Chrome extension messaging uses JSON serialization by default. Contracts below use JSON-safe primitives only, carry `schemaVersion: 1`, and use opaque `requestId` values to join progress and results. The service worker obtains the authoritative tab/frame/sender identity from Chrome's `sender` metadata; a content script cannot nominate another tab. Long jobs use a `runtime.Port` for progress, with the same envelope as one-shot messages. [Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

### Content script → service worker: start

```json
{
  "schemaVersion": 1,
  "type": "TRANSLATE_IMAGE",
  "requestId": "req_7f2c",
  "image": {
    "kind": "url",
    "url": "https://images.example.org/panel.png",
    "naturalWidth": 1200,
    "naturalHeight": 800
  },
  "sourceLanguage": "eng_Latn",
  "targetLanguage": "ind_Latn"
}
```

`image.kind` is `url` or `inline`. `inline` uses a separate bounded transfer: `IMAGE_CHUNK` messages with `requestId`, `index`, `total`, `mimeType`, and `base64`; the start message then references `{ "kind": "inline", "transferId": "img_42", "naturalWidth": 1200, "naturalHeight": 800 }`. The worker rejects out-of-order, duplicate, excess-size, or timed-out transfers. URLs and inline bytes are never included in progress or error telemetry.

### Service worker → content script: acknowledgement and progress

```json
{
  "schemaVersion": 1,
  "type": "JOB_ACCEPTED",
  "requestId": "req_7f2c",
  "jobId": "job_91a0"
}
```

```json
{
  "schemaVersion": 1,
  "type": "JOB_PROGRESS",
  "requestId": "req_7f2c",
  "jobId": "job_91a0",
  "stage": "ocr",
  "fraction": 0.4
}
```

Allowed `stage`: `acquire`, `model_download`, `model_prepare`, `ocr`, `translate`, `render`. `fraction` may be `null` when the library provides no trustworthy percentage. Download progress is also available to the popup/options UI by job ID; it must not expose image content.

### Service worker → content script: result or failure

```json
{
  "schemaVersion": 1,
  "type": "TRANSLATE_RESULT",
  "requestId": "req_7f2c",
  "jobId": "job_91a0",
  "imageWidth": 1200,
  "imageHeight": 800,
  "sourceLanguage": "eng_Latn",
  "targetLanguage": "ind_Latn",
  "segments": [
    {
      "segmentId": "s1",
      "box": { "x": 72, "y": 90, "width": 300, "height": 65 },
      "sourceText": "Open the door",
      "translatedText": "Buka pintunya",
      "ocrConfidence": 0.93
    }
  ]
}
```

```json
{
  "schemaVersion": 1,
  "type": "JOB_ERROR",
  "requestId": "req_7f2c",
  "jobId": "job_91a0",
  "code": "IMAGE_ACCESS_DENIED",
  "stage": "acquire",
  "retryable": false,
  "userMessage": "Aksara cannot read this image on this site."
}
```

Stable error codes include `IMAGE_ACCESS_DENIED`, `IMAGE_TOO_LARGE`, `NO_TEXT_FOUND`, `OCR_LANGUAGE_MISSING`, `MODEL_NOT_READY`, `MODEL_DOWNLOAD_FAILED`, `WEBGPU_UNAVAILABLE`, `OUT_OF_MEMORY`, `TRANSLATION_FAILED`, `JOB_TIMEOUT`, and `CANCELLED`. Unknown fields are ignored only within the same schema version; malformed, oversized, or unknown-version messages are rejected.

### Cancellation and internal routing

Content script may send `{ "schemaVersion": 1, "type": "CANCEL_JOB", "requestId": "req_7f2c", "jobId": "job_91a0" }`. Service worker relays a scoped `RUN_OCR` request to the offscreen document and accepts only `OCR_RESULT`/`OCR_ERROR` with the matching job ID. If translation moves offscreen, analogous `RUN_TRANSLATION`/`TRANSLATION_RESULT` messages use the same job ID. Internal messages are never accepted from web pages, and offscreen messages are identified by their extension sender context.

## 5. Quality, privacy, and release requirements

- **Functional acceptance:** A user can translate a supported image, see at least one correctly placed overlay, toggle the original, and dismiss it without changing the image or page content. Multiple images on a dynamic page remain independently controllable.
- **Reliability acceptance:** Cold start, cached start, worker suspension/restart, tab navigation, permission denial, malformed image, no text, and WebGPU failure all end in a resolved result or actionable error, never an endless spinner.
- **Performance targets to measure, not guarantees:** Hover UI adds no noticeable scrolling lag; no model loads before user action; cache hit avoids redownloading; one active large-model instance per profile. Measure median and worst-case time and peak memory on a defined device matrix before setting numerical release targets.
- **Privacy:** No analytics or remote inference in MVP. Disable content-bearing debug logs in release builds. Store language preferences and model/cache metadata locally; do not retain image pixels or recognized text by default. Publish a plain-language privacy statement before distribution.
- **Accessibility:** Keyboard operation, visible focus, screen-reader labels and status updates, reduced-motion behavior, and a high-contrast overlay option.
- **Security:** Validate all messages and image URLs; enforce size/time limits; render translations as text; keep remote script execution disabled. Test the extension against hostile page markup and image URLs.
- **License and release gate:** Meta's NLLB-200 distilled-600M model card lists **CC-BY-NC-4.0** and says it is a research model not released for production deployment. This can prevent a commercial Aksara release. Before publication or monetization, review intended use and either obtain appropriate rights or select a compatible replacement model. Quantizing or converting the model does not remove the upstream license. [Meta model card](https://huggingface.co/facebook/nllb-200-distilled-600M).

## 6. Implementation plan

### Phase 1 — Feasibility and extension skeleton

1. Establish Vite/TypeScript MV3 build, service worker, content script, popup, and offscreen document entry points.
2. Verify Chrome 124+ WebGPU access from the service worker and record adapter limits on a small device matrix.
3. Verify local-only Tesseract worker/WASM/traineddata loading from the offscreen document, including CSP and `WORKERS` reason.
4. Test one pinned NLLB ONNX variant with Transformers.js using representative language pairs. Record exact graph files, download bytes, cold/warm load time, memory, WebGPU operator compatibility, and worker-suspension behavior. Test the offscreen-host fallback if needed.
5. Decide the releaseable runtime topology, model variant, cache method, minimum hardware recommendation, and any impossible combinations. **Exit gate:** one image OCR result and one short local NLLB translation succeed in an unpacked extension without an external inference API.

### Phase 2 — Image detection and acquisition

Implement eligible-image detection, hover/focus button, `currentSrc` handling, host-permission UX, bounded URL/inline image acquisition, cancellation, and explicit image-access errors. **Exit gate:** image bytes reach the background OCR context on representative same-origin, CDN, `data:`, and permitted blob cases.

### Phase 3 — OCR and language controls

Package starter OCR languages, return natural-coordinate boxes and confidence, add source/target settings and language-code mapping, and handle empty/low-confidence text. **Exit gate:** repeatable OCR with boxes for the supported starter languages.

### Phase 4 — Local translation and model management

Implement first-use download consent, pinned asset verification, local cache, WebGPU inference, progress, one-job queue, retry/recovery, and out-of-memory handling. **Exit gate:** cold and cached translations succeed; offline translation works after assets have been cached.

### Phase 5 — Overlay and polish

Render responsive translated segments, original/translated toggle, copy/dismiss/retry controls, accessibility, resize and navigation invalidation, and per-site enablement. **Exit gate:** overlays stay aligned on the supported layout matrix and never insert translation as HTML.

### Phase 6 — Hardening and release decision

Test hostile URLs, large images, image redirects, CSP-heavy sites, dynamic DOM, multiple tabs, storage eviction, worker restarts, offline mode, and low-memory/WebGPU failure. Measure performance. Review licensing, Chrome Web Store policy, permissions, and privacy copy. **Exit gate:** documented device/support matrix and a release decision; no commercial NLLB launch without resolved rights.

## 7. Decisions requested at implementation kickoff

Phase 1 should validate these working assumptions: Vite as bundler; English/Indonesian OCR starter packs; English → Indonesian demonstration; first-use model download with fully local inference afterward; and a service-worker translation host only if the measured NLLB path is reliable, otherwise an offscreen dedicated-worker host. These assumptions can be changed from Phase 1 findings without changing the product's privacy promise or the external message contract.

**Do you approve beginning Phase 1 of the implementation?**
