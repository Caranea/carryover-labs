# Privacy and redaction

The demo has no accounts or login. Approved history belongs to the current browser profile and site origin.

| Data | Location |
| --- | --- |
| Original file and original filename | Tab memory; never saved by the history service |
| Approved source text and burned page images | Browser localStorage |
| Extracted readings, corrections and accepted recovery evidence | Browser localStorage |
| Cached Meta-checked charts and proposals | Browser localStorage |
| Routine AI tasks | Result names, values, units and dates processed through the stateless API and configured Meta provider |
| Explicit missed-row check | Visible words and positions from the selected approved page; no images |
| PDF export | Generated on device and saved by the user |

## Local saving

The browser removes hidden text and burns masks into fresh page images before saving. Reopening a saved source only allows additional redaction. Original filenames are not used as default document titles. The preview and saved masks share one geometry calculation.

One atomic localStorage entry stores approved sources, images, readings and history. If a save exceeds capacity, the prior entry is retained and the user sees an error. Deleting or re-redacting a source invalidates its derived results. Revision checks prevent delayed AI replies from repopulating removed or changed content.

LocalStorage is limited, is not encrypted by the application, and is accessible to anyone using the same browser profile. Clearing site data removes saved history. Unsaved originals are lost on refresh. The app does not synchronise history between devices.

## Meta requests

The server processes supplied request text without writing records or user-linked history. Routine model prompts exclude document titles, images and correction notes. Explicit source recovery sends visible indexed source words and positions, verifies returned indices, and requires user acceptance in the browser before adding a result.

The previous saved-document endpoints are not registered by the demo application. Existing server files remain untouched; offline storage utilities and their regression harness are retained separately.

API responses are private/no-store. Model responses are schema-checked; provider error bodies are neither logged nor returned. Provider retention and training settings remain governed by the selected provider and account configuration.

## Review remains necessary

Personal-detail detection can miss information. Redacted lab content and dates may still identify someone. The recommended full check and the lightweight option both run locally; incomplete checks require acknowledgement that all pages were reviewed.

Browser model downloads contact Hugging Face. OCR assets, fonts and PDF workers are served by the app. Use fictional reports for shared hackathon demonstrations.

