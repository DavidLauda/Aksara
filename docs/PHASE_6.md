# Phase 6 — Hardening and release decision

Implementation date: 6 November 2026. Target version: 0.6.0 research preview.

## Privacy surface design contract

The user's job is to understand what Aksara reads, what stays locally, and when a network connection is made. Add a packaged Privacy & local data page reachable from the popup and Setup. Reuse the existing quiet green text, warm background, system typography, visible gold focus and bounded reading column. The first screen should state the local processing boundary and disclose image-host/model-download connections. Use plain paragraphs with descriptive headings and ordinary links; no new modal, consent flow, remote fonts, scripts or permissions.

Target viewports: 375×812, 768×900, 1440×900; popup remains 330 pixels wide. Reference: the existing Phase 5 Setup page. Verify no horizontal overflow, readable long content, keyboard access and axe at each width. The content is entirely packaged: loading, empty, error and partial states do not apply to this static informational page. Success means all disclosures are readable and its links resolve. Permission information explains existing access and revocation; opening the page requests no grants. Existing processing/error/permission controls retain their own previously tested states.

## Validation and release decision

**Decision: DO NOT SHIP publicly or commercially. Continue local research testing.** The Phase 6 exit gate is a documented decision, not a promise that every external release condition has been met. No store submission, publication or deployment was performed.

The core local image translation journey works on the tested machine, including the comic-context regression. Public release remains gated by model rights/intended use, dependency/data provenance, real-device/manual coverage, and acceptable latency. The packaged privacy notice is available now; a published policy URL and store disclosures are still needed before a store submission.

## Changes

- Added a packaged, script-free Privacy & local data page, linked from both popup and Setup. It explains selected-image fetching, explicit model downloads, local retention/deletion, diagnostics and the host website's ability to read DOM output. Opening it makes no network request or permission request.
- Normalized otherwise unlabelled GPU adapter/device/probe exceptions to `WEBGPU_UNAVAILABLE`. Setup previously could describe such driver failures as connection/disk problems. Cancellation/deadline behavior and late-device disposal are retained; raw driver details are excluded from operational errors.
- Added an explicit damaged-model repair message while preserving recognized text. SHA verification removes only the affected cached file; repair remains an explicit Setup action.
- Added real-browser hardening coverage and distribution checks. Included the bundled `regenerator-runtime` MIT notice and model attribution/quantization notice. Version metadata is 0.6.0; no permission was added.

## Hardening coverage

Current results and screenshots are in [Phase 6 QA](evidence/phase-6/QA.md). Test-only code and fixture grants are confined to copied extensions and disposable profiles; the main `.test-profile-current` q8 cache is preserved.

| Risk / boundary | Evidence and scope |
| --- | --- |
| Hostile URLs and malformed rasters | Policy tests cover ambiguous/alternate IP encodings, private/reserved literals, credentials, local names, ports, MIME/signature mismatch, malformed codec framing and dimension limits. |
| Redirect / large image response | Real browser acquisition rejects a 302 without contacting its private fixture destination; rejects an 8 MiB + 1 byte body without Content-Length. Temporary staging is empty afterward. |
| CSP-heavy page | A fixture with `script-src`, `connect-src` and `worker-src 'none'` still supports isolated controls and actual packaged OCR. This is controlled CSP coverage, not a claim about every live website. |
| Multiple tabs / ownership | A held read in one tab causes BUSY in another and in model/diagnostic operations. A foreign port cannot cancel its owner. The second tab succeeds after the owner cancels. |
| Navigation / dynamic DOM | Cross-document navigation cancels old work; the new document succeeds. Existing replacement, currentSrc, insertion, reinjection, same-document route, crop, resize and layout tests pass. |
| Untrusted context | Content scripts cannot start diagnostics, download/delete the model or read model-management status. Trusted page clicks and authoritative document/source snapshots remain required. |
| Cache eviction / corruption | Real Chromium CacheStorage tests delete one range and the whole fixture cache. Missing data is reported without auto-download; explicit repair fetches only the missing range. Same-size corruption fails full SHA and removes only its containing file. These tests use tiny pinned files, not destructive edits to the real q8 cache. |
| Disk / GPU failures | A deterministic low-quota estimate blocks before fixture fetch. Chromium launched with GPU and software rasterizer disabled has no usable adapter; model preparation fails before network and releases the workload gate. Unit tests cover stalled GPU calls, cancellation, late device cleanup and driver rejection. Physical disk filling, RAM pressure and GPU OOM were not induced. |
| Worker failure | Actual service-worker termination and extension reload are exercised by the image suite; page and model-init cancellation close the offscreen host. Cached translation/offline/restart results are recorded separately in QA. |
| Package / privacy | All HTML JS/CSS entries resolve within dist; content parses as a classic script. Expected permissions/CSP are asserted. Model weights, comic fixtures and the test cache entry are absent from dist. Local runtime/data assets have size/SHA checks. This is a regression boundary, not a complete security certification. |

