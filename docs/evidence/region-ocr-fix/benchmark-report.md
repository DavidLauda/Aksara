# Aksara local benchmark

Run: 2026-11-07T02-25-59-502Z. Extension 0.6.1; Chromium 156.0.8078.4.

This starter corpus has **2 real panels** and **8 controlled synthetic cases**. Results must remain separate. They do not establish representative real-comic accuracy.

Execution completed: true; finished requests: 20; runtime failures: 0. This is an execution status, not a quality pass.

Cold means the dedicated inference worker was terminated before the request; model files and browser/OS disk caches remain. Warm immediately repeats the same pixels without release. Stage timings come from actual OCR/NLLB; wall time also includes acquisition/message/UI polling overhead. Memory sampling: enabled, with observer overhead. No power/thermal controls; one cold/warm sample is not a statistical latency guarantee.

| Case | Source kind | Mode/repeat | Execution | Wall s | OCR s | Verify s | Load s | Inference s | Calls | CER | WER |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| real-package | real | cold/1 | completed | 29.22 | 0.68 | 12.30 | 4.44 | 11.55 | 1 | 0.0% | 0.0% |
| real-package | real | warm/1 | completed | 10.79 | 0.53 | 0.00 | 0.00 | 10.09 | 1 | 0.0% | 0.0% |
| real-two-bubbles | real | cold/1 | completed | 38.61 | 0.52 | 12.16 | 4.12 | 21.56 | 2 | 0.0% | 0.0% |
| real-two-bubbles | real | warm/1 | completed | 23.76 | 0.55 | 0.00 | 0.00 | 22.92 | 2 | 0.0% | 0.0% |
| wrapped-parcel | synthetic | cold/1 | completed | 29.36 | 0.56 | 12.30 | 4.67 | 11.70 | 1 | 0.0% | 0.0% |
| wrapped-parcel | synthetic | warm/1 | completed | 10.80 | 0.59 | 0.00 | 0.00 | 10.02 | 1 | 0.0% | 0.0% |
| two-speakers | synthetic | cold/1 | completed | 37.16 | 0.59 | 12.20 | 4.24 | 19.89 | 2 | 2.5% | 22.2% |
| two-speakers | synthetic | warm/1 | completed | 18.29 | 0.58 | 0.00 | 0.00 | 17.46 | 2 | 2.5% | 22.2% |
| negation | synthetic | cold/1 | completed | 26.12 | 0.55 | 12.19 | 4.19 | 9.03 | 1 | 0.0% | 0.0% |
| negation | synthetic | warm/1 | completed | 8.83 | 0.56 | 0.00 | 0.00 | 8.08 | 1 | 0.0% | 0.0% |
| idiom | synthetic | cold/1 | completed | 25.12 | 0.62 | 12.16 | 4.26 | 7.81 | 1 | 0.0% | 0.0% |
| idiom | synthetic | warm/1 | completed | 7.79 | 0.72 | 0.00 | 0.00 | 6.96 | 1 | 0.0% | 0.0% |
| punctuation | synthetic | cold/1 | completed | 28.96 | 0.57 | 12.22 | 4.24 | 11.82 | 1 | 0.0% | 0.0% |
| punctuation | synthetic | warm/1 | completed | 10.77 | 0.56 | 0.00 | 0.00 | 10.03 | 1 | 0.0% | 0.0% |
| caption-and-dialogue | synthetic | cold/1 | completed | 34.18 | 0.57 | 12.20 | 4.21 | 16.89 | 2 | 0.0% | 0.0% |
| caption-and-dialogue | synthetic | warm/1 | completed | 15.77 | 0.58 | 0.00 | 0.00 | 14.93 | 2 | 0.0% | 0.0% |
| small-text | synthetic | cold/1 | completed | 27.67 | 0.58 | 12.18 | 4.13 | 10.64 | 1 | 0.0% | 0.0% |
| small-text | synthetic | warm/1 | completed | 10.80 | 0.57 | 0.00 | 0.00 | 10.02 | 1 | 0.0% | 0.0% |
| indonesian-negation | synthetic | cold/1 | completed | 27.28 | 0.39 | 12.13 | 3.95 | 10.63 | 1 | 0.0% | 0.0% |
| indonesian-negation | synthetic | warm/1 | completed | 10.35 | 0.37 | 0.00 | 0.00 | 9.79 | 1 | 0.0% | 0.0% |

