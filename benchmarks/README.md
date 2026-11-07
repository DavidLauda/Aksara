# Aksara local speed and quality benchmark

The starter corpus is ready without collecting more panels: two user-supplied War and Peas crops plus eight Aksara-authored controlled bubble/text layouts. They test the reported failure and specific edge cases. **This is not yet a representative real-comic dataset.** Synthetic results must never be presented as real-comic accuracy. More independent real panels from the user's reading material can extend coverage later; they are optional for running this baseline.

## Run

Build the extension and use the isolated Chromium installation / `.test-profile-current` model cache already used by the browser tests:

```powershell
npm run build
npm run benchmark
```

The default runs one **cold + warm pair per case** (20 actual OCR → NLLB requests), sequentially. It does not download model weights or use an API. If the isolated profile lacks the pinned q8 model, prepare it explicitly through the existing Setup flow before running. Fixture server port 80 and `.test-profile-current` must be free; do not run other browser suites concurrently. Your regular Chrome profile is not used. Fixture-only language/site/contrast preferences are restored afterward.

For a focused or longer experiment:

```powershell
npm run benchmark -- --case real-package --case negation
npm run benchmark -- --case real-package --repeats 3
npm run benchmark -- --memory
```

`--memory` samples only the isolated browser's process IDs on Windows, roughly every two seconds. It records aggregate private committed bytes and summed working sets, excludes dedicated GPU VRAM and can double-count shared resident memory. The sampling subprocess perturbs timing; compare runs with the same setting. It is not a measurement of a single ONNX allocation or a minimum device requirement. Without this flag, memory is explicitly unmeasured.

Results go to a new `test-results/benchmark/<timestamp>/` folder; `latest.json` points to the latest run. Files include:

- `report.json`: full annotations, fixture hashes, actual bounded OCR/translation output, per-stage timing, grouping/error metrics, optional memory samples, browser/GPU/CPU/model identity and source/build fingerprints.
- `report.md`: timing/accuracy table and source/OCR/translation comparisons.
- `review-template.json`: an editable worksheet with null semantic ratings. Copy it before reviewing; incremental report writes do not overwrite reviews.

These artifacts intentionally contain the development fixture text. They are local files under ignored `test-results`, not a production telemetry/history feature. The benchmark loads a fixture page, then sets Chromium offline during measurements. HTTPS routes also have a defensive block; recorded external requests must remain empty. No annotations or reference words are passed to OCR, the model or the content script. Only the actual image pixels enter the existing page pipeline. The isolated-world harness observes genuine messages and never substitutes results.

This measures inline PNG acquisition and local processing, excluding image-server/network latency. A runtime failure such as `NO_TEXT_FOUND` remains a failed attempt and produces a nonzero exit code, but the runner continues and saves its reports. Read per-request errors and top-level `failure` separately to distinguish a detected product failure from a setup/harness failure. Failed attempts have no invented OCR or inference scores; do not average only successful rows and call that dataset-wide accuracy.

## What the numbers mean

Cold means the dedicated inference worker was terminated before the request. Model files remain cached; browser/OS disk caches are not flushed. Warm immediately repeats those pixels without releasing the worker. The report checks the runtime's actual cold flag rather than assuming warm reuse. Neither mode is a first-install/download measurement.

OCR, SHA verification, model loading and inference use the existing runtime timings. Wall time starts just before keyboard activation and ends when the real response is observed, so it includes transfer, messaging and polling overhead. A pair is one observation, not a p95/p99 estimate. Fix power/thermal/background-work conditions and use multiple pairs on independent devices before making latency claims.

OCR character error rate (CER) is edit distance over Unicode code points divided by reference characters, after NFKC, case, smart-apostrophe and whitespace normalization. Punctuation/spaces remain in CER. Word error rate (WER) tokenizes Unicode letters/numbers with internal apostrophes and ignores other punctuation. Insertions can produce rates above 100%; an empty reference denominator is null. Global scores include reading-order errors. Per-region scores use manually annotated pixel rectangles.

Grouping assigns an actual OCR line to the reference rectangle containing at least half its area. It compares expected bubble membership with actual translated source-line IDs. The report exposes paired-line precision/recall, merged groups, split regions, missing regions, unassigned lines, untranslated lines, duplicate memberships and partial results. Null pair denominators are not a pass; a single-line case may have no meaningful pair score. Missing or skipped text remains visible in its own counts and OCR error rate.

**Translation semantics is deliberately unscored automatically.** Candidate references are authored meaning guides, not authoritative exact strings. In `review-template.json`, identify the reviewer and date, then score adequacy, fluency and context from 0 (unusable/wrong) to 4 (preserved/natural), adding notes for omissions, negation, speaker separation and ambiguity. Equivalent natural wording is valid. Keep uncertain ratings null. Review both cold and warm output for possible differences. Do not treat a completed request, exact substring or low OCR error as proof of good translation.

## Corpus and provenance

`corpus.json` lists IDs, real/synthetic provenance, source/target languages, tags, expected source transcripts, natural-pixel region rectangles, candidate translations and image SHA-256. The real files are referenced in `tests/fixtures/` without duplicating the artwork. They came from the user's bug-report screenshot; no distribution license is inferred. All corpus data is development-only and stays outside `dist`.

Controlled cases cover a wrapped parcel sentence, separate speakers, a negative command, the encouraging idiom “We got this!”, punctuation, caption versus dialogue, smaller type, and Indonesian source text. The idiom deliberately contrasts with receiving a package in the real panel. Straight Arial, clean backgrounds and rectangular annotations make these controlled cases easier than many real comics. They do not test all styles, vertical writing, rotation, hand lettering, dense pages, low contrast or all target languages.

To add a real panel: place a local development-only PNG in this corpus or `tests/fixtures`; record provenance and permission/rights information; transcribe pixels faithfully without correcting spelling; annotate each independent text region; add source/target and a meaning guide. Do not pick only examples the model already handles. Keep an independent holdout set when tuning grouping/model settings.

`npm run benchmark:fixtures` regenerates the eight authored images and manifest using Sharp and local Arial. This may change pixel hashes across font/rendering platforms. Review changed pixels and annotations before accepting regenerated hashes. The benchmark checks committed hashes; it never regenerates fixtures implicitly or silently updates a baseline.
