# Starter benchmark baseline — 7 November 2026

The benchmark tooling and baseline collection are complete. **Product accuracy does not pass every starter case.** The existing 0.6.0 runtime was measured without changing OCR, grouping or inference. Build and all **89 automated tests** pass, including seven independent tests for the new error/grouping evaluator. Distribution checks confirm development fixtures stay outside dist.

## Scope and execution

Run ID: `2026-11-07T01-43-53-964Z`. Command: `npm run benchmark -- --memory`.

The corpus contains **2 real user-supplied comic panels and 8 controlled synthetic layouts**. Each received one cold-worker attempt and an immediate warm attempt. All 20 attempts finished; 18 returned actual OCR/NLLB translations. The idiom fixture returned NO_TEXT_FOUND in both attempts, so the command correctly exits 1 and report.ok is false. Those two failures are preserved, not excluded or scored as perfect OCR. Their failed-attempt wall times are not translation latency measurements. Cold/warm model state cannot be established for them because inference was never reached.

No top-level harness/setup exception occurred. Page/extension console error collection and recorded external requests are empty; fixture preferences were restored. Model data came from the existing pinned q8 cache. The runner went offline before measurements and the regular Chrome profile was not used. The review worksheet contains all 20 attempts, with all independent semantic ratings left null.

This is one Windows/Ryzen 5 5600H/approximately 16 GB RAM machine with Chromium 156.0.8078.4; the GPU probe selected NVIDIA Turing. The report preserves actual CPU/GPU/browser/model identities, image hashes, source/build fingerprints and raw bounded results. There was one cold/warm pair per case and memory sampling was enabled: these observations do not establish p95 latency, broad device compatibility or representative comic accuracy.

## Measurements

| Case | Kind | Cold wall | Warm wall | OCR/grouping observation |
| --- | --- | ---: | ---: | --- |
| real-package | Real | 31.29 s | 10.78 s | CER/WER 0; all three rows form one region and one inference. |
| real-two-bubbles | Real | 40.69 s | 20.30 s | CER/WER 0; both bubbles remain separate. |
| wrapped-parcel | Controlled | 31.31 s | 12.89 s | CER/WER 0; one bubble incorrectly becomes two translation regions. |
| two-speakers | Controlled | 36.52 s | 18.70 s | CER 2.5%, WER 22.2%; it is becomes itis. Speakers remain separate. |
| negation | Controlled | 26.14 s | 8.60 s | CER/WER 0; negative command preserved in the observed output. |
| idiom | Controlled | No text found | No text found | OCR miss on readable We got this!; no translation or semantic judgment possible. |
| punctuation | Controlled | 28.31 s | 11.19 s | CER/WER 0; one translated region. |
| caption-and-dialogue | Controlled | 33.11 s | 15.30 s | CER/WER 0; caption and speech remain distinct. |
| small-text | Controlled | 27.20 s | 10.12 s | CER/WER 0; both rows grouped. |
| indonesian-negation | Controlled | 27.23 s | 10.10 s | CER/WER 0; observed English output preserves the negative command. |

For the real package panel, cold stages were OCR **0.86 s**, SHA verification **12.48 s**, model/GPU loading **4.98 s**, and inference **12.61 s**. Warm inference was **10.01 s**, with no verification/loading. Across the nine successful cold case types, SHA verification was approximately **12.14–12.82 s**. These durations include the runtime's actual work; the load stage includes GPU preflight, and inference is an end-to-end runtime call rather than a GPU-only hardware measurement.

Optional sampling records aggregate task-browser process peaks, not a single-model allocation. The report includes private committed bytes and summed resident working sets, excludes dedicated GPU VRAM, and can double-count shared resident pages. Observer overhead is part of the experiment conditions. No minimum memory requirement or safe low-memory-device claim follows from these samples.

Across 233 samples, the highest aggregate private committed measurement was **5.92 GiB** and the highest summed resident working set was **5.63 GiB**, potentially at different times. These are sampled process peaks, not continuous maxima. No memory-sampling errors were reported.

## Initial qualitative observations

These are assistant observations of actual output, **not independent human ratings** or an aggregate semantic score. All candidate references remain meaning guides and equivalent wording is valid.

1. **Existing context regression stays fixed:** the real panel returns “Kami punya paket misterius ini.” in one request. Both real panels retain zero transcription errors and correct grouping in this run.
2. **A new grouping failure survives perfect OCR:** the controlled source is “We found a strange little parcel.” Tesseract puts parcel. in another paragraph although all words lie inside one authored bubble. Aksara honors that boundary, producing “Kami menemukan sedikit aneh” and “Paket.” as separate outputs. Grouping recall is 1/3 for the three line pairs, with the expected region flagged split. Repeating warm gives the same failure.
3. **A new OCR miss occurs before translation:** the idiom fixture is visibly readable but yields NO_TEXT_FOUND twice. The model's handling of that idiom remains untested. Investigate layout/segmentation and targeted preprocessing before drawing a conclusion about NLLB semantics or the GPU.
4. **OCR word joining is exposed:** the two-speaker case recognizes itis. Its 2.5% character error becomes 22.2% word error under the documented tokenization. This illustrates why a single metric is insufficient; the observed translation still preserves the negative reply.
5. **Known model issues remain:** the real two-bubble output drops Huh? and translates cardbox literally as kotak kartu. The original spelling is nonstandard; the candidate kardus reference is an interpretation requiring contextual review.

The successful cold/warm pairs produce identical translation strings in this run. Repetition on this small fixed corpus is not a general determinism guarantee. No global quality percentage is reported: the samples are few, heterogeneous and predominantly synthetic, and two attempts have no recognized output.

## Next measured work

Investigate the paragraph split inside one bubble while retaining separate-speaker boundaries; investigate why the single-line bubble is missed; then profile startup verification/loading and warm inference separately. Preserve current integrity and privacy checks in performance experiments. Keep these failing fixtures unchanged as baseline cases, extend with independent real examples and a holdout set, and complete human meaning/fluency/context review before choosing a model or claiming improved accuracy. Phase 7 optimization is not marked complete by collecting this baseline.

## Artifacts

- [Complete raw report](report.json)
- [Readable timings and comparisons](report.md)
- [Semantic-review worksheet](review-template.json)
- [Frozen corpus, source/build identity and model manifest](report.json)
- [Regeneration and repeat-run instructions](../../../benchmarks/README.md)
