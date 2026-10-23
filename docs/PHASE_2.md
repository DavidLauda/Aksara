# Phase 2 — Image detection and acquisition

Date: 23 October 2026. This preview connects real webpage images to the extension's background OCR context. Its output is a decoded image summary: dimensions, byte count, detected format, animation flag and SHA-256. It does not run OCR or translation on clicked images yet. The existing setup page retains the Phase 1 sample OCR and translation checks.

## Using the preview

Build and load `dist` using the [README instructions](../README.md). On an ordinary HTTP(S) webpage, open the popup and choose **Enable image controls**. The extension uses `activeTab` and programmatic injection; it does not install an automatic content script on every site. Enable it again on a new document.

Eligible, visible `<img>` elements receive a subtle **Translate** button. Hover makes it more visible; Tab and Enter also work. The button currently prepares the image and reports **Image ready** with its dimensions. The status card provides Cancel while reading and Dismiss afterward. A trusted click is required; a page calling the button's `.click()` cannot start acquisition.

For a separate image/CDN origin without access, the job stops with an instruction to open the popup. The popup names the origin and provides **Allow image host**. Its direct click calls Chrome's optional-permission API. After granting access, return to the image and click Translate again. Denial leaves the image unavailable; the extension does not retry automatically. A pending permission suggestion expires after five minutes. Granted host access is a Chrome extension permission and can be managed through Chrome's extension settings.

## Implementation

The content script observes image insertion, load, visibility, resize and source changes. It uses `currentSrc` for responsive images and tracks each image independently. Controls live in a shadow root without changing the original image. Re-enabling the extension disposes the previous observers, listeners and controls before installing a new instance.

The acquisition flow is:

1. A trusted button activation creates request and image identifiers in the isolated content-script world.
2. A named `aksara-images` runtime port connects to the service worker. Chrome's sender metadata identifies the tab, top-level frame and document.
3. The service worker reads a snapshot from that exact document using `chrome.scripting.executeScript`. The snapshot exists only while the clicked request is live and its image source is unchanged. A URL supplied directly in a port message is not used as the fetch target.
4. HTTP(S) resources use an extension fetch after URL and host-access checks. Readable `data:` or page `blob:` images are drawn into a bounded canvas and normalized to PNG, then transferred as acknowledged base64 chunks.
5. The service worker checks the complete raster container and dimensions before staging a Blob in extension-origin IndexedDB. It sends only a job identifier to the offscreen document.
6. The offscreen document reads the staged Blob, repeats format checks, decodes it with `createImageBitmap`, verifies decoded dimensions and computes a SHA-256 digest. The bitmap is closed and the staged Blob is deleted.
7. The service worker rechecks the image snapshot, clears temporary state and returns the summary over the originating port. Changed or cancelled requests discard late results.

Image work and diagnostic work share a workload gate across tabs. Startup recovery completes before image work proceeds. Cancellation aborts network acquisition, drops partial transfers and removes staging data. Browser bitmap decoding and hashing cannot be interrupted mid-call; if cancelled during that stage, their result is discarded and the workload remains busy until they settle. This avoids overlapping cancelled decoders with new jobs. Remaining staging records are cleared on the next service-worker startup after an interruption.

## Bounds and access policy

| Item | Current behavior |
| --- | --- |
| Eligible image | Loaded `<img>`, natural and displayed dimensions at least 120 × 60, intersecting the viewport |
| Execution scope | Top-level HTTP(S) document enabled through the popup |
| Raster formats | PNG, JPEG, GIF and WebP; signature, MIME and container checks precede decode |
| Image size | At most 8 MiB compressed/transferred, 16,000,000 pixels, and 8192 pixels per dimension |
| Inline transfer | PNG, 192 KiB binary chunks, one acknowledgement per chunk, ten-second acknowledgement wait |
| Acquisition deadline | 30 seconds after the job is created |
| Network fetch | GET, no credentials, no page referrer, no persistent HTTP cache, redirects rejected |
| Host access | Existing model-source grants; temporary page access through `activeTab`; exact image-host grants requested optionally |
| Temporary storage | Extension-origin IndexedDB; records removed on completion, failure or cancellation; startup removes interrupted records |

URL checks accept absolute HTTP(S) URLs with default ports. They reject credentials, control characters, ambiguous syntax, private/reserved IP literals, IPv4 alternate spellings that normalize to blocked ranges, unsupported IPv6 ranges, and local/reserved hostnames. URL length is bounded. Fragments are removed before fetch. Host permissions and CSP allow the extension to fetch a permitted image even when the image server does not grant the webpage CORS access.

These are lexical URL checks. A public-looking hostname can resolve to a private address, or change its DNS answer. The extension does not perform resolved-IP enforcement or guarantee protection against DNS rebinding. The browser's network policy remains a separate boundary. The fixture suite deliberately maps public-looking fixture names to loopback inside its isolated browser; those overrides are not part of the distributable extension.

Only actual response bytes count toward the streaming limit; a missing or false `Content-Length` does not bypass it. Inline transfers validate the declared byte count, exact chunk count, indexes, base64 syntax and decoded chunk lengths. Out-of-order, duplicate, incomplete or expired transfers fail. Sender and port ownership prevent one document from cancelling or completing another document's job. The webpage receives no general fetch proxy or raw fetched bytes.

