# Phase 6 QA — Aksara 0.6.0 — 6 November 2026

**Verdict: DO NOT SHIP publicly/commercially.** Local research preview validation passes on the tested Windows machine. Model rights/intended use, notices/provenance, public privacy-policy hosting and device/manual coverage remain release gates. See the [release decision and support matrix](../../PHASE_6.md).

## Final verification

| Command | Result |
| --- | --- |
| `npm run build` | Pass: TypeScript, MV3 bundles, classic content IIFE and 16 hashed copied runtime/language/license assets. Vite's existing >500 kB bundle warning remains; SW dynamic import is not introduced. |
| `npm test` | 82 tests pass; zero failures. Includes driver-error classification, lifecycle cleanup, policy/cache/geometry/context and distribution boundaries. |
| `npm run test:hardening` | 7 browser cases pass. Tiny-file real CacheStorage eviction/repair/corruption, low-quota estimate, disabled-GPU preparation, privacy keyboard/navigation/axe/responsiveness. Errors and external requests: zero. |
| `npm run test:images` | 26 real browser cases pass. Six added cases cover context authorization, strict CSP, multi-tab ownership, cross-document navigation, redirect denial and streaming size bounds. Temporary image staging: zero after every case. |
| `npm run test:overlays` | 18 cases pass, including actual comic OCR → NLLB and Retry. Geometry/rendering-only cases are explicitly labeled. Errors and external requests: zero. |
| `npm run test:translation` | 12 cases pass: first use/consent, missing model, same language, actual q8 SHA, cold/warm translation, English/Indonesian/French, cold offline inference, cancel/retry, forced SW restart and responsive axe. Errors and external requests: zero. |
| `npm run test:browser` | Actual compute 42 in both hosts, English and Indonesian sample OCR; errors and remote requests: zero. |

The new hardening suite bundles the production cache core into a **test-only extension copy**, uses tiny SHA-pinned data and a fixture fetch dependency, and blocks HTTP(S) routes. It does not model NLLB allocation sizes, fill the physical disk or exhaust GPU memory. Eviction is induced by deleting cache entries. The disabled-GPU launch is verified to return no usable adapter before model preparation; the actual background preflight then fails with WEBGPU_UNAVAILABLE and accepts another job, proving the gate is released.

An initial discarded harness attempt used an ineffective GPU-disable switch and began a partial download in its disposable profile. Closing that browser stopped it; the profile was recreated. Final evidence comes from the corrected configuration with networking guarded and zero recorded external requests. The existing complete q8 profile and the user's regular Chrome profile were not modified by that fault test.

## Visual, interaction and accessibility review

The packaged privacy page was visually inspected at 375×812, 768×900 and 1440×900. Its heading wraps at the narrow width, all disclosure sections remain readable, and the bounded desktop text column avoids horizontal overflow. The popup's Privacy & local data link fits its 330 px column and has visible keyboard focus. Keyboard Enter opens the page and its return link reaches Setup; Setup also links back to privacy. The privacy page has no scripts, remote styles/fonts or outbound automatic requests.

Axe reports zero scoped WCAG A/AA violations for privacy at all three widths and for the popup. Current image/overlay/translation suites also audit their result layouts at those widths. Reduced-motion emulation and keyboard actions are exercised. Native Chrome popup/grant windows, full screen-reader behavior and OS forced-colors integration remain manual. Passing axe is not full WCAG conformance.

The actual comic remains one complete translated region: “Kami punya paket misterius ini.” Two source bubbles remain two regions; “cardbox” is still literal and “Huh?” is omitted by the model. No hand-corrected expected text is substituted into inference. Captures show the existing opaque DOM backing, rather than image inpainting.

Pixel regression: **INCONCLUSIVE**, because no approved matching baseline exists. Current screenshots and numeric layout assertions are evidence of this run only.

## Performance observations

The comic cold-worker case took 33.04 s (OCR 0.74 s, SHA 12.34 s, loading 4.70 s, one inference 12.64 s). Warm two-bubble processing took 20.60 s; warm two-line processing took 12.97 s and Retry 13.06 s. These are fixture run times, not a controlled speed comparison or general user latency promise. No peak RAM/VRAM was measured in this phase.

Image fixture LCP was 56 ms and CLS 0.00094; no qualifying Event Timing entry was observed. The overlay mutation sequence measured LCP 60 ms, CLS 1.6812 and maximum Event Timing 120 ms. The translation sequence measured LCP 52 ms, CLS 0.4407 and maximum Event Timing 200 ms. These sequences deliberately move/resize content and navigate; their CLS is not passive extension impact, and maximum Event Timing is not field INP. Real-page vitals and representative latency/memory remain release work.

## Evidence

- [Hardening/cache/GPU/privacy cases](hardening-report.json)
- [Image/OCR/authorization cases](images-report.json)
- [Actual context translations and overlays](overlay-report.json)
- [First-use, offline, cancellation and restart](translation-report.json)
- [WebGPU and packaged OCR](browser-report.json)
- [Privacy narrow](privacy-375.png), [tablet](privacy-768.png), [desktop](privacy-1440.png), [popup focus](hardening-popup.png)
- [Strict-CSP OCR](ocr-strict-csp.png), [current comic](context-comic-translated.png), [separate bubbles](context-two-bubbles.png)
- [Design evidence record](design-evidence.json)
