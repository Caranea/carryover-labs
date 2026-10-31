# Carryover Labs

Carryover turns years of lab reports in Polish, German and English into one timeline a patient can bring to a short doctor's appointment. Every chart point links back to the page it came from. It does not diagnose, interpret results or give medical advice.

Open `/demo` for an account-free, entirely fictional sample. It is prepared data and does not call an AI model.

## How it works

1. **Add a file.** Photos, PDFs, Word and text files are read in the browser (Tesseract OCR, pdf.js, mammoth).
2. **Hide personal details.** A local model and rules suggest names, addresses and identifiers to hide. The person checks every page, hides more by tapping words or drawing boxes, and approves. Masks are burned into fresh page images.
3. **Read the results.** Each approved, redacted page image goes to **Muse Spark** for a literal transcription of the lab table.
4. **Match tests across languages.** **Muse Wonder** maps the printed test names of the whole batch to one identity per test. Unit conversion and chart building are deterministic server code; the model never supplies numbers.
5. **Prepare the appointment.** Choose the groups to bring, add questions, and download a PDF generated on the device.

Originals, filenames, OCR text and hidden words never leave the browser. Results are stored in the browser only. See [architecture](docs/architecture.md) and [evaluation](docs/evaluation.md).

## Run locally

Use Node 24 (npm 11).

```sh
npm ci
npm --prefix api ci
cp api/.env.example api/.env   # then set META_MODEL_API_KEY
npm run start:api
# in a second terminal
npm start
```

Open http://localhost:4200. Without a key the app still works for `/demo` and local redaction; live results return "unavailable".

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

| Path                                     | What it does                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `src/app/extraction`                     | Reads files and runs local OCR                                                   |
| `src/app/pii`                            | Finds personal details (local model worker + rules)                              |
| `src/app/redaction`, `src/app/review`    | Burns masks into page images; the review screen                                  |
| `src/app/core/local-history.ts`          | Browser storage for approved documents and results                               |
| `src/app/core/results.service.ts`        | Sends approved pages to the API and saves the answers                            |
| `src/app/results`, `src/app/appointment` | Charts, source viewer, corrections, PDF export                                   |
| `api/src/demo`                           | Stateless endpoints: Spark transcription and Wonder normalization                |
| `api/src/records`                        | Meta model client, unit arithmetic and chart building                            |
| `api/src/shared`                         | Types and pure helpers used by both the app and the API (`@shared/*` in the app) |

## Deploying

`npm --prefix api start` serves the built app and the API from one origin. Keep the model key on the server and use HTTPS. `ops/` has example nginx and systemd files. Browser storage is not encrypted by the app, so use fictional data for shared demos.
