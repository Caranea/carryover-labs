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

## Timing logs

The API logs each model call's total time, the time until response headers, and the token counts reported by Meta, without any content. A failed call logs its reason in our own words (for example `HTTP 503` or `the answer was cut off at 16000 tokens`), never the provider's text.

Each normalization also logs its size, for example `normalize-batch: 547 rows, 184 questions, 1 specimens, 5 calls, 1 unresolved`. A batch is asked about in calls of up to 40 questions, and a call whose answer is cut off is asked again in two halves, so more calls than `questions / 40` means a halving happened.

Meta counts hidden reasoning in the output tokens (`completion_tokens_details.reasoning_tokens`). Measured on the 20-file Jane Doe selection (49 pages, 1 November 2026): Spark used a median of 5,000 output tokens per page (one dense page 15,800, 10,800 of them reasoning; 19 s median, 71 s worst). At full effort Wonder reasoned about 190 tokens per question, so a 150-question call ran out of its 16,000 tokens; with `reasoning_effort: low` it reasons about 40 per question and a 40-question call takes about 15 s.

Set `MODEL_TRACE_DIR` (for example `../tmp/model-trace`) during development to write every model request, its page image and the raw answer to that folder. Leave it unset otherwise.

## Known limitations

- Rotated or difficult pages need careful manual masking.
- Spark can omit or misread rows, and its regions can be inaccurate. The source page is always available for checking.
- A value like `1,234` is read as 1.234 regardless of the document's locale.
- A test gets a separate line only for a different body fluid (urine, CSF), form (free, total) or a percentage; the analyser or method does not split it.
- When the collection date is not printed, a reading is dated by the best other printed date of its report (received, performed, registered, issued, in that order), and the table marks the later kinds. Two different dates of the best kind leave it undated.
- An ambiguous date such as 01/06/2012 is read in the day/month order the batch's other dates settle; without that evidence it stays undated.
- Browser storage is limited, not encrypted by the app, and tied to one browser profile.
- The interface and PDF are in English only.
