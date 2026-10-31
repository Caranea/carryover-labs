# Processing API

NestJS exposes stateless inference under `/api`. No accounts, database, image storage, server jobs, batch retrieval or polling endpoints are used by the application. Batch IDs are correlation identifiers, not authorization.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Availability and browser-storage mode |
| GET | `/demo/config` | Configured provider name, without credentials |
| POST | `/demo/extract` | Standard `muse-spark-1.3`, one approved redacted raster page |
| POST | `/demo/records` | Standard `muse-wonder-1.0`, complete structured batch; validated server grouping and unit arithmetic |

`extract` accepts `{batchId, documentId, pageId, page, revision, image}`. IDs and page references are validated. `image` is a PNG/JPEG data URL, at most 20 million characters, decoded with a 60-million-pixel bound and re-encoded without metadata before inference. No PDF, OCR words, original filename, title or hidden text belongs in this request. The browser has already burned the reviewed blackouts into a fresh PNG. Server re-encoding strips metadata; it cannot establish that a client actually reviewed its page.

The reply contains literal rows, immutable observations, source image references, optional image-coordinate regions, separate printed/ISO collection, order and report dates, uncertainties, issues and a general suggested title. Invalid fields, invalid regions, invalid dates, truncated responses and inference failures are rejected. Missing measurements remain null. Model readings are not independently proven correct against pixels.

`records` accepts `{processingVersion: 2, batchId, documents: [{id, name, observations}]}`. It rejects old processing versions. Limits remain 100 documents / 5,000 observations. The server sends distinct name/unit/specimen/method combinations with stable references to Wonder, without images or correction notes. Mapping coverage must be exact. Canonical references, form conflicts, proposed units and response schemas are checked. Unknown identities and unsupported or missing units stay visible for source review. Unit factors and molar masses cannot be supplied by the model.

The browser submits at most three page requests concurrently and saves each response immediately. A retry or refresh sends only unfinished pages. Final normalization waits for all retained queue documents to be approved and all approved pages to succeed. The existing source-recovery UI explicitly rechecks one saved raster via `extract`, holds suggestions locally and requires source inspection and acceptance. It does not use a separate server job or OCR endpoint.

JSON bodies are capped at 21 MiB. The server admits at most four concurrent inference requests. Existing per-IP request limits and bounded 429 backoff remain. Each provider call has a 150-second timeout including schema fallback; browser requests time out at 180 seconds. Provider replies are capped at 256 KiB, with a 16,000-token output budget. Logs contain stage durations, counts and correlation IDs, never provider bodies, document contents or credentials. Responses use private/no-store headers.

## Configuration

Use `META_MODEL_API_KEY` and the existing optional `META_MODEL_BASE_URL`. The configured standard endpoint must use `muse-spark-1.3`; each task explicitly selects Spark or Wonder. Baseten/open/contributor variants are excluded from this pipeline. Keep keys on the server. Missing configuration returns 503; failed/incomplete inference returns 502 with a retryable message.

`PORT`, `HOST`, `WEB_ROOT` and `TRUST_LOOPBACK_PROXY` retain their existing meanings. Serve the app and API on the same HTTPS origin. Provider retention depends on the configured Meta account. Legacy storage code and offline regression tools remain unmounted and unchanged.