Lexical URL checks cannot determine a public hostname's eventual DNS resolution or prevent DNS rebinding. Selected-image access is additionally bounded by the clicked document, host grants, omitted credentials/referrer, rejected redirects, streaming byte limits and decoder limits. No DNS-level public-address guarantee is made.

## Performance and memory

These are actual 0.6.0 local fixture measurements on one Windows machine, not a controlled before/after speed benchmark. The model and inference configuration did not change in this phase.

| Journey | Measured time |
| --- | --- |
| Comic sentence, cold worker | OCR 0.74 s; SHA verification 12.34 s; model/GPU loading 4.70 s; one inference 12.64 s; full browser case 33.04 s |
| Two comic bubbles, warm worker | OCR 0.64 s; two inferences 19.50 s; full browser case 20.60 s |
| Two independent sample lines, warm worker | Two inferences 12.26 s; full browser case 12.97 s |
| Retry of those sample lines | Two inferences 12.11 s; full browser case 13.06 s |
| WebGPU compute probe | 42 read back from both actual inference contexts; diagnostic job 0.31 s |
| Built-in English / Indonesian OCR samples | 0.23 s / 0.20 s diagnostic jobs |

The comic still translates as “Kami punya paket misterius ini.” in one request. The two-bubble fixture retains separate requests but still translates the nonstandard “cardbox” literally and drops “Huh?”; this phase does not claim improved model semantics. The earlier context-fix run was much slower despite the same translation configuration. Hardware scheduling, warm state and other conditions differ; these measurements do not diagnose the user's bottleneck or establish a guaranteed speedup.

Cold SHA verification is a material delay. The selected q8 download is 911,962,632 bytes; runtime CPU/GPU buffers and WASM heaps require more. No fresh peak RAM/VRAM measurement was made in this phase. Historical Phase 1 cross-host experiments reached about 7.1 GiB aggregate private committed process memory and 8.9 GiB summed resident memory, excluding dedicated VRAM and potentially double-counting shared pages. Those numbers are not a current single-model requirement. A 2 GB RAM claim is unsupported.

One workload runs at a time. Page inference uses a terminable offscreen dedicated worker, releases OCR before translation, terminates after 60 seconds idle, and keeps the existing 240-second translation / 380-second overall request limits. Downloads use bounded chunks; ONNX loading still makes large contiguous allocations. No seamless recovery from OS-level process termination or physical GPU exhaustion is claimed.

## Device and supported-feature matrix

| Environment / feature | Status |
| --- | --- |
| Windows, Ryzen 5 5600H, approximately 16 GB RAM, Chromium 156.0.8078.4 | Verified local fixtures. Latest probe reports NVIDIA Turing; earlier Phase 1 runs selected AMD GCN 5 on this hybrid machine. These are not two independent test devices. |
| Chrome 124 minimum declared in manifest | Compatibility target only; not validated on Chrome 124. Stable desktop Chrome action/permission UI remains manual. |
| Other Windows devices, Intel GPUs, macOS, Linux, low-memory devices | Unverified. Do not advertise a broad minimum RAM/GPU support guarantee. |
| WebGPU absent / no usable adapter | Verified graceful preparation failure in a disabled-GPU browser configuration; OCR and same-language reading remain local without model inference. |
| English / Indonesian source; Indonesian / English / French target | Included preview languages; three translation directions and same-language reading are in the regression suite. No automatic language detection. |
| Ordinary top-frame HTTP(S) rectangular images, PNG/JPEG/GIF/WebP | Supported within 8 MiB / 16 MP / 8192-pixel limits. Animated input uses a decoded still. CurrentSrc changes invalidate results. |
| Fit/position/border/padding, positive scaling, scroll/crop/viewport zoom | Tested aligned overlays. Rotation, masks, rounded clipping and unsupported mapping use selectable text fallback. Arbitrary foreground occlusion is not resolved. |
| Restricted browser pages, nested frames, SVG/AVIF direct acquisition, redirected/protected image hosts | Outside the preview's supported acquisition matrix. |

