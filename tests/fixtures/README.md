# Comic context regressions

`comic-context.png` and `comic-two-bubbles.png` are cropped panels from the screenshot supplied by the user to report the broken sentence-context behavior in Aksara. The artwork is from War and Peas. These local regression fixtures are not extension assets and are not packaged into `dist`.

The first panel contains the wrapped sentence “We got this / mysterious / package.” The second contains two separate bubbles: “Huh? / There's nothing / inside.” and “It's just / an empty / cardbox.” Preserve the original wording, including “cardbox”; these fixtures test actual OCR and contextual translation rather than corrected input strings.

The browser suite must derive text from the pixels, retain paragraph boundaries, translate each region with real cached NLLB and assert grouped source-line membership and union geometry. It must never substitute the expected words for OCR/model output.