## Current JSON contracts

This Phase 2 transport implements image preparation. The PRD's eventual `TRANSLATE_IMAGE`/`TRANSLATE_RESULT` contract remains planned for later phases. Messages are JSON-safe objects with `schemaVersion: 1`, a target and a request identifier. The port itself supplies the authoritative document owner; payloads cannot nominate another tab or frame.

Content → background start:

```json
{
  "schemaVersion": 1,
  "target": "background",
  "type": "PREPARE_IMAGE",
  "requestId": "request-id",
  "imageId": "image-id"
}
```

| Direction | Type | Additional fields |
| --- | --- | --- |
| Background → content | `IMAGE_PROGRESS` | `jobId`, `stage`: `acquire` or `decode` |
| Background → content | `IMAGE_UPLOAD_READY` | `jobId`, `transferId`, `chunkBytes`, `maxBytes` |
| Content → background | `IMAGE_UPLOAD_BEGIN` | `jobId`, `transferId`, `bytes`, `mimeType: "image/png"`, `chunkCount` |
| Content → background | `IMAGE_CHUNK` | `jobId`, `transferId`, zero-based `index`, `base64` |
| Background → content | `IMAGE_UPLOAD_ACK` | `index`; `-1` acknowledges upload initialization |
| Content → background | `IMAGE_UPLOAD_END` | `jobId`, `transferId` |
| Content → background | `CANCEL_IMAGE` | `jobId` when assigned; cancellation is scoped to port and `requestId` |
| Background → content | `IMAGE_ERROR` | `jobId` when assigned, `code`, `userMessage` |
| Background → content | `IMAGE_READY` | `jobId`, `image` summary |

Background messages use `target: "content"`; content messages use `target: "background"`. Every row also carries the schema version and request identifier. Common errors include `BUSY`, `PERMISSION_REQUIRED`, `SOURCE_CHANGED`, `IMAGE_ACCESS_DENIED`, `IMAGE_TOO_LARGE`, `UNSUPPORTED_IMAGE`, `IMAGE_DECODE_FAILED`, `INVALID_REQUEST`, `IMAGE_TIMEOUT` and `CANCELLED`.

An `IMAGE_READY.image` summary has this shape:

```json
{
  "width": 640,
  "height": 280,
  "byteLength": 11930,
  "mimeType": "image/png",
  "animated": false,
  "sha256": "64 hexadecimal characters",
  "context": "offscreen"
}
```

Internal inspection uses `{ "schemaVersion": 1, "target": "offscreen", "type": "INSPECT_IMAGE", "jobId": "job-id" }`. Image bytes stay in IndexedDB for this hop; runtime messaging does not serialize a full Blob. No image pixels or text are sent to a remote inference service. A webpage click does not start model loading or a model download.

## Validation and evidence

The production build passed. `npm test` passed all 21 tests, including nested codec subtests; these cover packaged runtime integrity, classic content-script output, URL policy, dimension limits and raster container checks. `npm run test:images` uses actual Chromium and an isolated profile, copied extension and HTTP fixture server. It writes `test-results/images-report.json` and screenshots for detection, permission guidance and validation.

The final run on Chromium **156.0.8078.4** passed all **12 browser cases**: detection and tiny-image exclusion without automatic acquisition; synthetic-click rejection; keyboard Enter on a same-origin image; dynamic insertion and reinjection; permitted CDN access without page CORS; missing-host guidance; `data:` and `blob:` transfers; cancellation followed by reuse; stale-source rejection; unsupported SVG; and oversized-raster rejection. The 614,103-byte blob fixture exercised multiple 192 KiB chunks. Every case finished with zero staged image records. The run recorded no uncaught page errors or unexpected model-source requests. The committed [image evidence report](evidence/phase-2-images.json) contains each result and fixture request.

The existing WebGPU/OCR browser smoke test also passed: compute returned `42` in both runtime contexts, and the packaged English and Indonesian OCR samples succeeded. Its [runtime evidence report](evidence/phase-2-runtime.json) records the machine and outputs. Full NLLB translation/model tests were not rerun during this phase; the measured translation results remain in the historical Phase 1 reports.

CDN success uses host grants added only to the copied test manifest, and the fixture server supplies no page CORS header. Missing-host coverage verifies that background fetching does not occur and that the popup names the required origin. It does not automate granting or denying Chrome's actual optional-permission dialog. That interaction and `activeTab` injection from the real popup still require manual verification. Browser fixtures exercise PNG and normalized inline images; JPEG/GIF/WebP framing has unit coverage, with broader real-image browser coverage still needed.

## Remaining scope

Clicked-image OCR, source/target language controls, translation and text overlays belong to Phases 3–5. The Phase 2 **Image ready** status confirms acquisition and decoding only. CSS backgrounds, canvas/video, nested frames, automatic page-wide processing and browser-restricted pages are outside this preview. Direct SVG acquisition is rejected; animated rasters are decoded as a still image rather than processed frame by frame. Protected or redirected HTTP images can fail even while visible on the page, because the extension fetch omits credentials and refuses redirects. Tainted inline canvases fail with an image-access explanation.

The model/runtime memory findings and licensing constraints in [Phase 1](PHASE_1.md) remain applicable to the sample inference diagnostics. The PRD's implementation phases are unchanged.
