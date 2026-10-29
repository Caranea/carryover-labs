# Results extraction and correction

The extractor reads visible words from an approved redacted document. It does not see hidden text. OCR readings may differ from the physical original, so each observation retains its page, word indices and bounding box for review.

## Local reading

Digital PDFs use a usable text layer; scans and photographs use Tesseract with Polish, German and English data. The text-quality check can choose OCR for a broken PDF character map. Orientation checks can rotate an image before extraction so word boxes follow the saved image. DOCX/TXT sources produce text-only pages.

## Source fidelity

`api/src/results/rows.ts` detects table headers and inline rows, parses value/comparator/unit/reference text, and retains the recognised source reading. It does **not** insert decimal points, alter reference bounds or repair unit strings to make a reading fit a printed range. For example, OCR `47` remains `47`, even alongside `4.0–10.0`.

Formatting is inferred per page. Collection labels and explicit row dates establish dates; dates are not borrowed from a different page. Invalid, ambiguous or unrelated dates are withheld. Multi-date cumulative columns still require further extraction work. The chart builder lists undated observations for source checking.

`EXTRACTOR_VERSION` invalidates older caches when extraction changes. Raw results are cached separately from user corrections. Document read/extraction failures appear as issues in API responses rather than silently disappearing from the record.

## Corrections

`PATCH /api/results/:documentId/observations/:observationId` accepts:

```json
{
  "name": "TSH",
  "valueText": "< 2.5",
  "unit": "mIU/L",
  "date": "2024-01-10",
  "note": "Checked the printed value and collection date.",
  "expectedRevision": "64-character revision returned with the observation"
}
```

Unit/date may be null. The note is required. The server validates fields and calendar dates and returns409 for an outdated revision. Unknown observation IDs and another account's documents are inaccessible.

The ledger is an overlay: source words/images and extracted readings stay intact. Responses include original fields, effective fields, revision, check/correction history and confirmation status. Confirming without changes is supported. The record uses the effective fields; a confirmed extreme reading is not suppressed because a model or plausibility bound objects.

Re-redaction invalidates extraction, review and correction history because these can contain newly hidden text. A correction is applied only to the source hash against which it was made. Model reviews are also hashed against the exact current readings.

## Verification

Synthetic tests cover locale/date parsing, multi-page and section dates, row dates, malformed/ambiguous dates, source-number preservation, hidden text, auth/account isolation, concurrent revision conflicts, immutable originals, redaction invalidation and visible extraction failures. These tests are not a measured OCR accuracy benchmark on real photographs.

