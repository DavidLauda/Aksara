# Region OCR/context fix QA — Aksara 0.6.1 — 7 November 2026

**The two targeted functional fixes pass. Public release remains DO NOT SHIP.** Model-use rights, broader real-device/real-comic coverage and manual/native accessibility checks remain open as recorded in Phase 6. This step fixes the benchmark's missed single-line bubble and fragmented parcel sentence; it does not mark all of Phase 7 or general translation accuracy complete.

## Verification

| Check | Result |
| --- | --- |
| Production build / TypeScript | Pass. Executable assets remain packaged; the classic content entry and permissions boundary pass distribution checks. Existing Vite >500 kB warning remains. |
| Automated tests | **100 pass**, zero failures. Eleven additions cover bounded pixel analysis, shape membership, masks, crop limits/coordinates, recovered IDs/text caps, cross-layout continuation and separate-region boundaries. |
| Image/OCR browser suite | **30 cases pass**. Existing URL/format/size, inline/offline, CSP, authorization, multi-tab, navigation, interruption and cleanup checks pass. New empty-bubble and face fixtures return NO_TEXT_FOUND under both English and Indonesian OCR. Staged-image count is zero after every case. |
| Overlay suite | **20 cases pass**. Both original real panels, both new controlled cases, natural-coordinate alignment, copy/original/retry/details/contrast/Dismiss, site controls, invalidation, fit/crop/scroll/zoom and responsive axe checks pass. |
| Translation suite | **12 cases pass**. Missing-model consent, same language, full SHA, cold/warm English→Indonesian, Indonesian→English, English→French, cold offline inference, model-init cancellation and forced service-worker restart all pass. |
| Hardening suite | **7 cases pass**. Real tiny-file CacheStorage failures/repair, consent/GPU-unavailable behavior, packaged privacy links, keyboard and responsive axe remain valid. |
| Basic WebGPU/OCR smoke | Compute 42 in both inference contexts and both bundled OCR languages pass. |
| Unchanged full corpus | **20/20 cold/warm attempts return translations**, compared with 18/20 in the saved 0.6.0 baseline. This is pipeline completion, not a semantic accuracy percentage. |

Passing reports contain no captured page/extension errors or unexpected external/model requests. The complete q8 cache and regular Chrome profile were preserved. Benchmark fixture preferences were restored. Tests share port 80/current profile only sequentially; independent final smoke profiles may run together. The full timed benchmark itself ran without other browser suites concurrently.

## Actual fixes

**Wrapped parcel:** original Tesseract text and its two block identities remain unchanged. Pixel evidence assigns all three lines to the same enclosed light region, joining `We found a strange little parcel.` into one NLLB request. Actual output is **“Kami menemukan paket kecil yang aneh.”** The old output was two fragments, “Kami menemukan sedikit aneh” and “Paket.” Grouping pair recall changes from 1/3 to 1, with no split region. The original separate-speaker and caption cases stay separate.

**Missed idiom:** automatic and sparse OCR still miss the full-image layout. A pixel-derived mask removes the outline/artwork while retaining the source glyphs; one bounded recovery attempt returns **“We got this!”** with zero normalized OCR errors. Actual output is **“Kita bisa melakukannya!”**, consistent with this authored encouragement case. Recovered boxes are offset to original source coordinates, and browser assertions place them inside the original bubble. No annotation or expected word is passed into production OCR or inference.

The original real package panel still returns “Kami punya paket misterius ini.” Two real bubbles retain their distinct source membership. The `itis` word-spacing error remains (CER 2.5%, WER 22.2% in the controlled two-speaker case); NLLB still omits “Huh?” and translates the nonstandard “cardbox” literally. Semantic worksheets remain unfilled for independent review. These are assistant observations of actual strings, not human-certified ratings.

## Measured comparison

Baseline run: `2026-11-07T01-43-53-964Z`, runtime 0.6.0. Current full run: `2026-11-07T02-25-59-502Z`, runtime 0.6.1. Both use one cold/warm pair, Windows/Ryzen 5 5600H/approximately 16 GB RAM, Chromium 156.0.8078.4, NVIDIA Turing and optional task-browser memory sampling. [Comparison data](comparison.json) verifies the entire corpus/annotations, model manifest, evaluator, browser/GPU and sampling configuration are unchanged. Source/build fingerprints identify the changed working-tree runtime; the Git commit identifies its base.

