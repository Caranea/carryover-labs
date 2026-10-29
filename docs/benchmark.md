# Reproducible synthetic benchmark

Every identity, value and layout in `fixtures/synthetic-labs/cases.mjs` was invented from scratch. No private medical fixtures or their findings were used. These measurements are engineering regression evidence, not clinical validation or a population estimate of personal-detail detection.

## Run

```powershell
npm --prefix api run build
npm run benchmark
npm run check:flow
# Actual local Tesseract OCR, with installed Polish/German/English language packs:
npm run benchmark -- --ocr
npm run check:flow -- --ocr
```

The default benchmark renders ten labelled layouts and sends their positioned words through the production detection, redaction-manifest, extraction and chart-building functions. The OCR version recognizes both a 1600×1000 image and a 960×600 JPEG at quality 65 for each layout. No external inference is used. Outputs, image hashes and individual failures are saved under ignored `artifacts/benchmark/`.

Fixtures cover Polish, German and English tables, inline values, extreme numeric values, same-day repeats and comparison signs, ambiguous dates, a split row, a missing unit, and hostile instructions embedded as document text. The fixture set is small and deliberately contains challenges. Generated images omit the lighting, skew, handwriting, stamps, cropping and camera-processing variation of actual phone photos. Fonts and OCR outcomes may vary by platform; record the output hashes when comparing runs.

## Results measured on 29 October 2026

| Measurement | Positioned text | Actual OCR, clean + small images |
| --- | ---: | ---: |
| Expected rows | 20 | 40 |
| Extracted rows | 19 | 38 |
| Rows with exact name/value/comparator/unit/date | 19 | 23 |
| Exact row recall | 95% | 57.5% |
| Exact row precision | 100% | 60.5% |
| Plotted observations | 16 | 19 |
| Incorrect plotted observations against fixture truth | 0 | 0 |
| Held for review | 3 | 19 |
| Labelled personal-name word boxes covered ≥90% | 20/20 | 40/40 |

The split-row fixture is missed by deterministic extraction. OCR frequently confuses `mIU/L` with `mlU/L`, and a small image changed a decimal value. These errors count against exact extraction even when the chart builder safely withholds the row. Zero wrong chart points in this limited set does **not** prove that every future OCR error will be detected.

Privacy coverage compares source-image name boxes against the actual masking geometry, including words missed by OCR. It measures only the invented labelled names in these layouts. It does not measure arbitrary names, handwriting, identity numbers, signatures or re-identification risk. The optional personal-detail NER model is not included.

The benchmark exits unsuccessfully for an incorrect chart point or a failure of the positioned-text decimal, repeat/comparator and ambiguous-date safety anchors. Overall recall is reported separately; low recall is not hidden behind a safety pass.

## Integration evidence

`check:flow` consumes the benchmark's approved visible-word manifest, uploads a synthetic JPEG to an isolated Nest application, verifies independent server masking, no-store headers, account isolation and source preservation, confirms a correction, runs a labelled model test double through the real recovery API, accepts its proposal, retrieves chart records and generates a PDF using the production engine. It checks encryption of every stored content payload. The opaque cache-generation UUID contains no document content and remains plaintext by design.

The OCR-backed run produced four observations, four chart points, seven encrypted payload files and a 33,738-byte PDF. Reports and the PDF are in ignored `artifacts/flow/`. The process uses a temporary encrypted store and removes only that temporary directory afterward. It does not load real application credentials or storage. The model and token verifier are explicit injected test doubles; this is not a real Clerk sign-in, a live Meta evaluation, or an automated browser upload test.

For live Meta evidence, use the separately documented recovery check with its explicit `--live` opt-in. Do not put keys or real documents in CI. The browser's actual PDF download was verified separately on the fictional appointment page.
