# Preserve wrapped sentence context — 0.5.1

The reported comic displays “We got this / mysterious / package.” across three visual rows. Tesseract recognizes the words correctly, with 94% page confidence on the supplied cropped panel, and places the three rows in a single paragraph. The old normalization discarded paragraph/block identity, and translation treated each visual row as an independent input. That allowed “We got this” to become the unrelated encouragement “Kita bisa melakukannya.”

## Change

OCR lines now retain generated `blockId` and `paragraphId` values alongside their original IDs, confidence and natural-image boxes. Normalization still bounds and sanitizes the result; it does not return Tesseract's complete page graph.

Translation builds regions from adjacent lines in the same paragraph. Joining requires similar text height, vertical proximity, horizontal overlap and matching left, right or center alignment. Explicit paragraph/block boundaries prevent joining separate speakers or panels. If old/unstructured results have no paragraph metadata, only an unfinished line followed by a nearby lowercase continuation may join. Groups are limited to 12 lines and 960 source code points, within the existing page/token budgets.

Wrapped rows become spaces before translation, so this case supplies exactly `We got this mysterious package.` to NLLB in one request. Longer regions prefer sentence boundaries before falling back to word-boundary chunks. The configured q8 model, WebGPU backend, privacy boundary and memory policy are unchanged.

Each grouped result has a stable `segmentId`, its `sourceLineIds`, a union bounding box and a text alignment hint. The overlay wraps the complete translated sentence inside that box and fits its font against the source row count. Centered comic text remains centered; left-aligned paragraphs retain left alignment. Raw OCR text is still available for comparison. Single-line results retain the earlier shape.

`ImageTranslation` also returns `inferenceCalls` and `timing: {verifyMs, loadMs, inferenceMs}`. OCR has its existing `elapsedMs` separately. These counts/timings distinguish cache verification and model initialization from actual translation, rather than attributing all waiting time to the GPU. They are result metadata, not a persistent page-text log.

## Regression fixtures and limits

The development-only crops in `tests/fixtures/` come from the user's supplied War and Peas screenshot. They are not packaged with the extension. The browser test derives its source text from real pixels and sends it through actual cached NLLB; it never substitutes the expected strings for OCR/model output.

The first crop must produce one region containing all three source lines and one model request, with a package-related translation rather than “bisa melakukannya.” The second crop has six rows in two distinct bubbles; it must produce two regions, retaining separate paragraph IDs and union boxes. Tests also cover grouping boundaries, geometric separation, uncertainty, limits, sentence-aware chunking and unchanged single-line behavior.

The complete evidence is recorded in [context-fix QA](evidence/context-fix/QA.md). Grouping follows OCR layout plus conservative geometry; it is not a general speech-bubble detector. Bad paragraph segmentation, incorrect OCR, ambiguous pronouns and translation-model limitations can still affect quality. Larger groups reduce repeated inference calls, but cold verification/load time remains and no universal latency improvement is promised.
