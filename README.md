# Carryover Labs

Bring years of lab reports into a short doctor's appointment. Carryover organises Polish, German and English reports into timelines with a link back to each source reading. It does not diagnose, recommend treatment or generate medical advice.

## Try it

Open `/demo` for an account-free, entirely fictional sample. Open a chart point to inspect the source, then choose **Prepare for my appointment** to select sections and download a PDF. The sample is prepared data, not a live AI demonstration.

For your own documents: add files → check hidden personal details → approve and save → review uncertain readings → prepare the appointment record.

## What works

- Local PDF/photo OCR and DOCX/text reading. Personal-detail detection runs in the browser. Queue progress, approvals and results survive refresh: small checkpoints and history use localStorage; original files awaiting approval and page images use IndexedDB.
- Redaction removes text and burns matching areas into new JPEGs. Images stay in the browser. Default document titles do not use original filenames.
- Source-linked timelines grouped by domain, with deterministic unit conversions. Missing units, ambiguous dates and uncertain readings stay visible for review.
- Corrections retain the original reading and a change history. Version checks prevent one edit from silently overwriting another.
- Muse Spark maps unfamiliar names and reviews extracted rows. Answers are schema-checked and cannot invent a numeric conversion factor used by the charts. The API processes request text without storing records or linking them to an account.
- Explicit Meta recovery of missed rows on a selected page: the model returns source-word indices, the server reconstructs and verifies the fields, and the user checks and accepts each proposal before it enters the record.
- A source viewer with zoom/text fallback, chart data tables, and a locally generated PDF with embedded Unicode fonts, vector charts, values, unresolved readings, questions and source references. PDF generation runs in a bounded, cancellable worker.
- A lightweight privacy option for older phones skips the large personal-detail model and requires manual review acknowledgement. The full local check remains available.
- No login or account setup. Browser history survives a reload; clearing site data removes it. Saves that exceed browser storage capacity report an error and preserve the previous history.

## Run locally

Use a current Node 24 LTS release (24.15 or newer for the installed tooling). Install both workspaces and configure a Meta inference key:

```powershell
npm ci
npm --prefix api ci
Copy-Item api/.env.example api/.env
# Add BASETEN_API_KEY and/or META_MODEL_API_KEY; never commit it.
npm run start:api
# In a second terminal:
npm start
```

Visit `http://localhost:4200` for Home, `/documents` to add documents, or `/demo` for the fictional sample. Before downloading a privacy model, the browser checks WebGPU capabilities and selects one compatible export: approximately 555 MB for GPU/FP16 or 279 MB for CPU/Q8. It caches that export for reuse. GPU setup failure restarts in a fresh CPU worker; that exceptional fallback can require a second download. OCR assets are served by the app. See [local model preparation](docs/frontend.md#device-selection-and-local-model-preparation) before building a deployment with GPU support.

Live results require the demo API and Baseten and/or Meta credentials in `api/.env`. After approval, the Results page sends the approved lab data for server processing and waits for completion. Failures show a retry action; there is no local chart fallback. Previously completed server results remain saved in the browser. See [configuration and endpoints](docs/api.md).

## Verify

```powershell
npm test -- --watch=false
npm --prefix api test
npm run build
npm --prefix api run build
npm run benchmark
npm run check:flow
# Optional local OCR benchmark and its integration flow:
npm run benchmark -- --ocr
npm run check:flow -- --ocr
```

Tests use synthetic inputs and stub model calls, never personal reports or paid inference. CI runs both suites, builds, the positioned-text benchmark and the isolated HTTP flow. Live inference is a separate explicit check. See [measured benchmark results](docs/benchmark.md), [release evidence](docs/release-readiness.md), [the three-minute demo](docs/demo-script.md), and [Android acceptance](docs/android-checklist.md).

## Deployment boundary

The demo API exposes health/configuration and stateless Meta checks only. It does not mount the previous document, correction or account-history endpoints. Existing server files remain untouched and inaccessible through the demo API. Storage utilities and their isolated test harness are retained for existing data; they are not part of the running demo.

Serve the app and API on the same origin, keep model keys on the server, and use HTTPS for a hosted demo. Browser localStorage has limited capacity, is not encrypted by the application, and belongs to the browser profile and site origin. Use fictional data for a shared demo. Inference provider retention remains governed by the provider's configuration and terms; see [privacy](docs/privacy-and-redaction.md).

## Repository map

`src/app/extraction` reads files; `pii` detects details; `redaction` creates safe copies; `review` lets the user verify them; `core/local-history.ts` saves approved history; `results` shows readings and corrections; `appointment` prepares the visit. `api/src/demo` handles stateless inference, while the browser and API share pure extraction, matching and source-verification code.

Keep `.env`, storage, original documents and private fixtures out of the public repository. The built-in demo is invented from scratch. Record the pre-event baseline and the work added during the event before submitting; see [demo and attribution](docs/hackathon-demo.md).
