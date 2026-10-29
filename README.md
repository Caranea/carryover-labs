# Carryover Labs

Bring years of lab reports into a short doctor's appointment. Carryover organises Polish, German and English reports into timelines with a link back to each source reading. It does not diagnose, recommend treatment or generate medical advice.

## Try it

Open `/demo` for an account-free, entirely fictional sample. Open a chart point to inspect the source, then choose **Prepare for my appointment** to select sections and download a PDF. The sample is prepared data, not a live AI demonstration.

For your own documents: add files → check hidden personal details → approve and save → review uncertain readings → prepare the appointment record.

## What works

- Local PDF/photo OCR and DOCX/text reading. Personal-detail detection runs in the browser; only an approved, redacted copy is uploaded.
- Redaction removes text and burns matching areas into new JPEGs. The server decodes images, reapplies declared masks and strips metadata. Default document titles do not use original filenames.
- Source-linked timelines grouped by domain, with deterministic unit conversions. Missing units, ambiguous dates and uncertain readings stay visible for review.
- Corrections retain the original reading and a change history. Version checks prevent one edit from silently overwriting another.
- Muse Spark maps unfamiliar names and reviews extracted rows. Answers are schema-checked, account-specific and cannot invent a numeric conversion factor used by the charts.
- Explicit Meta recovery of missed rows on a selected page: the model returns source-word indices, the server reconstructs and verifies the fields, and the user checks and accepts each proposal before it enters the record.
- A source viewer with zoom/text fallback, chart data tables, and a locally generated PDF with embedded Unicode fonts, vector charts, values, unresolved readings, questions and source references. PDF generation runs in a bounded, cancellable worker.
- A lightweight privacy option for older phones skips the large personal-detail model and requires manual review acknowledgement. The full local check remains available.
- Account isolation, bounded uploads and request rates, private no-store API responses, and optional authenticated encryption of saved content. Production startup requires a storage key.

## Run locally

Use a current Node 24 LTS release (24.15 or newer for the installed tooling). Install both workspaces and configure Clerk for authenticated document use:

```powershell
npm ci
npm --prefix api ci
Copy-Item api/.env.example api/.env
# Add Clerk keys to api/.env; never commit it.
npm run start:api
# In a second terminal:
npm start
```

Visit `http://localhost:4200/demo` for the fictional sample, or `http://localhost:4200` to add documents. The browser's optional personal-detail model is approximately 280 MB on first use; failed/incomplete checks are reported. OCR assets are served by the app.

To enable live Meta inference, configure the Baseten and/or Meta credentials in `api/.env`. Without them, deterministic extraction and matching still work. See [configuration and endpoints](docs/api.md).

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

This is a hackathon prototype, not a claim of certified or invulnerable medical-data hosting. There is no unredacted-upload route. Run one API process against the file store. Set `NODE_ENV=production`, a random base64 32-byte `STORAGE_ENCRYPTION_KEY`, production Clerk keys and the allowed HTTPS origin. Keep the encryption key outside the data directory and back it up separately. Losing it loses access to encrypted files.

Existing plaintext files remain readable and are **not automatically encrypted**. Do not place an existing development store into production without an explicit migration and verification. New writes use the configured key. Legacy global learned mappings are not reused; review and remove the old `_shared` directory during migration. See [privacy](docs/privacy-and-redaction.md) and [remaining limitations](docs/limitations.md).

The [operations tool and deployment runbook](docs/operations.md) provide dry-run inventory, verified encryption/key rotation into a new destination, restore comparison and production configuration preflight. HTTPS/service templates are prepared; no hosting environment has been deployed by this work.

## Repository map

`src/app/extraction` reads files; `pii` detects details; `redaction` creates safe copies; `review` lets the user verify them; `results` shows readings and corrections; `appointment` prepares the visit. `api/src/documents` handles authenticated storage, `results` extracts source rows, and `records` unifies names/units and coordinates Meta inference.

Keep `.env`, storage, original documents and private fixtures out of the public repository. The built-in demo is invented from scratch. Record the pre-event baseline and the work added during the event before submitting; see [demo and attribution](docs/hackathon-demo.md).
