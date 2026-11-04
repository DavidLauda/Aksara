# Wrapped-text context fix QA — 0.5.1

Date: 4 November 2026. The reported sentence-context regression is fixed on the supplied comic crops using actual local OCR and NLLB. The production build and **76 automated tests pass**. The final browser reports have **18 passing overlay/context scenarios**, **20 passing image/OCR regressions**, **3 passing first-use scenarios**, and successful WebGPU/local OCR smoke checks. No inference or model-download mocks are used for the comic cases.

## Actual comic results

Tesseract recognizes the first crop as three lines in one paragraph: `We got this`, `mysterious`, `package.`. The normalized result preserves that paragraph identity. NLLB receives exactly **`We got this mysterious package.`**, and produces **`Kami punya paket misterius ini.`** in **one inference call**. The old per-line plan would have made three independent calls. The grouped source-line IDs and union box are asserted against actual OCR output, and the browser overlay matches the union geometry within 2 CSS pixels.

The second crop contains six lines in two bubbles. It produces two separately positioned regions and **two inference calls**, retaining different block/paragraph identities:

| Source region | Actual NLLB output |
| --- | --- |
| `Huh? There's nothing inside.` | `Tidak ada apa-apa di dalam.` |
| `It's just an empty cardbox.` | `Ini hanya kotak kartu kosong.` |

The model still omits the interjection and interprets the nonstandard word `cardbox` literally. These results demonstrate preserved sentence grouping and separate bubbles, not perfect translation quality. No spelling corrections, hardcoded phrase replacements or fabricated model outputs are added.

## Layout, controls and privacy

The grouped comic overlay was rendered and visually reviewed at **375×812, 768×900 and 1440×900**. Complete text wraps inside one bounded, centered region rather than separate boxes for isolated words. All three comic viewports report zero axe violations. The existing wide/narrow overlay, popup, zoom, clipping, original toggle, copy, Retry, high contrast, site-disable, cancellation, navigation and independent-image checks also pass.

Original text remains available in Text details. Stored translation history is not introduced. The screenshots and development-only fixture crops remain local and are not extension runtime assets. Actual page inference reports **zero external requests and zero captured errors**. First-use cases confirm model absence does not trigger a download and same-language OCR needs no weights. The current smoke probe selects NVIDIA Turing WebGPU on the Windows/Ryzen 5600H/16 GB test machine.

Hostile/long-text, navigation replay and independent-image cases remain explicitly labeled rendering fixtures in the report. The two new comic cases use real pixels through actual OCR and cached NLLB.

## Measured latency

The first grouped comic run records:

| Stage | Time |
| --- | --- |
| OCR | 1.6 s |
| Cache SHA verification | 15.7 s |
| GPU/model initialization | 9.5 s |
| One whole-sentence inference | 54.2 s |

The full test case takes 85.4 s, including UI assertions, screenshots and three viewport audits. The next two-bubble job uses the warm model but still spends 104.6 s in two inference calls, with zero verification/load time. These measurements do **not** establish an overall speedup. Grouping reduces repeated requests and restores context; model computation remains slow in this run. It is not a controlled comparison with earlier Phase 5 timings, and does not diagnose a specific bottleneck on the user's device. New result timing fields make verification, loading and inference distinguishable.

## Remaining limits and verdict

The **targeted functional regression passes**. Grouping depends on OCR paragraph structure plus conservative geometry and can still fail when OCR assigns incorrect paragraph boundaries. Source errors, ambiguous pronouns and model limitations remain. No approved visual baseline is available, so pixel regression is **INCONCLUSIVE**. Native Chrome permission/popup windows, a full screen-reader pass and a broader GPU/browser matrix remain manual/release-stage work.

- [Actual comic and overlay report](overlay-report.json)
- [Image/OCR regressions](images-report.json)
- [GPU/OCR smoke](browser-report.json)
- [First-use/no-download report](translation-empty-report.json)
- [Design evidence](design-evidence.json)
- [Original comic crop in the browser](context-comic-original.png), [translated](context-comic-translated.png), [two separate bubbles](context-two-bubbles.png)
- [375 px](context-comic-375.png), [768 px](context-comic-768.png), [1440 px](context-comic-1440.png)
