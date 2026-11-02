# Carryover Labs

Carryover turns years of lab reports in Polish, German and English into one timeline a patient can bring to a short doctor's appointment. Every chart point links back to the page it came from. It does not diagnose, interpret results or give medical advice.

Open `/demo` for an account-free, entirely fictional sample: Jane Doe, an invented patient with 10 lab documents from 2012–2024 in three languages (Polish PDFs from two labs, a German report and an English fax, both photographed). Every result row on them is shown. Every name, lab and address on them is made up; "See initial tests" shows the original pages. The charts are prepared data; "Watch Meta's AI read a page" sends one of two blacked-out sample pages through the pipeline (Muse Spark, then Muse Wonder) and shows Meta's recorded answers for it, line by line.

## Try the sample patient

No lab reports at hand? On **Documents**, "Try the sample patient" adds Jane Doe's documents, the same ten as on `/demo`, to the normal flow: the privacy check on your device, your approval, then reading and charting.

**The sample patient's model responses are real, just cached.** Muse Spark's transcription of each of her 24 pages and Muse Wonder's identity of every test name on them were recorded once from the Meta Model API with `node scripts/record-samples.mjs`, and are committed in [`api/samples/recorded.json`](api/samples/README.md). For a sample page, the server replays the recorded answer through the same code as a live one (schema checks, dates, units, charts) instead of calling Meta. So the sample patient costs nothing, needs no API key, keeps working when today's spending limit is reached, and returns at once. The demo page replays the same recordings. They were made from the sample pages as published, so hiding more on them doesn't change what comes back.

Your own documents are always read live, and nothing about them is cached.

## How it works

1. **Add a file.** Photos, PDFs, Word and text files are read in the browser (Tesseract OCR, pdf.js, mammoth).
2. **Hide personal details.** A local model and rules suggest names, addresses and identifiers to hide. The person checks every page, turns sideways pages upright, hides more by tapping words or drawing boxes, and approves. Masks are burned into fresh page images.
3. **Read the results.** Each approved, redacted page image is queued as a job for **Muse Spark**, which transcribes the lab table literally. The browser collects results with a long poll, so slow model calls never hold a request open.
4. **Match tests across languages.** **Muse Wonder** maps the printed test names of the whole batch to one identity per test. Unit conversion and chart building are deterministic server code; the model never supplies numbers.
5. **Bring it to the appointment.** Print the results page or save it as a PDF from the print dialog.

Originals, filenames, OCR text and hidden words never leave the browser. Results are stored in the browser, and "Delete all my data from this browser" in the footer removes them; the API holds a job only in memory, for at most 15 minutes. See [architecture](docs/architecture.md) and [evaluation](docs/evaluation.md).

## Run locally

Use Node 24 (npm 11; `.nvmrc` pins it, and older npm stops with a clear message).

```sh
npm ci
npm --prefix api ci
cp api/.env.example api/.env   # then set META_MODEL_API_KEY (and optionally MODEL_DAILY_BUDGET_USD)
npm run start:api
# in a second terminal
npm start
```

Open http://localhost:4200. Without a key, everything but reading your own documents works: `/demo`, the sample patient and on-device redaction.

## Run with Docker

```sh
docker compose up --build
```

Open http://localhost:3000. The image builds the app and the API for Linux and serves both from one origin. Put `META_MODEL_API_KEY` in `api/.env` (as for a local run) to read your own documents; without it, `/demo`, the sample patient and on-device redaction still work. The port is bound to `127.0.0.1` because the API spends your Meta credits.

## Check the code

```sh
npm run lint            # ESLint for the app, API and scripts
npm run format:check    # Prettier (use `npm run format` to fix)
npm test -- --watch=false
npm --prefix api test
npm run build
npm --prefix api run build
npx playwright install chromium   # once
npm run e2e             # upload → review → approve, the sample patient and the demo, against the built app
```

CI runs the same steps. Tests use synthetic data and stubbed model calls; they never make paid requests. When `api/samples/recorded.json` is present, the API tests also check that it charts every sample document without a model.

## Project layout

| Path                                        | What it does                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/app/extraction`                        | Reads files and runs local OCR                                                            |
| `src/app/pii`                               | Finds personal details (local model worker + rules)                                       |
| `src/app/redaction`, `src/app/review`       | Burns masks into page images; the review screen                                           |
| `src/app/core/local-history.ts`             | Browser storage for approved documents and results                                        |
| `src/app/core/results.service.ts`           | Sends approved pages to the API and saves the answers                                     |
| `src/app/results`                           | Charts, source viewer, corrections, print layout                                          |
| `api/src/batches`, `api/src/jobs`           | Batch job endpoints, Spark pages, Wonder normalization, sample replay, queue, spend limit |
| `api/src/records`                           | Meta model client, unit arithmetic and chart building                                     |
| `api/src/shared`                            | Types and pure helpers used by both the app and the API (`@shared/*` in the app)          |
| `api/samples`, `scripts/record-samples.mjs` | The sample patient's recorded Meta answers, and the script that records them              |
| `e2e`                                       | Browser smoke tests on the built app (Playwright)                                         |

## Deploying

`npm --prefix api start` serves the built app and the API from one origin. Keep the model key on the server and use HTTPS. `ops/` has example nginx and systemd files. Browser storage is not encrypted by the app, so use fictional data for shared demos.

### What a public deployment costs

Only new documents cost money: each page is one Muse Spark call, and each batch a few Muse Wonder calls. `MODEL_DAILY_BUDGET_USD` (default `10`) caps that spending per UTC day for all visitors together. Each call is priced from the token usage Meta reports, at the rates in `api/src/jobs/daily-spend.ts` (per million input / output tokens: Spark $1.25 / $4.25, Wonder $4 / $20; reasoning is billed as output; check them against your Meta billing). While calls run, their worst case is held back, so parallel calls can't overshoot by much. Once the limit is reached, new documents get a plain "try again tomorrow" message until midnight UTC; the sample patient and the demo keep working, because they never call Meta. There is no other rate limiting.

To re-record the sample patient after changing a prompt, a schema or a model: `npm --prefix api run build && node scripts/record-samples.mjs --refresh` (about $1–2), then commit `api/samples/recorded.json`.
