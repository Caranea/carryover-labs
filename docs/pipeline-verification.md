# Pipeline verification — 31 October 2026

The implemented path is one local privacy OCR pass → review and permanent image blackouts → standard `muse-spark-1.3` per page → immediate browser save → standard `muse-wonder-1.0` batch mapping → existing server unit arithmetic. No server persistence or batch retrieval was added.

## Automated checks

- Browser: **225 tests passed, 30 files**, using `npm test -- --watch=false`.
- Server: **111 tests passed, 27 suites**, using `npm --prefix api test`.
- `npm run build` and `npm --prefix api run build` passed. The browser initial bundle is 601.57 kB, 1.57 kB over its warning budget; existing pdfmake CommonJS warnings remain.
- `git diff --check` passed.

Coverage includes a single OCR invocation without rotation, original-coordinate scaling, ignoring PDF text layers, burned image geometry, explicit approval, request-field privacy, metadata stripping, per-page persistence, bounded concurrency, refresh/retry of unfinished pages only, waiting for review before normalization, late deletion/replacement responses, immutable transcription through corrections, source-image recovery acceptance, mapping coverage, comparators, date roles, distinct test forms/specimens, and unsupported/missing units. These are controlled tests, not evidence that arbitrary model readings are correct.

## Real local privacy check

`node scripts/check-pipeline-privacy.mjs` serves a local browser test at `http://127.0.0.1:4294`. Run its button with the prepared local model assets. It uses the production OCR service, GPU/FP16 privacy worker, detection rules and full-resolution burn function. All personal details in this test are invented.

The 2400 × 1800 synthetic page contains five identity fields and a clinical table. Each orientation gets exactly one OCR pass, limited to a 2000-pixel longest side, with boxes scaled back to the original page. Coverage checks the actual printed glyph pixels; manual masking checks every pixel inside the identity regions.

| Input orientation | Local OCR | PII detection* | Burned PNG preparation | Fully covered identifiers | Clinical regions masked |
| --- | ---: | ---: | ---: | ---: | ---: |
| Upright | 1.147 s | 0.268 s | 0.079 s | 5/5 | 0 |
| 90° | 3.668 s | 0.530 s | 0.081 s | 0/5 | 0 |
| 180° | 1.547 s | 0.442 s | 0.063 s | 0/5 | 0 |
| 270° | 3.728 s | 0.484 s | 0.069 s | 0/5 | 0 |

*The harness's PII interval includes encoding its synthetic input image. Privacy model setup took a separate 3.728 s. OCR initialization is included in the first OCR interval; later passes reuse the worker. This small synthetic table is not directly comparable to the earlier 28.8 s/image measurement or a large, dense photograph.

**Automatic PII detection failed on all three rotated variants. Upload still requires explicit approval.** The single Approve button confirms the reviewed copy; there is no additional acknowledgement checkbox or yellow warning box. Manual boxes remain available for missed identifiers. Manually drawn regions burned to fully black pixels in the correct original-image coordinates at all four orientations. No orientation detection or OCR rotation retry was restored. The upright result does not establish privacy reliability on other layouts.

Local numeric evidence is saved in the ignored `artifacts/pipeline-verification/privacy-timings.json`.

## Live Spark and Wonder checks

After compiling the server tests, `node scripts/check-pipeline-models.mjs` uses the existing configured Meta integration and the previously reviewed redacted German report fixture. It sends one page per call, with no original PDF, original filename or OCR. Rotations are test inputs only. No unredacted document was sent.

| Redacted report orientation | Preparation, provider upload and Spark response | Rows returned | Printed values matching the 28-row reference | Rows marked uncertain |
| --- | ---: | ---: | ---: | ---: |
| Upright | 32.840 s | 28 | 28/28 | 3 |
| 90° | 36.914 s | 28 | 28/28 | 8 |
| 180° | 47.812 s | 28 | 26/28 | 4 |

Value comparison ignores whitespace and decimal-separator differences. It is not a complete audit of names, units, ranges, dates or regions. The upside-down discrepancies were reference rows 8 and 16; one was not flagged uncertain. Every orientation retained the bounded result. These timings include server pixel preparation and the provider round trip, not a separate browser-to-API upload measurement. The browser now logs its combined upload/Spark interval during normal use.

Wonder normalized the 84 observations from these three page variants in **44.758 s**, mapping 59 distinct printed context combinations. This fixture prints order/report dates but no explicit collection date. All observations remained visible for review and no timeline points were created; an order/report date was not substituted to fill the gap.

A separate live `--normalization-only` run used ten invented observations and took **9.965 s**. Three Polish/German/English serum-glucose observations shared one series, absolute monocyte counts and percentages stayed separate, the bounded CRP comparator survived, and a missing-unit CRP observation remained unresolved. The source measurements were unchanged. Unit conversion factors came from the existing server utility, never the model.

Timing/count summaries are in the ignored `artifacts/pipeline-verification/model-timings.json`, `extraction-checks.json` and `synthetic-normalization.json`. The directory also contains local redacted transcription outputs for inspection; these are not routine logs. Rerunning the live script incurs provider calls.

## Remaining limits

- Rotated or difficult pages require careful manual privacy review. Spark's ability to read a page says nothing about the local detector's ability to protect its identities.
- Spark can omit or misread rows and can return inaccurate regions. Schema and bounds checks do not prove correspondence to the pixels. Opening the full saved source remains available when a region is absent.
- Unknown specimen/method wording is conservatively kept in separate series. Ambiguous mappings and unsupported units remain visible for correction; no model factor can authorize conversion.
- Only an unambiguous collection date enters a timeline automatically. Printed order/report dates remain in the original transcription.
- Existing approved image saves are reused without local OCR. Legacy text-only saves lacking an approved raster need to be added and reviewed again. Browser storage capacity and eviction remain existing constraints.
- The server can validate and strip a supplied raster; it cannot independently prove that a client reviewed or sufficiently redacted it. The application enforces that approval boundary in its existing browser flow.
