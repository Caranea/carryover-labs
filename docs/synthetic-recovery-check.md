# Reproducible synthetic recovery check

Build the API from the project root, then run the local check:

```powershell
npm --prefix api run build
node api/scripts/check-recovery.mjs
```

The default uses a deterministic stub and makes **no external requests**. It does not load `.env`. The fixture is written inside the script: an invented TSH label on one line, with `1,50 mIU/L` on the next, a collection date and a printed reference interval. No existing documents, photographs, storage folders or private fixtures are read.

To exercise the configured Meta provider explicitly:

```powershell
node api/scripts/check-recovery.mjs --live
```

This reads the endpoint credentials in `api/.env` through the ordinary application configuration and makes one logical recovery call using only the invented fixture. Provider or format fallback may cause more than one HTTP request. The configured document store is never opened. Credentials, endpoint URLs and response bodies are excluded from output.

Both modes create an isolated temporary store with a fresh in-memory AES-256 key. They check the full service path: deterministic extraction misses the row; an explicit recovery request returns indexed evidence; the deterministic verifier reconstructs its fields; the unconfirmed suggestion stays out of results; explicit confirmation adds one reading and one chart point with the original `1,50` text and numeric `1.5` unchanged. The source and deterministic extraction cache must remain unchanged, and every stored payload must be encrypted. Temporary storage is removed afterwards.

The process prints a JSON report and exits with code `0` only when every check passes. Exit code `1` means a check failed; `failureStage` and `failureCode` identify the step without echoing provider content. Exit code `2` indicates unsupported arguments. Reports are also saved to the ignored `artifacts/synthetic-recovery-stub.json` or `artifacts/synthetic-recovery-live.json`, with a timestamped copy for each run. They contain mode, model names, request counts/statuses, latency, proposed-row counts, verifier rejection categories and outcome. A `null` check result means that step was not reached.

## Recorded live verification

On 29 October 2026, `meta-models/muse-spark-open-1026` through Baseten passed the check with one HTTP request: 0 deterministic rows → 1 model proposal → 1 verified and accepted reading → 1 chart point. The model step took 9.9 seconds; total verification took 10.1 seconds. The original reading and source were unchanged, all 3 stored payloads were encrypted, and temporary storage was removed.

The immediately preceding live attempt reached the same provider successfully but yielded no verified proposal and correctly failed before acceptance. The successful attempt used the same fixture and verifier. Recovery coverage is therefore not guaranteed even for this small fixture; the check does not silently retry or replace a failed live result with stub output.

This is a reproducible integration check, not an OCR accuracy benchmark or proof of clinical correctness. It exercises service logic rather than browser interactions or HTTP authentication, which have separate tests. A live provider may omit the row or optional evidence; missing required core fields fail the check rather than being filled in. Service timeouts and bounded attempts remain active. An unavailable provider produces a failed live result; the script never substitutes a stub in live mode.
