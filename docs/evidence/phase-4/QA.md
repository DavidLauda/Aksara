# Phase 4 UI QA — local unpacked extension — 25 October 2026

Scope: Aksara **0.4.0**, Chromium **156.0.8078.4** on Windows, AMD Ryzen 5 5600H/16 GB machine. Page tests use isolated profiles and loopback fixtures. Actual NLLB q8/WebGPU inference uses the preserved `.test-profile-current` cache. A separate disposable profile tests bounded real downloads and cache removal. No user account, browsing history or production website is involved.

## Functional and privacy results

- Production build and **53 automated checks pass**, covering the distributable, image validation, OCR results, translation bounds/error policy, and model cache behavior. All **20 existing image/OCR browser regression cases** also pass against the final build.
- **Fourteen distinct Phase 4 browser scenarios pass across the recorded runs**: eleven functional cases in the initial run, two final lifecycle/layout cases, and one real download-management scenario. Three initial first-use cases were also repeated successfully against the final build. The initial run's remaining failure was an options-footer contrast violation; the fixed 0.4.0 layout/a11y run passes. The original failed report is retained rather than rewritten.
- Opening setup, declining download consent, and clicking Translate without a model cause **zero model requests**. Content-script model-management requests are rejected. Recognized text remains available with Setup guidance when weights are missing.
- Actual translations pass: English → Indonesian (`Open the door.` → `Buka pintunya.`), Indonesian → English, English → French, and two-line English → Indonesian (`Good morning.` → `Selamat pagi.`). Segment IDs and natural-coordinate OCR boxes remain associated with results.
- Warm translation reuses the worker; after releasing it, cold translation succeeds with the browser offline. Same-language selection returns the recognized text without model files or network access.
- Cancellation during initialization closes the host and permits a retry. Concurrent diagnostic/model-removal requests return BUSY. Forced background termination reclaims orphaned inference before retry. A dedicated-worker → background-worker host switch after an idle background restart leaves zero previous dedicated inference workers.
- All 911,962,632 bytes of the existing pinned model pass full local SHA-256 verification. The separate real download probe uses explicit UI clicks, cancels at **34,113,594 cached bytes**, resumes to **50,890,810 bytes**, reuses a completed 16 MiB range, and removes its partial cache back to **zero**. It does not download a second full model or touch the retained inference cache.
- The real download records only Hugging Face/model-CDN GETs with **zero request-body bytes**. Page inference runs report no external requests; captured console/page errors are empty. No image or recognized text is sent to a translation API.
- Final diagnostic smoke passes WebGPU compute (`42`) in both hosts and bundled English/Indonesian OCR. It does not claim a new full-memory benchmark.

## Interactions and states

Keyboard Enter starts the page translation. Source/target labels and selectable, read-only translated/original fields remain visible. Real cancellation, retry and background recovery pass. Setup explains the download provider/size, local processing and noncommercial model license before the explicit download action. Actual progress, cancelled partial data, resume, removal, model-ready and missing-model states are captured.

The model UI protects newer progress broadcasts from stale asynchronous snapshots and continues its four-second status polling during frequent progress updates. Completion/cancellation messages distinguish verification, preparation and removal. Cache removal is a short atomic operation and does not advertise cancellation.

Storage exhaustion, corrupted chunks, malformed ranges, request timeouts and memory-error mapping have automated policy/cache coverage. The browser run does not claim to have physically exhausted GPU memory or filled the disk. A partially translated long document is covered by translation-policy tests; the actual partial UI probe here is a cancelled/resumed model download.

## Layout and accessibility

Final page and Setup captures were rendered and visually reviewed at **375×812**, **768×900**, and **1440×900**. Browser assertions confirm card containment and no horizontal overflow. Narrow headings wrap, Setup action rows stack, the disclosure remains readable, and diagnostics stay bounded. Translation is emphasized above original OCR. The preview card covers part of the image on narrow screens; precise translated overlays remain Phase 5.

The popup uses its existing 330-pixel content column. The default rendered content occupies approximately 540 vertical pixels, with distinct labeled language selectors, activation and model readiness. This is an extension-page fixture, not an automated assertion about Chrome's native popup window.

Axe reports **zero violations** for the final page and Setup at all three sizes, the popup and the actual partial-download state. The original options footer had 4.17:1 contrast; its existing text color was darkened to reach 5.76:1, and the affected audit passed. Visible focus, labels and readable state/action content were inspected in the captures. Reduced-motion emulation is enabled for final layout capture. Keyboard activation is tested, but native popup/permission dialogs and a full screen-reader/focus-order pass remain manual. This is not a full WCAG-conformance claim.

## Fixture performance

The final lifecycle/layout run records **LCP 300 ms**, **CLS 0.00705**, and a maximum observed **Event Timing duration of 16 ms**. These are controlled local-fixture observations. Event Timing is not field INP; no field INP or production latency guarantee is claimed. In the initial run, a one-line cold page translation took about 28 seconds in the translation stage, while warm inference took about 9 seconds; the final two-line cold stage took about 34 seconds. Hardware, image content and runtime state materially affect latency.

## Verdict and evidence

The **Phase 4 functional exit gate passes**. Pixel visual regression is **INCONCLUSIVE** because no approved matching committed baseline exists. The preview still requires the manual native-UI/assistive-technology checks and broader device/Chrome-version matrix before release. NLLB licensing remains noncommercial; this result is not commercial release approval.

- [Initial run: eleven functional passes and the repaired contrast finding](translation-initial-report.json)
- [Final first-use and no-download report](translation-empty-report.json)
- [Final lifecycle, responsive layout, accessibility and performance report](translation-host-switch-report.json)
- [Real download, cancel, resume and removal report](translation-download-report.json)
- [Final image/OCR regression report](images-report.json)
- [Final WebGPU and OCR smoke report](browser-report.json)
- [Design evidence record](design-evidence.json)
- [Narrow translation](translation-375.png), [tablet](translation-768.png), [desktop](translation-1440.png), [popup](translation-popup-ready.png)
- [Narrow setup](translation-setup-375.png), [tablet setup](translation-setup-768.png), [desktop setup](translation-setup-1440.png)
- [Download progress](translation-download-running.png), [cancelled partial cache](translation-download-partial.png), [resumed cache](translation-download-resumed.png), [removed cache](translation-download-removed.png)
- [Missing-model guidance](translation-model-required.png), [translation loading](translation-loading.png), [French result](translation-french.png)
