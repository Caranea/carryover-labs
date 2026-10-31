# Privacy and redaction

The demo has no accounts or login. Approved history belongs to the current browser profile and site origin.

| Data | Location |
| --- | --- |
| Original files, extracted pages and review edits awaiting approval | Browser IndexedDB, until approval or discard; never uploaded |
| Original filename and queue status | Browser-only progress/history metadata; never included in AI requests |
| Normalised personal details reused across documents | Browser IndexedDB, attributed to their source document; never included in approved text or AI requests |
| Approved source text / burned page images | Browser localStorage / IndexedDB (older base64 images remain readable) |
| Extracted readings, corrections and accepted recovery evidence | Browser localStorage |
| Cached Meta-checked charts and proposals | Browser localStorage |
| Routine AI tasks | Approved permanently redacted image pixels sent to standard Spark; structured observations sent to standard Wonder; no original files, OCR words, filenames or hidden text |
| Explicit missed-row check | One saved approved redacted page image, with explicit source-review acceptance for suggestions |
| PDF export | Generated on device and saved by the user |

## Local saving

The browser removes hidden text and burns masks into fresh page images before saving. Reopening a saved source only allows additional redaction. Original filenames are not used as default document titles. The preview and saved masks share one geometry calculation.

After transcription, Spark can suggest a short general test/topic title without personal details. Generic titles are replaced; user-entered names are preserved. The review screen uses a neutral title before processing.

Result protection is contextual, not an allowlist of numeric values. Units (including superscripts and OCR-split notation), reference ranges, or a recognised test name immediately followed by a short number establish result context. Numeric values, units, ranges and flags such as LL/HH then survive mistaken model predictions. Explicit identity rules and manual masks take precedence. Standalone numbers are not universally exempt; missed OCR context can still require correction during review.

Personal strings detected automatically or hidden manually (including words directly inside a drawn box) are reused in other unfinished and later documents on this browser, including manual review. Matching ignores case, accents and punctuation, but does not fuzzy-match different names. Explicit Keep choices are respected. Known test names in clinical rows/headings, generic labels and short result values do not teach new matches. Padding-only neighbours do not teach matches either. The normalised strings remain locally after approval so later imports can reuse them; deleting their source or clearing site data removes them. Correcting a source stops it teaching that string; previously applied masks remain reviewable. Old approved copies with removed text cannot retrospectively teach these matches.

One atomic localStorage entry stores approved text, image references, readings and history. Approved image blobs commit to IndexedDB before metadata references them. If a save exceeds capacity, the prior entry is retained and the user sees an error. Deleting or re-redacting a source invalidates its derived results. Revision checks prevent delayed AI replies from repopulating removed or changed content. A separate atomic IndexedDB checkpoint restores unfinished queues, files and edits after refresh, with a small localStorage progress marker. Queue IDs deduplicate approvals interrupted by a reload; they are never included in AI requests.

Browser storage is limited, is not encrypted by the application, and is accessible to anyone using the same browser profile. Originals awaiting approval are retained locally for refresh recovery and removed from the saved queue after approval or discard. Clearing site data removes history and unfinished progress. Browser eviction can also remove storage; a checkpoint is not an external backup. The app does not synchronise history between devices.

## Meta requests

The server handles request-local pixels and structured observations without writing records or user-linked history. Spark receives only the approved page raster. A second server re-encoding strips any remaining metadata. Wonder receives structured name/unit/specimen/method combinations, without images by default. Completed page transcriptions and normalization are saved in the browser. Source recovery uses the same approved image boundary and requires acceptance before adding proposals. Batch IDs cannot retrieve any server content.

The previous saved-document endpoints are not registered by the demo application. Existing server files remain untouched; offline storage utilities and their regression harness are retained separately.

API responses are private/no-store. Model responses are schema-checked; provider error bodies are neither logged nor returned. Provider retention and training settings remain governed by the selected provider and account configuration.

## Review remains necessary

Personal-detail detection can miss information. Redacted lab content and dates may still identify someone. The recommended full check and the lightweight option both run locally; the single Approve button confirms the reviewed copy, without an additional acknowledgement checkbox. One OCR pass without rotation is unreliable on sideways/upside-down pages; upload still waits for approval. Draw manual boxes where OCR misses identifying text. The full-resolution burned PNG uses original image coordinates and cannot reveal pixels under a mask.

Browser model downloads contact Hugging Face. OCR assets, fonts and PDF workers are served by the app. Use fictional reports for shared hackathon demonstrations.

