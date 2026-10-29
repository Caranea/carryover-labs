# Carryover Labs documentation

Carryover turns lab printouts, photos and PDFs in Polish, German and English into one longitudinal record
per test. 

The project is built in steps. **Step 1 (upload and on-device redaction) and step 2 (extracting
results with provenance) are implemented**, along with the record: one line per test across labs and
languages, charts, and checks, with Muse Spark for what the rules cannot decide.

| Document | What it covers |
| --- | --- |
| [overview.md](overview.md) | The patient-to-appointment flow |
| [architecture.md](architecture.md) | Components, data flow, folder map |
| [privacy-and-redaction.md](privacy-and-redaction.md) | What leaves the device, threat model, safeguards |
| [detection.md](detection.md) | How personal details are found: rules and the model |
| [extraction.md](extraction.md) | Step 2: from saved pages to result rows with page and box |
| [records.md](records.md) | One line per test: name unification, units, charts, checks, Muse Spark |
| [frontend.md](frontend.md) | Angular app: routes, services, components, state |
| [api.md](api.md) | NestJS API: endpoints, upload contract, validation, storage, auth |
| [development.md](development.md) | Setup, scripts, tests, troubleshooting |
| [operations.md](operations.md) | Read-only inventory, encrypted migration/rotation, backup restore and deployment templates |
| [android-checklist.md](android-checklist.md) | Unrun physical-phone checks for memory, accessibility, privacy and offline PDFs |
| [decisions.md](decisions.md) | Decisions taken so far and why |
| [limitations.md](limitations.md) | Known gaps and what comes next |
| [hackathon-demo.md](hackathon-demo.md) | Three-minute demo, live check and honest event attribution |
| [demo-script.md](demo-script.md) | Current timed demo narration, rehearsal and evidence |
| [benchmark.md](benchmark.md) | Reproducible multilingual extraction and isolated integration measurements |
| [synthetic-recovery-check.md](synthetic-recovery-check.md) | Offline and live source-index Meta recovery verification |
| [android-checklist.md](android-checklist.md) | Manual physical-phone acceptance checklist |
| [release-readiness.md](release-readiness.md) | Evidence from this implementation pass and remaining release gates |
| [evaluation.md](evaluation.md) | Functional, UX/accessibility and engineering review against the supplied judging rubric |

