# Phase 7, step 1 — Repeatable local benchmark

Date: 7 November 2026. Extension under test: the existing 0.6.0 runtime. This step adds development tooling and a baseline; it does not change OCR, grouping or model inference behavior.

The user does not need to collect a new dataset to begin. The starter set uses two existing real comic crops and eight authored controlled layouts. It is enough to measure the existing bug regression and specific failure modes, but it is **not a representative real-comic evaluation set**. More independent real panels will be needed before a broad accuracy claim or model-selection decision. Keep a holdout set when tuning.

## Implemented

- A SHA-pinned corpus with provenance, source/target languages, exact pixel transcripts, expected independent text regions, candidate translation meaning guides and review notes. The existing user-supplied artwork is referenced without duplicating it; new controlled layouts are authored for this project. All fixtures remain outside the extension package.
- A browser benchmark using actual content-script image acquisition, packaged Tesseract and cached NLLB q8/WebGPU. The harness only observes genuine messages; reference text is never substituted into OCR/model input. Chromium is offline during measurements and no model downloads are started.
- One cold/warm pair per case by default, with case filtering and repeated pairs available. Cold terminates the inference worker while retaining the cache; warm immediately repeats the pixels. Runtime cold flags are checked so results are not silently mislabeled.
- Separate OCR, SHA verification, model/GPU loading, inference and end-to-end timing. Optional Windows memory sampling is limited to the isolated browser's process IDs. Aggregated private bytes/working sets are approximate browser-process measurements and exclude dedicated GPU VRAM.
- OCR character/word error rates and per-region comparisons; grouping precision/recall, merged/split/missing regions, unassigned/untranslated lines and partial flags. These metrics remain distinct from translation semantics.
- Timestamped local JSON/Markdown reports and a semantic-review worksheet with unfilled ratings. References are meaning guides, and equivalent wording is valid; execution success and exact matches are not treated as semantic quality passes.
- Browser/GPU/CPU/model identity, fixture SHA and source/build fingerprints for comparing runs. The runner uses the existing test profile, restores its language/site/contrast preferences, and never opens the regular Chrome profile.

## Usage and evidence

See [benchmark instructions and metric definitions](../benchmarks/README.md) and the [completed initial baseline](evidence/phase-7-benchmark/QA.md). Twenty attempts finished: eighteen returned translations, and two exposed a repeatable NO_TEXT_FOUND on the same idiom fixture. A separate wrapped-sentence case has zero OCR errors but incorrect paragraph grouping. These are recorded failures to investigate, not a quality pass. Raw reports also remain under ignored `test-results/benchmark/<timestamp>/`.

Single pairs on one device are observations, not statistical latency guarantees. The optional memory observer changes timing conditions; compare like-for-like runs. No physical memory exhaustion is induced. Human translation ratings and a broader real corpus remain outstanding; the benchmark keeps those limits visible rather than inventing a combined accuracy score.

The subsequent [0.6.1 OCR recovery/grouping change](REGION_OCR_FIX.md) addresses the two observed failures. The original baseline above remains unchanged for comparison; current measurements are recorded separately.