CER includes normalized punctuation/spaces; WER uses Unicode word tokens. Both normalize NFKC, case, smart apostrophes and whitespace. Global OCR scores include reading-order errors. Per-region OCR and pairwise grouping measurements are in report.json. Empty denominators are null, not a perfect score. Translation meaning is **not automatically graded**. Use review-template.json: adequacy 0=unusable to 4=meaning preserved, fluency 0=unreadable to 4=natural, context 0=wrong sense/speaker to 4=preserved. Leave uncertain ratings null and record reviewer/notes.

### real-package · cold · repeat 1

- Expected source: We got this mysterious package.
- OCR: We got this mysterious package.
- Actual translation: Kami punya paket misterius ini.
- Meaning guide (equivalent wording is valid): Kami mendapat paket misterius ini.
- Review notes: Got refers to receiving a package, not encouragement. Kami/kita depends on the audience; both can be valid.
- Grouping: {"truePairs":3,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### real-package · warm · repeat 1

- Expected source: We got this mysterious package.
- OCR: We got this mysterious package.
- Actual translation: Kami punya paket misterius ini.
- Meaning guide (equivalent wording is valid): Kami mendapat paket misterius ini.
- Review notes: Got refers to receiving a package, not encouragement. Kami/kita depends on the audience; both can be valid.
- Grouping: {"truePairs":3,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### real-two-bubbles · cold · repeat 1

- Expected source: Huh? There's nothing inside. / It's just an empty cardbox.
- OCR: Huh? There's nothing inside. It's just an empty cardbox.
- Actual translation: Tidak ada apa-apa di dalam. Ini hanya kotak kartu kosong.
- Meaning guide (equivalent wording is valid): Hah? Tidak ada apa-apa di dalamnya. / Ini hanya kotak kardus kosong.
- Review notes: Preserve the interjection and negation. Cardbox is the original nonstandard spelling; the Indonesian reference is an interpretation, not an authoritative exact answer.
- Grouping: {"truePairs":6,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### real-two-bubbles · warm · repeat 1

- Expected source: Huh? There's nothing inside. / It's just an empty cardbox.
- OCR: Huh? There's nothing inside. It's just an empty cardbox.
- Actual translation: Tidak ada apa-apa di dalam. Ini hanya kotak kartu kosong.
- Meaning guide (equivalent wording is valid): Hah? Tidak ada apa-apa di dalamnya. / Ini hanya kotak kardus kosong.
- Review notes: Preserve the interjection and negation. Cardbox is the original nonstandard spelling; the Indonesian reference is an interpretation, not an authoritative exact answer.
- Grouping: {"truePairs":6,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### wrapped-parcel · cold · repeat 1

- Expected source: We found a strange little parcel.
- OCR: We found a strange little parcel.
- Actual translation: Kami menemukan paket kecil yang aneh.
- Meaning guide (equivalent wording is valid): Kami menemukan sebuah paket kecil yang aneh.
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":3,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### wrapped-parcel · warm · repeat 1

- Expected source: We found a strange little parcel.
- OCR: We found a strange little parcel.
- Actual translation: Kami menemukan paket kecil yang aneh.
- Meaning guide (equivalent wording is valid): Kami menemukan sebuah paket kecil yang aneh.
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":3,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### two-speakers · cold · repeat 1

- Expected source: Did you open it? / No, it is still sealed.
- OCR: Did you open it? No, itis still sealed.
- Actual translation: Apa kau membukanya? Tidak, masih tertutup.
- Meaning guide (equivalent wording is valid): Apakah kamu sudah membukanya? / Belum, benda itu masih tersegel.
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### two-speakers · warm · repeat 1

- Expected source: Did you open it? / No, it is still sealed.
- OCR: Did you open it? No, itis still sealed.
- Actual translation: Apa kau membukanya? Tidak, masih tertutup.
- Meaning guide (equivalent wording is valid): Apakah kamu sudah membukanya? / Belum, benda itu masih tersegel.
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### negation · cold · repeat 1

- Expected source: Don't open that box!
- OCR: Don't open that box!
- Actual translation: Jangan buka kotak itu!
- Meaning guide (equivalent wording is valid): Jangan buka kotak itu!
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### negation · warm · repeat 1

- Expected source: Don't open that box!
- OCR: Don't open that box!
- Actual translation: Jangan buka kotak itu!
- Meaning guide (equivalent wording is valid): Jangan buka kotak itu!
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### idiom · cold · repeat 1

- Expected source: We got this!
- OCR: We got this!
- Actual translation: Kita bisa melakukannya!
- Meaning guide (equivalent wording is valid): Kita pasti bisa!
- Review notes: Here the isolated exclamation is encouragement. Contrast with receiving a package in real-package.
- Grouping: {"truePairs":0,"mergedPairs":0,"splitPairs":0,"precision":null,"recall":null,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### idiom · warm · repeat 1

- Expected source: We got this!
- OCR: We got this!
- Actual translation: Kita bisa melakukannya!
- Meaning guide (equivalent wording is valid): Kita pasti bisa!
- Review notes: Here the isolated exclamation is encouragement. Contrast with receiving a package in real-package.
- Grouping: {"truePairs":0,"mergedPairs":0,"splitPairs":0,"precision":null,"recall":null,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### punctuation · cold · repeat 1

- Expected source: Wait... Is that mine?
- OCR: Wait... Is that mine?
- Actual translation: Tunggu... itu milikku?
- Meaning guide (equivalent wording is valid): Tunggu... Apakah itu milikku?
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### punctuation · warm · repeat 1

- Expected source: Wait... Is that mine?
- OCR: Wait... Is that mine?
- Actual translation: Tunggu... itu milikku?
- Meaning guide (equivalent wording is valid): Tunggu... Apakah itu milikku?
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### caption-and-dialogue · cold · repeat 1

- Expected source: Later that night. / Where is the key?
- OCR: Later that night. Where is the key?
- Actual translation: Kemudian malam itu. Dimana kuncinya?
- Meaning guide (equivalent wording is valid): Malam harinya. / Di mana kuncinya?
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### caption-and-dialogue · warm · repeat 1

- Expected source: Later that night. / Where is the key?
- OCR: Later that night. Where is the key?
- Actual translation: Kemudian malam itu. Dimana kuncinya?
- Meaning guide (equivalent wording is valid): Malam harinya. / Di mana kuncinya?
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### small-text · cold · repeat 1

- Expected source: Please leave the package by the door.
- OCR: Please leave the package by the door.
- Actual translation: Tolong tinggalkan paket di depan pintu.
- Meaning guide (equivalent wording is valid): Tolong letakkan paketnya di dekat pintu.
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### small-text · warm · repeat 1

- Expected source: Please leave the package by the door.
- OCR: Please leave the package by the door.
- Actual translation: Tolong tinggalkan paket di depan pintu.
- Meaning guide (equivalent wording is valid): Tolong letakkan paketnya di dekat pintu.
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### indonesian-negation · cold · repeat 1

- Expected source: Jangan buka kotak itu!
- OCR: Jangan buka kotak itu!
- Actual translation: Don't open that box!
- Meaning guide (equivalent wording is valid): Do not open that box!
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

### indonesian-negation · warm · repeat 1

- Expected source: Jangan buka kotak itu!
- OCR: Jangan buka kotak itu!
- Actual translation: Don't open that box!
- Meaning guide (equivalent wording is valid): Do not open that box!
- Review notes: Reference is an authored meaning guide; equivalent translations are valid.
- Grouping: {"truePairs":1,"mergedPairs":0,"splitPairs":0,"precision":1,"recall":1,"mergedGroups":[],"splitRegions":[],"missingRegions":[],"unassignedLines":0,"untranslatedLines":0,"multiplyAssignedLines":0}
- Partial result: false; semantic review: pending.

