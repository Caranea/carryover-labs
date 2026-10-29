# Privacy and redaction

The product minimises what is uploaded, but does not promise that a redacted medical report is anonymous. Personal-detail detectors can miss information, and medical content plus dates and lab names may identify someone.

## Data flow

| Data | Destination |
| --- | --- |
| Original file and its original filename | Browser tab memory; not included in the upload |
| Personal-detail detection | Local rules and optional browser model |
| Approved page copy | API: fresh JPEG with redactions burned in; decoded, masked and re-encoded again on the server |
| Visible words and positions | API: extraction and source traceability |
| Hidden words | Null text plus position/category; no original text |
| Document title | API: neutral default title; user-entered titles must also avoid personal details |
| Test names, readings, units and dates for unresolved checks | Configured Meta inference provider; no page images or document titles are sent by the model task builder |
| Explicit missed-row recovery | Visible words, positions and existing-row evidence from the page the user selects; no hidden text, original image or document title. The user approves this separate operation. |
| Sign-in/account details | Clerk |

Incorrect OCR or missed redaction could still leave personal text among visible words. Model input minimisation is not a guarantee that those fields contain no personal data.

## Matching image and text

Manual regions and padded hidden-word boxes govern both the upload text and image. A word inside a hidden region is removed from the manifest even if its individual toggle was changed. Reopening a saved document cannot restore removed text or remove earlier masks. The server rejects inconsistent manifests, decodes real JPEGs, checks dimensions, reapplies declared redactions and strips metadata before storage.

A fresh neutral document title avoids exposing a name that appeared only in a filename. Detector readiness and the result of checking each document are separate: partial failures and timeouts must be shown before approval. Detection remains an aid to human review.

## Account storage

Authenticated routes derive the account identity from the verified session. Hashing an account ID in a path is an organisational detail, not encryption. Access checks prevent one account from reading another account's files.

When `STORAGE_ENCRYPTION_KEY` is set, payloads use AES-256-GCM with a random nonce and authenticated account/document/file context. This covers document manifests, JPEG pages, extracted results, reviews, corrections, recovery proposals/decisions and account-specific learned suggestions. Wrong keys or tampering fail explicitly. Production startup requires the key; development without one does not provide payload encryption.

The key belongs in deployment secrets, outside the data directory. Keep a separate recovery copy. Legacy plaintext is readable but is not migrated automatically. The [operations tool](operations.md) inventories and verifies storage, defaults to a dry run, and encrypts or rotates into a new destination while preserving the source. Historical shared caches and interrupted writes require explicit review.

Learning is account-specific. Re-redaction and deletion remove the account's learned cache and derived document files. A generation marker prevents a model job holding an older cache from repopulating it. Earlier global caches are not loaded; remove them explicitly during migration.

## Network and operational limits

API responses are private/no-store. Request, upload and account storage budgets are bounded. Image processing and storage operations reject malformed input. File-store locking and rate budgets assume one API process per store.

Browser model downloads contact Hugging Face. Clerk handles authentication. App assets, OCR, fonts and PDF workers are served by the app. Inference providers see the reduced task content described above. HTTPS, provider retention terms, operational access, backups, deletion schedules and external security review remain deployment responsibilities.

The upload screen offers a recommended full local check and an explicit lightweight mode for older phones. Lightweight mode never loads or calls the large personal-detail model; it uses local patterns and marks the check incomplete. Every incomplete check requires the user to acknowledge checking all pages before saving. The full model can be enabled later by a separate action. OCR still consumes memory, and neither mode guarantees all personal details are found.

This prototype has no route for intentionally uploading original, unredacted medical documents. Encryption of saved data is one control; it does not make the host invulnerable or provide end-to-end encryption.

## Final mask consistency

The preview, outgoing text and server image processing share one integer-pixel mask calculation. If a black area touches another recognized word, that word's whole padded box is hidden too; this repeats until no additional words are covered. The extra edge pixel is included once in that calculation. The server rejects a manifest that retains visible text under those final masks.

This is deliberately conservative: tightly spaced or overlapping recognition boxes can hide a whole row. The review screen shows the expanded black preview and a nearby-word count before approval. Undoing an initiating word/area recomputes the result; derived neighboring masks are not saved as new local choices. Review the final image and preserve a copy of the original for the doctor. This geometry rule does not prove that OCR found every name, stamp or signature.

