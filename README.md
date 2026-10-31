# Carryover Labs

Bring years of lab reports into a short doctor's appointment. Carryover organises Polish, German and English reports into timelines with a link back to each source reading. It does not diagnose, recommend treatment or generate medical advice.

## Try it

Open `/demo` for an account-free, entirely fictional sample. Open a chart point to inspect the source, then choose **Prepare for my appointment** to select sections and download a PDF. The sample is prepared data, not a live AI demonstration.

For your own documents: add files → check hidden personal details → approve and save → review uncertain readings → prepare the appointment record.

## What works

- Local PDF/photo OCR and DOCX/text reading. Personal-detail detection runs in the browser. Queue progress, approvals and results survive refresh: small checkpoints and history use localStorage; original files awaiting approval and page images use IndexedDB.
- Redaction burns permanent blackouts into fresh PNGs. Only explicitly approved page images are sent to the server; originals stay local. Default document titles do not use original filenames.
- Source-linked timelines grouped by domain, with deterministic unit conversions. Missing units, ambiguous dates and uncertain readings stay visible for review.
- Corrections retain the original reading and a change history. Version checks prevent one edit from silently overwriting another.
- Standard Muse Spark transcribes approved page images; standard Muse Wonder normalizes identities and groups after the retained batch is complete. Source measurements remain unchanged. Verified server code performs supported unit conversions. The API is stateless.
- Explicit Meta recovery of missed rows on a selected page: Spark rechecks an approved redacted page image, and the user checks and accepts each proposal before it enters the record.
- A source viewer with zoom/text fallback, chart data tables, and a locally generated PDF with embedded Unicode fonts, vector charts, values, unresolved readings, questions and source references. PDF generation runs in a bounded, cancellable worker.
- A lightweight privacy option for older phones skips the large personal-detail model and requires manual review acknowledgement. The full local check remains available.
- No login or account setup. Browser history survives a reload; clearing site data removes it. Saves that exceed browser storage capacity report an error and preserve the previous history.

## Run locally

Use a current Node 24 LTS release (24.15 or newer for the installed tooling). Install both workspaces and configure a Meta inference key:

```powershell
npm ci
npm --prefix api ci
Copy-Item api/.env.example api/.env
# Add META_MODEL_API_KEY; never commit it.
npm run start:api
# In a second terminal:
npm start
```

Visit `http://localhost:4200` for Home, `/documents` to add documents, or `/demo` for the fictional sample. Before downloading a privacy model, the browser checks WebGPU capabilities and selects one compatible export: approximately 555 MB for GPU/FP16 or 279 MB for CPU/Q8. It caches that export for reuse. GPU setup failure restarts in a fresh CPU worker; that exceptional fallback can require a second download. OCR assets are served by the app. See [local model preparation](docs/frontend.md#device-selection-and-local-model-preparation) before building a deployment with GPU support.

Live results require the API and standard Meta credentials in `api/.env`. The browser runs one privacy OCR pass per rendered page, without autorotation, then requires review and approval of permanent blackouts. Spark transcribes each approved image independently, with at most three simultaneous requests. Completed pages are saved immediately; refresh/retry reuses them. Wonder normalizes the completed batch without resending its images. Original filenames, hidden text, original PDFs and local OCR are excluded from requests. See [configuration](docs/api.md) and [measured limitations](docs/pipeline-verification.md).

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

`src/app/extraction` reads files; `pii` detects details; `redaction` creates safe copies; `review` lets the user verify them; `core/local-history.ts` saves approved history; `results` shows readings and corrections; `appointment` prepares the visit. `api/src/demo` handles source extraction and categorisation through stateless inference. Browser corrections and recovery share pure source-verification helpers with the API; result extraction and chart grouping run on the server.

Keep `.env`, storage, original documents and private fixtures out of the public repository. The built-in demo is invented from scratch. Record the pre-event baseline and the work added during the event before submitting; see [demo and attribution](docs/hackathon-demo.md).
