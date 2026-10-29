# Demo API

NestJS/Express exposes stateless Meta inference under `/api`. No login, user ID, device ID or server-side document history is required.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Availability and browser-storage mode |
| GET | `/demo/config` | Configured model name; no secrets |
| POST | `/demo/records` | Check a supplied snapshot of result fields and return charts, unresolved rows and model status |
| POST | `/demo/recovery` | Check one approved source page and return source-verified proposals |

The previous document, correction and saved-history routes are not mounted. Existing disk records are neither opened nor migrated by the demo. Legacy storage code is reachable only through offline tools and an explicitly injected test harness.

## Requests and limits

Records requests contain `{documents: [{id, name, observations}]}`. IDs are local source references, not account identifiers. The API rebuilds numeric values from printed text and validates the snapshot. It processes up to 100 documents / 5,000 observations, with at most eight model tasks per request.

Recovery requests contain `{document, page, acceptedEvidence?}`. The approved manifest contains only visible text and positions; hidden words must have null text. Page images are not sent. The model selects word indices, and the server reconstructs and verifies each proposal. The browser saves proposals and requires explicit source confirmation before adding a reading.

JSON requests are limited to 8 MiB. Up to four inference requests run concurrently. Request budgets are 240 reads / 30 writes per minute per observed IP. These are process-local limits. API responses use private/no-store headers.

All record history, approved source images, corrections, accepted recovery evidence and cached results are in browser localStorage under `carryover.demo.history.v1`. A revision check prevents late responses from restoring deleted or changed content.

## Configuration

Copy `api/.env.example` to `api/.env` if the latter does not already exist. Keep keys out of the repository.

| Variable | Purpose |
| --- | --- |
| `BASETEN_API_KEY`, `BASETEN_BASE_URL`, `BASETEN_MODEL` | Primary Meta inference |
| `META_MODEL_API_KEY`, `META_MODEL_BASE_URL`, `META_MODEL` | Meta Model API fallback |
| `PORT`, `WEB_ROOT` | API port and built frontend directory |
| `HOST`, `TRUST_LOOPBACK_PROXY` | Loopback binding and optional trust of a local gateway |

Without a model key, local extraction and deterministic charts remain available and the UI explains that AI is unavailable. Storage encryption settings apply only to the retained offline legacy tools. The demo API does not require or use a document store.

Keep model keys on the server and serve the app/API on the same HTTPS origin for hosting. Provider retention is governed by the configured inference provider.

