> Historical server-storage evidence: the current demo uses browser localStorage and stateless Meta inference. See [API](api.md) and [privacy](privacy-and-redaction.md) for current behavior. Offline storage tools and legacy tests remain available; their routes are not served by the demo.

# Completion plan

The software preparation plan is complete as of 29 October 2026. See [release evidence](release-readiness.md) for the final 114 frontend / 99 API tests, builds, benchmarks and verified PDF download. The latest account-wide weekly usage reading is 37%, below the agreed 50% ceiling. External acceptance gates are listed separately below.

| Workstream | Acceptance evidence | Status |
| --- | --- | --- |
| Data fidelity, corrections and privacy foundation | Source/correction isolation, numeric/date/unit edge cases, encryption and upload tests | Implemented; regression suite retained |
| Source-constrained Meta recovery | Verified indices, explicit acceptance, stale/cross-account protection; actual Meta open-weight service call | Complete; successful run and preceding no-proposal outcome documented |
| Reproducible extraction benchmark | Invented multilingual layouts and reduced-size images; exact recall, wrong chart points and masking coverage reported separately | Complete; 95% positioned-text / 57.5% OCR exact recall, zero wrong points in this limited set |
| Appointment PDF | Direct download, embedded Unicode fonts, vector charts, values/references/uncertainty, visual page verification | Complete; actual full and selected browser downloads verified |
| Low-memory privacy path | Explicit local rules/manual choice and incomplete-check acknowledgement; failed-import cleanup | Complete; physical performance remains unmeasured |
| Storage operations | Dry-run inventory, verified encrypt/rotate to new destination, immutable input, restore/wrong-key/corruption tests | Complete on synthetic stores; actual store unchanged |
| End-to-end data flow | Synthetic OCR/redaction/upload/results/correction/recovery/export through production code | Complete in isolated HTTP integration; browser-local demo rehearsal still required |
| UX/accessibility preparation | Keyboard alternatives, chart tables, phone-width layout, source/export flows, session cleanup | Complete; physical assistive-technology acceptance remains external |
| Production preparation | Single-writer HTTPS/secrets/retention runbook, preflight and CI workflow | Complete; Linux single-instance templates prepared, hosting/container choice deferred |
| Hackathon preparation | Functional/UX/code evaluation, timed demo, evidence and attribution guidance | Complete; recording/publication and historical attribution sign-off remain with team |
| Physical Android acceptance | Camera/import, memory/download, interruption and accessibility on hardware | User will verify manually later; checklist prepared |
| Actual deployment validation | Hosting target, secrets, HTTPS, backups and independent security assessment | External gate: environment not supplied; nothing deployed |

Prepared synthetic data and simulated accounts must be labelled as such. They cannot be presented as real patient evidence, clinical validation, or physical Android testing. No original medical files will be sent to external services for these checks.

## Queued follow-ups — 29 October 2026

- [x] Detect page orientation before full OCR, preserving photo metadata orientation and matching word boxes. User notified before starting. Tesseract OSD corrects confident 0°/90°/180°/270° cases before recognition; uncertain/blurred pages retain the quality fallback. Browser checks recovered all 454 words and upright dimensions in eight synthetic clean/blurred rotation cases. Clear rotated pages took about 4–5 seconds on this laptop; blurred rotated pages still took 26–38 seconds. Synthetic evidence is in `artifacts/device-processing/rotation.json`.
- [x] Replace the separate device panel with an inline recommendation badge, choose a compatible privacy model after a WebGPU probe, cache the selected export, and show rough per-page and separate first-download estimates. GPU/FP16 and CPU/Q8 were exercised on the same synthetic text; see `docs/frontend.md` for asset preparation and limitations.