| Case | 0.6.0 cold / warm | 0.6.1 cold / warm | Result |
| --- | --- | --- | --- |
| Real package | 31.29 / 10.78 s | 29.22 / 10.79 s | Same coherent output, one inference. |
| Real two bubbles | 40.69 / 20.30 s | 38.61 / 23.76 s | Same two regions and outputs. |
| Wrapped parcel | 31.31 / 12.89 s | 29.36 / 10.80 s | Two calls become one, with corrected sentence context. |
| Idiom | Both attempts fail before inference | 25.12 / 7.79 s | Now completes OCR and one inference. Failure times are not comparable translation latency. |

In the current full run, parcel layout analysis costs 24 ms cold and uses no OCR recovery pass; idiom analysis costs 21 ms plus 62 ms for its recovery pass. The actual overlay run separately measured parcel layout 44 ms and idiom recovery 65 ms. These are bounded fixture costs, not general large-image guarantees.

Cold SHA verification still costs approximately **12.13–12.30 s** across the full corpus, and no integrity check was weakened or removed. There is no claim of a general speedup: some warm cases are slower, power/thermal/background conditions are uncontrolled, and each case has one pair. The new complete idiom work makes whole-suite time incomparable with the baseline that failed early. Startup verification/loading and warm model inference remain separate optimization work.

Sampled task-browser peaks in the current full run are approximately **5.53 GiB aggregate private committed bytes** and **5.28 GiB summed resident working set**. These exclude dedicated GPU VRAM, may count shared resident pages more than once, and are sampled process peaks rather than continuous maxima or single-model requirements. Different peaks from the baseline do not establish a memory optimization.

## Rendered review and accessibility

Actual parcel captures at **375×812, 768×900 and 1440×900** were visually inspected. Tablet/desktop show one coherent region at its original location. At 375 px the longer translation cannot fully fit in the small source union while preserving the 12 px minimum: the overlay is clipped and visibly warns that full text is in Text details. That is the existing supported partial-display behavior, not full seamless fit at every size. Full source/translation strings remain available; this change does not alter the fitting policy.

The recovered idiom is visually inside the original bubble rather than shifted to the crop origin. Original real-panel captures retain their previous placement. Source geometry is numerically checked within 2 CSS pixels, including the added cross-block union and recovered coordinates. Popup/setup version labels use existing typography and controls.

Axe reports zero scoped violations at all three parcel sizes and the existing image/overlay/translation/privacy viewports. Keyboard and control interactions remain covered. Native Chrome action/grant windows, full screen-reader coverage, OS forced-colors integration and independent devices remain manual. **Pixel regression is INCONCLUSIVE** because there is no approved matching baseline. Passing axe and the local evidence checker are not complete accessibility or visual certification.

## Limits and next work

The new hints are conservative enclosed light-region heuristics. Open, dark, touching, very large or unusual shapes can fail detection. Other bright shapes can be candidates; false-positive behavior needs a broader holdout set despite the passing blank/face controls. Recovery currently runs only when whole-image OCR is empty, so it does not repair every individually missed bubble on an otherwise readable page. Candidate/pixel/time/text budgets remain bounded and skipped recovery candidates mark returned content partial.

The corpus still consists of two real panels and eight controlled layouts used during development. No broad real-comic accuracy claim follows. Extend independent examples and human review, then profile startup/inference without changing the current integrity/privacy boundary. Model licensing and the public-release decision remain unchanged.

## Artifacts

- [Full benchmark output](benchmark-report.json), [readable comparisons](benchmark-report.md), [review worksheet](benchmark-review-template.json)
- [Verified before/after data](comparison.json), [original baseline](../phase-7-benchmark/QA.md)
- [Overlay checks](overlay-report.json), [image/OCR checks](images-report.json), [translation/lifecycle checks](translation-report.json)
- [Hardening](hardening-report.json), [compute/OCR smoke](browser-report.json), [diagnostic layout probe](ocr-layout-probe.json)
- [Parcel narrow](region-parcel-375.png), [tablet](region-parcel-768.png), [desktop](region-parcel-1440.png), [recovered idiom](region-idiom-translated.png)
- [Design evidence record](design-evidence.json), [implementation](../../REGION_OCR_FIX.md)
