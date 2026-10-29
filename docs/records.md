# Records, units and Meta checks

Browser history plus `POST /api/demo/records` returns domain-grouped charts, written results, source references, unresolved readings, document issues and model status. Numeric results are organised, not clinically interpreted.

## Deterministic record building

The catalogue maps common Polish, German and English test names to one identity. Name matching preserves count/percentage distinctions; learned mappings are keyed with the printed unit context. Each point retains its printed name/value/unit/reference, date, source page and observation ID.

Units must be present and compatible with the catalogue test. Numeric conversions use verified dimension/scale arithmetic and known molar masses. Missing or incompatible units stay unresolved. A model-proposed numeric factor is never used to authorise a conversion. Indexed quantities such as eGFR per 1.73m² are distinct from absolute volume/time units.

Charts group tests only when catalogue grouping, units and typical scales are compatible, with at most four series. Each source observation remains distinct, even if another report has the same date and value. A comparator such as `<5` is not an exact measurement of 5; charts mark bounded values and keep their printed form in the table.

Unknown names, missing dates/units, extreme readings needing source verification and model matching concerns remain visible outside charts. Confirmation or correction is available from the source dialog. Written results remain words, without invented numeric interpretations. Printed reference ranges remain source data; the app does not generate medical advice.

## Meta inference

Configured endpoints are Muse Spark Open on Baseten, then the Meta Model API. Defaults and overrides are in `api/.env.example`. Test names, values, units and dates are sent; page images and document titles are not included in the model task. Missed personal details in source text remain a privacy risk.

The model can map unfamiliar names to the catalogue, propose a structured new test identity, or flag a mismatched name. Prompts treat source content as data, prohibit medical advice and avoid guessing missing decimals. Strict JSON schema validation runs for every response, including the plain-JSON fallback. Application checks verify catalogue references and bounded fields before use.

Each provider request has a 30-second budget including format fallback. Replies are limited to 256 KiB and 4096 output tokens. Errors/logs exclude provider response bodies, which might echo submitted data. Jobs have a bounded number of model calls. Failed polling does not repeatedly restart inference; the browser's Retry action explicitly resubmits the snapshot.

## Explicit source recovery

The results page offers a separate selected-page recovery action for missed rows. Its disclosure explains that visible page words and positions are sent to the configured Meta provider. GET status never starts inference. The model can return only indices for printed name, value, unit, date and reference fields. The server rejects hidden/masked, non-existent, overlapping, reordered, distant, conflicting or duplicate evidence, then reconstructs text from the unchanged source. It cannot invent a decimal, unit or date.

A pending proposal is excluded from results and charts until the user opens its source, confirms the fields and supplies a check note. Accepted observations retain indexed provenance and can later receive an ordinary correction overlay. A new source revision invalidates proposals and late model responses. Jobs, page sizes, response sizes, attempts and concurrent calls are bounded. A restarted job reports interruption rather than appearing to continue.

This verifies fidelity to the OCR text, not correctness of the OCR against the physical paper. Model omissions remain possible. See [the live synthetic check](synthetic-recovery-check.md) and [the extraction benchmark](benchmark.md).

## Local history and invalidation

Approved sources, corrections, proposals and cached model results are saved in browser localStorage. The API holds request-local mapping decisions only. Deletion, correction or further redaction changes the browser revision; late responses are accepted only if the current snapshot still matches. A reload reuses checked results while the snapshot is unchanged.

## Verification

The automated suite checks units, source preservation, contextual name mapping, same-day/comparator readings, confirmation, stale review rejection, bounded retry behaviour, response schemas and browser persistence. Legacy encrypted-storage checks remain in a separate test harness.

For a separate, explicit live check after building the API:

```powershell
node api/scripts/check-model.mjs --live
```

This makes a small paid call with three invented multilingual test names and asserts their mappings. It never reads private fixture documents. The `/demo` screen is prepared fictional data and does not call the model.

