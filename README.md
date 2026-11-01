# Carryover Labs

Carryover turns years of lab reports in Polish, German and English into one timeline a patient can bring to a short doctor's appointment. Every chart point links back to the page it came from. It does not diagnose, interpret results or give medical advice.

Open `/demo` for an account-free, entirely fictional sample: Jane Doe, an invented patient with 10 lab documents from 2012–2024 in three languages (Polish PDFs from two labs, a German report and an English fax, both photographed). Every result row on them is shown. Every name, lab and address on them is made up; "See initial tests" shows the original pages. The charts are prepared data; "Watch Meta's AI read a page" sends one of two blacked-out sample pages through the live pipeline (Muse Spark, then Muse Wonder) when the server has a model key.

## How it works

1. **Add a file.** Photos, PDFs, Word and text files are read in the browser (Tesseract OCR, pdf.js, mammoth).
2. **Hide personal details.** A local model and rules suggest names, addresses and identifiers to hide. The person checks every page, turns sideways pages upright, hides more by tapping words or drawing boxes, and approves. Masks are burned into fresh page images.
3. **Read the results.** Each approved, redacted page image is queued as a job for **Muse Spark**, which transcribes the lab table literally. The browser collects results with a long poll, so slow model calls never hold a request open.
4. **Match tests across languages.** **Muse Wonder** maps the printed test names of the whole batch to one identity per test. Unit conversion and chart building are deterministic server code; the model never supplies numbers.
5. **Bring it to the appointment.** Print the results page or save it as a PDF from the print dialog.

Originals, filenames, OCR text and hidden words never leave the browser. Results are stored in the browser, and "Delete all my data from this browser" in the footer removes them; the API holds a job only in memory, for at most 15 minutes. See [architecture](docs/architecture.md) and [evaluation](docs/evaluation.md).

## Run locally

Use Node 24 (npm 11).

```sh
npm ci
npm --prefix api ci
cp api/.env.example api/.env   # then set META_MODEL_API_KEY (and optionally MODEL_CONCURRENCY, MODEL_DAILY_CALLS)
npm run start:api
# in a second terminal
npm start
```

Open http://localhost:4200. Without a key the app still works for `/demo` and local redaction; live results return "unavailable".

## Run with Docker

```sh
docker compose up --build
```

Open http://localhost:3000. The image builds the app and the API for Linux and serves both from one origin. Put `META_MODEL_API_KEY` in `api/.env` (as for a local run) to switch on live reading; without it, `/demo` and on-device redaction still work. The port is bound to `127.0.0.1` because the API spends your Meta credits.

## Check the code

```sh
npm run lint            # ESLint for the app, API and scripts
npm run format:check    # Prettier (use `npm run format` to fix)
npm test -- --watch=false
npm --prefix api test
npm run build
npm --prefix api run build
```

CI runs the same steps. Tests use synthetic data and stubbed model calls; they never make paid requests.

## Project layout

| Path                                  | What it does                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/app/extraction`                  | Reads files and runs local OCR                                                      |
| `src/app/pii`                         | Finds personal details (local model worker + rules)                                 |
| `src/app/redaction`, `src/app/review` | Burns masks into page images; the review screen                                     |
| `src/app/core/local-history.ts`       | Browser storage for approved documents and results                                  |
| `src/app/core/results.service.ts`     | Sends approved pages to the API and saves the answers                               |
| `src/app/results`                     | Charts, source viewer, corrections, print layout                                    |
| `api/src/demo`, `api/src/jobs`        | Batch job endpoints and the in-memory job queue (Spark pages, Wonder normalization) |
| `api/src/records`                     | Meta model client, unit arithmetic and chart building                               |
| `api/src/shared`                      | Types and pure helpers used by both the app and the API (`@shared/*` in the app)    |

## Deploying

`npm --prefix api start` serves the built app and the API from one origin. Keep the model key on the server and use HTTPS. Set `MODEL_DAILY_CALLS` to what your Meta credits allow: anyone who can open the site can send pages, so this cap is what limits spending. `ops/` has example nginx and systemd files. Browser storage is not encrypted by the app, so use fictional data for shared demos.
