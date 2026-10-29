# Remaining limitations

The current work makes the prototype safer and more useful for an appointment. It does not establish clinical accuracy, accessibility conformance or production security certification.

## Before real-world release

- Test with retirees and screen-reader users on physical budget Android phones. Desktop emulation cannot establish camera usability, memory use, screen-reader behaviour or download time.
- Downloaded PDFs have selectable Unicode text and tables but are not tagged PDF/UA documents. Keep the accessible HTML chart tables available; PDF screen-reader reading order needs dedicated testing and improvement.
- The optional browser personal-detail model is about 280 MB. An explicit lightweight pattern/manual path now avoids that download. Both paths still need physical-phone timing and memory measurements.
- Detection can miss names, handwriting, stamps, signatures and identifiers. Users must inspect the redacted page. Dates, lab names and medical details can still identify someone in combination.
- OCR and row extraction can miss or combine rows. Explicit source-index Meta recovery can propose missing rows; acceptance requires checking the source. It cannot repair unreadable OCR, and it is not a complete table editor. The [synthetic benchmark](benchmark.md) reports current recognition failures without treating safe withholding as correct extraction.
- Dates are accepted conservatively from collection labels. Multi-date cumulative tables need dedicated row/column date extraction; ambiguous pages remain unresolved instead of inheriting an arbitrary date.
- Source viewing requires saved data to be reachable. The downloaded appointment PDF works offline, but the app does not provide a complete encrypted offline library. Operator backup/restore tooling is separate from patient export.
- Files awaiting approval live in tab memory. Reloading loses them. Original documents must remain with the user.
- Word documents are read as text; embedded pictures and handwriting are not extracted.

## Storage and operations

- AES-256-GCM protects payloads only when a key is configured. Production refuses to start without it. Development may remain plaintext. The [operations tool](operations.md) verifies migration, key rotation and restore into new destinations; actual hosting and key custody still need deployment verification.
- File-store locks and request budgets are process-local. Run one API writer per storage directory. A scaled deployment needs distributed coordination and shared rate limits.
- A server holding the encryption key can decrypt records. This is not end-to-end encryption. HTTPS, access controls, host hardening, monitoring, retention/backups, key custody and provider data policies require deployment review.
- Upload/account limits reduce abuse but do not replace gateway-level limits or a capacity test. Re-decoding an image and applying declared masks cannot discover every missed identifier.
- Deletion removes active document files and invalidates learned suggestions. Backup copies, filesystem snapshots and infrastructure logs require their own retention policy.
- Legacy `_shared/knowledge.json` is no longer read. Remove it explicitly during migration; it may contain text learned from earlier uploads.

## Model and presentation

- The fictional sample is prepared data, not evidence of a live model call. Show an actual synthetic upload and inspect live provenance when recording the hackathon demo.
- Model schema validation rejects malformed answers but cannot prove that a valid-shaped answer is correct. Source evidence and user review remain necessary. Numeric unit factors come only from deterministic code.
- Numeric extremes and model concerns create review items. They are not diagnoses. A user-confirmed reading remains visible even when unusual.
- Each source observation is retained separately, including same-day repeats. Equality of date and value is not sufficient proof of a duplicate specimen.
- Lines join measurement dates and do not imply measurements between those dates. Text and bounded results keep their printed form; no interpretation is generated.
- No unredacted-upload feature is enabled. Building it requires a separate threat model and operational verification.

## Highest-value next work

1. Measure extraction and redaction recall on consented, locally held test documents with a reproducible ground truth; report failures by layout and language.
2. Improve OCR/layout recall using the measured failure cases, then evaluate source-constrained recovery on a larger independent set. Never silently repair a decimal or unit merely because it seems plausible.
3. Profile a physical low-cost Android phone and reduce the model/download and memory burden.
4. Validate the appointment packet with doctors and complete keyboard, screen-reader and print-browser testing.
