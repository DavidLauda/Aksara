# Enclosed light-region OCR recovery — 0.6.1

Date: 7 November 2026. Phase 7, step 2: fix the two failures found by the starter benchmark. The corpus pixels, transcripts and references stay unchanged; model weights/configuration, integrity checks, permissions and local-only inference stay unchanged.

## Problem and diagnosis

The controlled wrapped sentence is transcribed correctly, but Tesseract puts `parcel.` in another block/paragraph. The existing conservative grouping honors that boundary and sends two fragments to NLLB. The idiom case, `We got this!`, returns no text under both automatic and sparse layout. A local diagnostic reproduces those results. Switching the full-image PSM to single block does not fix the missed text, and plain rectangular crops can turn bubble borders into punctuation.

## Change

`src/light-regions.ts` analyzes a downsampled canvas grid with a maximum side of 1024 pixels. Four-connected near-white components provide **pixel hints**, not semantic speech-bubble detection. Edge-connected backgrounds, page-sized fields, tiny patches and thin irregular components are ignored. At most 32 candidates survive. An OCR line must fit a candidate and sample its actual bright interior; a shared bounding rectangle alone is insufficient.

Ordinary successful OCR is retained. Its lines may receive a generated `visualRegionId`. Translation can then reconnect a nearby unfinished sentence across OCR block/paragraph boundaries when both rows share that pixel region and the next row is a lowercase continuation. Existing size/gap/alignment/overlap and character/line budgets still apply. Different visual regions stay separate, including when an unassigned row would otherwise bridge them. Complete independent paragraphs and boundaries without pixel support remain separate. These are conservative English/Indonesian Latin-text rules, not general scene understanding.

If both ordinary layout attempts return empty text, bounded region recovery can run. The mask fills interior holes to retain the actual glyph pixels, excludes the surrounding outline/artwork and insets the boundary by one analysis-grid cell. Tesseract runs single-block OCR on a natural-resolution masked crop. Recovery accepts actual OCR with at least two letters/numbers and page confidence at or above the existing 60% threshold. Weak/punctuation-only guesses are rejected; confidence and low-confidence line flags are retained.

Recovery attempts at most **4 regions**, **2 million natural pixels per crop**, and **3 million pixels total**. Oversized/additional candidates are skipped; returned recovered text is marked partial when candidates were skipped. The existing 90-second OCR deadline and hard cancellation by closing the offscreen host cover all passes. Each temporary canvas is cleared, the OCR worker terminates before inference, and image staging is deleted as before. Optional layout-analysis failure preserves otherwise readable original OCR.

## Coordinates and messages

All displayed boxes remain in the original normalized image's natural coordinates. The analysis grid supplies hints/masks only. Recovery retains source resolution, then adds each crop's source x/y offset to its actual OCR boxes. Global segment IDs are regenerated and crop-specific block/paragraph identities stay distinct. Existing text/line caps and language capture apply to combined output.

Schema version 1 messages are unchanged. Additive fields in the returned `image.ocr` are:

```json
{
  "lines": [
    {
      "segmentId": "s1",
      "blockId": "b1",
      "paragraphId": "b1p1",
      "visualRegionId": "v1",
      "text": "Actual OCR text",
      "box": { "x": 100, "y": 80, "width": 200, "height": 35 }
    }
  ],
  "layout": {
    "candidates": 1,
    "recoveryAttempts": 0,
    "recoveredRegions": 0,
    "layoutMs": 20,
    "recoveryMs": 0
  }
}
```

This JSON illustrates the additive fields, not a complete OCR response or hardcoded result. Pixel labels, masks and crop bytes remain inside the offscreen document; they are not placed in runtime JSON or persistent text history. IDs are optional and existing consumers can ignore them. `ocr.elapsedMs` includes layout/recovery work; the new timings distinguish that cost. Benchmark fingerprints include the new pixel-analysis source.

## Rendering contract

Retain the existing Phase 5/context-fix design: the image stays in place, translated regions use their source union geometry and opaque backing, and full selectable text remains in Text details. New recovered boxes must align with the original pixels rather than the crop origin. Test at 375×812, 768×900 and 1440×900, retain keyboard controls and warnings/readable details for text that cannot fit. The visual style and primary user flow are unchanged. New diagnostics stay in result metadata; users receive the same progress, empty/error, partial and success controls. No additional permission flow is introduced.

## Validation and limits

See [current QA and measurements](evidence/region-ocr-fix/QA.md) and the [unchanged 0.6.0 baseline](evidence/phase-7-benchmark/QA.md). The development-only `scripts/ocr-layout-probe.mjs` compares local WASM layout modes, annotation rectangles for diagnosis, and independently pixel-derived masks. Production code and browser inference never receive those annotations or expected words.

The heuristic can miss open, touching, tinted, dark or very large bubbles; other bright shapes can be candidates. It only performs recovery when full-image OCR is empty, so missing individual bubbles on an otherwise readable image remains a limitation. Crops near a boundary may lose pixels because of the conservative inset. Broader real-comic/holdout coverage and false-positive evaluation remain necessary. The known `itis` word-joining and NLLB's interjection/nonstandard-word issues are not corrected by rewriting transcripts. Cold verification/loading and general model latency remain separate Phase 7 work; this change does not claim that the GPU is the user's bottleneck or that the extension is ready for public/commercial release.