## Permissions and store review

| Permission | Current reason |
| --- | --- |
| `activeTab`, `scripting` | Explicit per-document activation and an authoritative isolated-world snapshot of the clicked image. No automatic static content-script injection. |
| `offscreen` | Local image decoding/canvas, bundled OCR WASM and a terminable inference worker. |
| `storage` | Language/site/contrast choices and bounded session job/progress metadata. No persistent translation history. |
| `unlimitedStorage` | Large resumable model cache; not a promise of RAM/VRAM or disk availability. |
| Required Hugging Face host families | Explicit pinned model-data download, including CDN redirects. Inference is cache-only. |
| Optional HTTP(S) image hosts | Named origin grants requested only when selected image access needs them. Optional broad patterns declare possible destinations; they are not blanket automatic grants. |

There is no debugger, history, clipboard-read, remote-inference or externally-connectable permission. CSP allows packaged WASM and HTTP(S) connections for user-selected image/model sources; it does not allow remote script tags. Distribution tests and network capture support those implementation findings.

Chrome Web Store requires an accurate privacy policy for products handling user data and a policy link in the dashboard. The packaged page documents behavior, but a publicly accessible URL and matching store disclosures remain release tasks. [Chrome privacy policy](https://developer.chrome.com/docs/webstore/program-policies/privacy)

The existing permissions serve implemented features; review their scope again for a production package. The store requires the narrowest access needed. [Chrome permissions policy](https://developer.chrome.com/docs/webstore/program-policies/permissions)

Executable JS/WASM is packaged and model fetch is pinned data-only in Aksara's design. Store rules require self-contained, reviewable logic and constrain remote logic. This audit does not establish that a store reviewer will accept the ONNX graph/model-loading approach; that classification and reviewer documentation remain a store-release gate. [MV3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)

## Licensing and remaining release gates

NLLB's original model card and the selected ONNX conversion identify CC-BY-NC-4.0. Meta describes research use and excludes production deployment from its stated intended use. Quantization and local caching do not grant commercial rights. Resolve intended-use/rights suitability or select and validate a suitable model before commercial/public production release. [Meta model card](https://huggingface.co/facebook/nllb-200-distilled-600M), [pinned conversion card](https://huggingface.co/Xenova/nllb-200-distilled-600M/blob/261c31d1a5732c67cdd16d80e8d6088507c7ccea/README.md), [CC BY-NC terms](https://creativecommons.org/licenses/by-nc/4.0/)

Local installed-license/source-map review covers Transformers.js and Tesseract.js/core (Apache-2.0), ONNX Runtime and its existing third-party notices (MIT plus notice inventory), noble-hashes and regenerator-runtime (MIT). The newly found regenerator notice is now packaged. This is not a complete prebuilt JS/WASM/transitive SBOM. OCR data package metadata declares MIT while its linked tessdata repository provides Apache-2.0; trace the exact bundled eng/ind artifacts and retain applicable attribution/notices before distribution. [tessdata upstream license](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE)

Remaining gates: resolve model use/rights; finish dependency/OCR-data provenance and notices; publish an accurate policy and prepare store disclosures/reviewer notes; validate stable Chrome/native grant dialogs, keyboard focus and screen readers; add independent devices/GPU vendors, realistic low-memory tests and a reproducible latency/memory benchmark; establish an approved visual baseline. None of those untested conditions is marked passed by this phase.
