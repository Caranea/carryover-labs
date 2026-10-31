# Page transcription and corrections

The active pipeline is documented in [records](records.md) and [API](api.md). Local OCR supports privacy detection only; it does not extract laboratory rows or determine document categories. PDF text layers are ignored. Pages keep their original displayed orientation.

Spark transcribes approved, permanently redacted page images on the server. The browser saves each completed page before final Wonder normalization. Printed values, comparators, units, ranges, flags and collection/order/report dates are retained without conversion or medical interpretation. Missing fields are explicit. Image regions are optional and use original image coordinates; a page can still be opened when a region is unavailable.

Corrections use the existing browser history and source dialog. A note and expected observation revision are required. The immutable Spark transcription and original reading remain available after a correction. Further redaction discards derived results and invalidates pending responses. Normalization is repeated after corrections; successful page transcriptions are reused.

The old `api/src/results/rows.ts` and word-index recovery remain only in offline legacy regression/storage code. They are not called by the anonymous processing API or browser extraction path.

Tests cover source links, comparators, typed dates, invalid model fields, unit arithmetic, page retry/refresh, revisions and the privacy approval gate. Live checks and measured limitations are recorded in [pipeline verification](pipeline-verification.md).
