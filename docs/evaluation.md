# Evaluation

Measured on 31 October 2026 with synthetic or previously redacted fixtures. These are small checks, not clinical validation or a privacy guarantee.

## Local privacy check

`node scripts/check-pipeline-privacy.mjs` serves a browser test on a 2400 × 1800 synthetic page with five identity fields and a lab table. It uses the production OCR service, privacy worker, rules and burn function.

| Page orientation |    OCR | Detection | Burned PNG | Identifiers fully covered |
| ---------------- | -----: | --------: | ---------: | ------------------------: |
| Upright          | 1.15 s |    0.27 s |     0.08 s |                       5/5 |
| 90°              | 3.67 s |    0.53 s |     0.08 s |                       0/5 |
| 180°             | 1.55 s |    0.44 s |     0.06 s |                       0/5 |
| 270°             | 3.73 s |    0.48 s |     0.07 s |                       0/5 |

Automatic detection fails on rotated pages because OCR runs once without orientation detection. Manually drawn boxes burned correctly at all four orientations. No clinical region was masked.

## Live Meta models

`node scripts/check-pipeline-models.mjs` (after `npm --prefix api test` compiles the API) sends one previously redacted German report page, kept locally in `artifacts/`, to Muse Spark at three rotations, then normalizes the rows with Muse Wonder. It makes paid calls.

| Page orientation | Spark round trip | Rows | Printed values matching the 28-row reference | Rows marked uncertain |
| ---------------- | ---------------: | ---: | -------------------------------------------: | --------------------: |
| Upright          |           32.8 s |   28 |                                        28/28 |                     3 |
| 90°              |           36.9 s |   28 |                                        28/28 |                     8 |
| 180°             |           47.8 s |   28 |                                        26/28 |                     4 |

Value comparison ignores whitespace and decimal separators; it does not audit names, units, ranges, dates or regions. Wonder normalized the 84 rows (59 distinct combinations) in 44.8 s. The report prints order and report dates but no collection date, so every reading correctly stayed in "Readings to check" instead of using another date.

A separate `--normalization-only` run on ten invented rows took 10.0 s. Polish, German and English serum glucose shared one series; absolute monocyte counts and percentages stayed separate; a CRP comparator survived; a CRP row without a unit stayed unresolved.

## Known limitations

- Rotated or difficult pages need careful manual masking.
- Spark can omit or misread rows, and its regions can be inaccurate. The source page is always available for checking.
- "Find missed readings" re-runs the same transcription on the saved page, so it rarely finds rows the first pass missed.
- A value like `1,234` is read as 1.234 regardless of the document's locale.
- Specimen or method wording that differs between labs keeps otherwise identical tests in separate charts.
- Only an unambiguous collection date puts a reading on a timeline.
- Browser storage is limited, not encrypted by the app, and tied to one browser profile.
- The interface and PDF are in English only.
