# Evaluation

How well the pipeline reads, names and charts lab results, measured on the sample patient. These are engineering checks on one patient's documents, not clinical validation or a privacy guarantee.

## Meta's models on the sample patient

`node eval/score-samples.mjs` (after `npm --prefix api run build`) scores Meta's answers for all ten sample documents against rows checked by hand. It needs no key and makes no calls: the answers are the ones recorded in `api/samples/recorded.json`, the same real Muse Spark and Muse Wonder answers the app replays for the sample patient. Each answer goes through the server's own code, as in the app: page parsing, test identification, dates, unit conversion and charts.

**The checked set.** `src/app/core/demo-data.ts` holds every result row printed on the 10 documents (24 pages, 2012–2024, Polish, German and English; two Polish PDF layouts, a German phone photo and an English fax): 289 rows, each transcribed by hand and checked against the page image, with its test and date. The `/demo` charts are built from them.

**How rows are paired.** Each checked row is paired with the row Muse Spark read at the same place on the same page (the nearest outline, preferring the same printed name), never by value. Values, units and names compare as printed, ignoring case, spacing, decimal separators and a trailing flag (`eval/compare.mjs`). Charted values compare in the same unit, so a value charted in mg/dL still matches its checked value in µmol/L.

Answers recorded on 2 November 2026 with `muse-spark-1.3` and `muse-wonder-1.0`:

| Step        | Measure                                              |          Result |
| ----------- | ---------------------------------------------------- | --------------: |
| Muse Spark  | Rows found                                           |  289/289 (100%) |
| Muse Spark  | … with the name as checked                           | 288/289 (99.7%) |
| Muse Spark  | Values as printed                                    |  289/289 (100%) |
| Muse Spark  | Units as printed                                     |  289/289 (100%) |
| Muse Spark  | Extra rows that are not results                      |               0 |
| Muse Wonder | Charted readings named as the same test              |  282/282 (100%) |
| Server      | Readings the checked set holds for review, also held |      6/6 (100%) |
| Server      | Results in words, kept as words                      |      1/1 (100%) |
| End to end  | Charted value equals the checked value               |  282/282 (100%) |
| End to end  | Charted on the checked date                          |  282/282 (100%) |
| End to end  | Tests in several reports kept on one line            |    45/45 (100%) |
| End to end  | … of them printed under different names              |    24/24 (100%) |

Notes on the table:

- **The one name difference is Spark being more precise.** One TRAb result is printed under a section heading, next to the label "Wynik badania:" ("Result:"). The checked row uses that label; Spark gave the test's own name, "P/c. p. receptorom TSH (TRAb)". The value, unit and chart are correct.
- **Muse Wonder named 100 distinct printed names:** 96 matched to the catalogue and 4 proposed as new tests (non-HDL cholesterol, LDH, band neutrophils %, CKD stage), none left unresolved. A new test counts as the same test when its name matches the checked one: Wonder's "band-neut-pct" and the checked "bands-pct" are both "Band neutrophils %".
- **The 6 readings held for review** have a unit that can't be verified: eGFR printed in "ml/Min.", and five results printed with no unit. The server holds them with a reason instead of charting them, and the person can check the source and enter the unit.
- **Merging across reports is the core feature.** 45 tests appear in more than one report. Every one stays on a single line, including 24 printed under different names, such as "Erytrocyty", "Erythrozyten i. VB." and "RCC" for red blood cells.

**What this does and doesn't show.** These ten documents were in front of us while the prompts, the catalogue and the rules were written, so this is the development set, not a held-out test. It shows the whole pipeline works end to end on real, varied layouts in three languages. It doesn't predict accuracy on layouts never seen before. Spark's answers are recorded once; a new recording can differ slightly, which `node eval/score-samples.mjs` measures again. `--rows` lists every row that differs, and the full comparison is written to `artifacts/evaluation/samples.json`.

## Live Meta models

`node eval/check-pipeline-models.mjs` (after `npm --prefix api run build`, with `META_MODEL_API_KEY` set) sends the German phone photo of the sample patient, `public/samples/live/german-cumulative.jpg`, with its identifiers blacked out, to Muse Spark upright and rotated 90° and 180°, then normalizes the upright result with Muse Wonder. It scores each answer against the hand-checked rows in `eval/fixtures/jane-doe-002.truth.json` (28 rows) and prints a table with round-trip times. It makes paid calls (three Spark pages and one Wonder call); `--upright` makes one Spark call only. Use it to check how Spark copes with sideways photos, which the recorded answers don't cover.

## Automated tests

`.github/workflows/check.yml` runs lint, formatting, the app's unit tests, the API tests, both builds, the evaluation above and the browser tests. None of them make paid calls. Among them:

- **Sample recording.** `api/src/batches/samples.spec.ts` checks the recording still matches the current answer schemas and charts every sample document, alone and all together, with no model.
- **Model boundary.** `api/src/records/meta-model.spec.ts` covers strict JSON schemas, answers cut off at the token limit, busy retries, and provider text kept out of errors.
- **Spending limit.** `api/src/jobs/daily-spend.spec.ts` covers the daily dollar cap, including calls still running.
- **Specimens and forms.** `api/src/batches/specimens.spec.ts`: "Kalium", "Harnstoff" and "Mocznik" stay blood tests; ionized and total calcium and direct and total bilirubin get separate lines; a cell count printed as "3,200" is held for review instead of being read as 3.2.
- **Browser flow.** `e2e/smoke.spec.ts`: a box drawn on a photo and burned into the only image sent; the sample patient read and charted with no key; the demo replay.

## Logs and tracing

The API logs each model call's total time, the time until response headers and the token counts Meta reports, never content. A failed call logs its reason in our own words (for example `HTTP 503` or `the answer was cut off at 16000 tokens`), never the provider's text. Each normalization logs its size; the sample patient's ten documents log `normalize-batch: 289 rows, 100 questions (100 recorded), 2 specimens, 0 calls, 0 unresolved`.

Set `MODEL_TRACE_DIR` (for example `../tmp/model-trace`) during development to write every model request, its page image and the raw answer to that folder. Leave it unset otherwise.

## Known limitations

- Nothing checks the person's boxes: anything left visible on an approved page is sent.
- Spark can omit or misread rows, and its regions can be inaccurate. The source page is always one tap away.
- A value like `1,234` is read as 1.234 regardless of the document's locale; for cell counts it's held for review instead.
- A test gets a separate line only for a different body fluid (urine, CSF), form (free, total, ionized, direct, indirect) or a percentage; the analyser or method doesn't split it.
- When the collection date isn't printed, a reading is dated by the best other printed date of its report (received, performed, registered, issued, in that order), and the table marks the later kinds. Two different dates of the best kind leave it undated.
- An ambiguous date such as 01/06/2012 is read in the day/month order the batch's other dates settle; without that evidence it stays undated.
- Browser storage is limited, not encrypted by the app, and tied to one browser profile.
- The interface and PDF are in English only.
