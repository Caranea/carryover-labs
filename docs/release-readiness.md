# Release readiness — 29 October 2026

The software preparation plan is implemented and locally verified. Physical Android acceptance is reserved for the user. Real-session rehearsal, hosting verification, user research and submission publication remain separate release steps.

## Implemented outcome

- Preserved source numbers, comparison signs and repeated observations; conservative collection dates and compatible units; corrections retain originals and history.
- Explicit Meta recovery of missed rows using verified visible-word indices, pending human approval, bounded calls and stale-source protection.
- Matching local redaction preview, uploaded text and independent server masks, including tight neighboring words and reversible area removal.
- Full local detection or explicit lightweight pattern/manual review, incomplete-check acknowledgement and failed-import memory cleanup.
- Encrypted saved payloads, account-specific caches, image decoding/metadata removal, quotas, no-store responses and account/session changes that invalidate requests, views and PDF exports.
- Offline storage inventory, verified encryption/key rotation into new destinations, restore comparison, production preflight and a single-instance HTTPS/service runbook.
- A direct locally generated appointment PDF with selected charts, Unicode text, values, questions, unresolved readings and source bibliography.
- Reproducible multilingual benchmark, isolated HTTP integration, a current three-minute demo script and an Android acceptance sheet.

## Verified evidence

| Check | Final result |
| --- | --- |
| Frontend regression suite | **114 tests passed across 22 suites** |
| API regression suite | **99 tests passed across 24 suites** |
| Production builds | Both passed |
| Initial frontend bundle | **474.70 kB raw / 107.09 kB estimated transfer**, excluding lazy code, fonts, OCR assets and the optional personal-detail model |
| Production dependency audits | Both reported zero known advisories |
| Patch check | No whitespace errors; Git reports ordinary Windows line-ending notices |
| Synthetic positioned-text benchmark | 19/20 exact rows; 16 plotted; zero incorrect plotted points |
| Actual local OCR benchmark | 23/40 exact rows; 19 plotted; zero incorrect plotted points; 19 held for review |
| Isolated HTTP integration | Positioned-text and OCR-backed modes passed: upload, masks, auth/isolation, corrections, pending/accepted recovery, charts, encryption and PDF |
| Offline recovery check | Passed without network calls; unchanged source/value and three encrypted payloads |
| Live Meta recovery | Baseten Muse Spark Open, one verified/accepted missed row, 9.9-second model step / 10.1 seconds overall |
| Browser PDF export | Actual Downloads files verified; full sample six pages, selected-thyroid packet four pages |
| PDF visual inspection | All six sample pages rendered and inspected; Polish/German accents, charts, tables, uncertainty and bibliography checked |

The first live recovery request returned no verified proposal; the second used the same fixture and verifier and succeeded. Recovery is not guaranteed. See [the exact live evidence](synthetic-recovery-check.md). No private reports were sent.

The [benchmark](benchmark.md) is deliberately small and synthetic. Its 57.5% OCR exact-row recall is a material limitation. Safe withholding does not count as correct extraction, and zero incorrect plotted points here cannot prove that every future error will be detected. Labelled-name masking coverage is not real-world personal-detail recall.

The final mask-chain regression covered 20,000 reversed words and completed in 157 ms during the combined desktop run. This is not an Android performance claim.

Browser checks covered phone-width layout, source viewing, selected groups, questions, route-preserving navigation and direct download. The selected PDF retained Ferritin as unresolved and the question/bibliography, while excluding unselected Glucose/Platelets. Account changes during requests, source loading, recovery and export have regression coverage. A complete signed-in browser upload using the real Clerk session has not been demonstrated in this pass; the isolated HTTP verifier is labelled as a test double.

The build retains two expected CommonJS optimization warnings from lazy-loaded pdfmake/font code. Several local checks needed broader permission to access their temporary localhost server or build files, then passed. No automatic approval rejection remains unresolved.

## Deliverables

- [Functional, UX/accessibility and code evaluation](evaluation.md)
- [Completed preparation plan and external gates](implementation-plan.md)
- [Three-minute demo script](demo-script.md)
- [Storage/deployment operations](operations.md)
- [Physical Android checklist](android-checklist.md)
- [Fictional appointment PDF](../output/pdf/carryover-fictional-appointment.pdf)
- Ignored local evidence: artifacts/benchmark/, artifacts/flow/, artifacts/synthetic-recovery-*.json, artifacts/qa/; PDF page renders in tmp/pdfs/.

## Remaining release gates

1. The user will verify physical Android camera/import, memory, first-use downloads, interruption recovery and TalkBack. Responsive layout alone does not pass that gate.
2. Rehearse the complete fictional upload and recovery in the actual signed-in recording session. Hosted CI has not run; its equivalent commands passed locally.
3. Choose the host and provision production keys, HTTPS, provider settings, retention/backups and operational access. Verify the prepared configuration against that environment and obtain independent security review before real records.
4. Test with retirees and clinicians. PDFs contain selectable Unicode text but are not tagged PDF/UA; accessibility conformance is not established.
5. Establish honest event attribution from the October 26 scaffold and existing uncommitted work, then record/publish the final repository and video. No commit, public repository update or deployment was made here.

The latest account-wide weekly usage reading is **37%**, below the agreed 50% ceiling. The meter includes other account activity and is not a precise per-task measurement.

