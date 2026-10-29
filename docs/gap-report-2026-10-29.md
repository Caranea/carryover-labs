# Carryover Labs — additional gap report

**29 October 2026 · Functional, UX/accessibility, privacy and engineering audit**

## Assessment

Carryover has a working end-to-end prototype and a worthwhile differentiator: a person can trace an organized reading back to its source. However, this audit found reproducible cases where the software changes the source meaning before presenting the result. **The next priority should be fidelity and user control, followed by completion of the patient workflow. Visual polish and additional AI features should follow those fixes.**

The earlier implementation plan was completed against its defined checks. That does not mean all defects were closed. Its small benchmark reported no incorrect plotted points; the additional examples below demonstrate incorrect outputs outside that benchmark. Those earlier results remain valid for that particular dataset, but cannot support a general reliability claim.

This report contains **17 additional findings**. Eight are P1: address them before presenting the affected paths as dependable. Nine are P2: important completion, accessibility or resilience gaps. Priority reflects the product's purpose, not a formal security severity score.

| Perspective | Current assessment | Most valuable next improvement |
| --- | --- | --- |
| Functional | Import, review, source inspection and export work, but several transformations can alter meaning or combine different measurements. | Preserve meaning across extraction, identification and grouping; make missing readings recoverable. |
| UX/UI | A coherent interface exists, but some failures have no usable next step. Long histories and non-English users expose additional friction. | Help an ordinary person finish, understand what is being sent, and prepare a focused appointment packet. |
| Code and technical depth | Pure processing functions, explicit contracts and evidence checks make the system inspectable. The main weakness is incomplete invariants at boundaries, rather than a need for a rewrite. | Make semantic identity, data-transfer permission and retry behavior explicit and testable. |

## Scope and evidence

Three parallel read-only reviews covered records, experience, and privacy/storage. I inspected the relevant paths and added bounded synthetic probes for PDF limits and OCR confidence propagation. No application implementation was changed, no real records were used, and no live model requests were made in this audit. This document is the deliverable.

- **Reproduced:** an invented input demonstrated the behavior in the current processing code. This does not establish real-world frequency.
- **Code-confirmed:** the behavior or missing control is visible in the implementation. Device, browser or assistive-technology impact may still require testing.
- **Further validation:** explicitly separated below; not presented as a demonstrated defect.

The prior 114 frontend and 99 API passing tests are earlier evidence, not a fresh full-suite run for this report. Physical Android testing remains with the user. Hosting, independent security review and a real signed-in rehearsal remain external gates.

## Priority register

| ID | Priority | Gap | Evidence |
| --- | --- | --- | --- |
| G01 | P1 | Negative written results can lose their negation | Reproduced |
| G02 | P1 | Fuzzy matching changes test identity | Reproduced |
| G03 | P1 | Specimen qualifiers disappear before grouping | Reproduced |
| G04 | P1 | Thousands separators become decimal points | Reproduced |
| G05 | P1 | Encrypted storage reads also accept replacement plaintext | Reproduced; requires storage-write access |
| G06 | P1 | Opening results initiates external inference without a preceding choice | Code-confirmed |
| G07 | P1 | A missing reading can have no completion path | Code-confirmed |
| G08 | P1 | OCR confidence is lost before downstream review | Confidence loss reproduced; downstream policy inspected |
| G09 | P2 | Retrying an uncertain save creates another document | Reproduced replay |
| G10 | P2 | Unsupported units can make a confirmed test permanently unchartable | Reproduced with a model stub |
| G11 | P2 | A large appointment export can fail with an unusable remedy | Reproduced |
| G12 | P2 | Browser print omits context retained by the PDF | Code-confirmed |
| G13 | P2 | Keyboard navigation scales poorly; a mobile action lacks a name | Code-confirmed markup |
| G14 | P2 | Multilingual input has an English-only patient workflow | Code-confirmed |
| G15 | P2 | OCR has no bounded cancellation/restart path | Code-confirmed; device failure frequency unmeasured |
| G16 | P2 | An accepted image can become too large to redact again | Reproduced at the API boundary |
| G17 | P2 | Interrupted JSON writes leave temporary payloads behind | Reproduced simulated crash state |

## P1 findings

### G01 — Negative written results can lose their negation

**Observed:** a positioned table containing `HBsAg | not detected` produces `valueText: "detected"`. `Anti-HCV | non reactive` becomes `"reactive"`. Extraction selects a recognized qualitative word instead of preserving the complete value phrase. Written results then enter the record through the ordinary result-building path.

**Why it matters:** perfect source text is enough to produce an opposite meaning. A reassuring chart layout or a source link cannot compensate for that transformation.

**Recommended change:** parse the complete qualitative value span, including negation and modifiers. Preserve its exact printed phrase. Hold uncertain phrases for source review rather than reducing them to a recognized word.

**Acceptance:** `not detected`, `non reactive`, `nicht nachweisbar` and Polish negative phrases retain their complete meaning through extraction, results and both exports. Ambiguous phrases remain unresolved.

Evidence: [value selection, rows.ts:269](../api/src/results/rows.ts#L269), [valueText construction:326](../api/src/results/rows.ts#L326), [written-result handling, build.ts:102](../api/src/records/build.ts#L102).

### G02 — Fuzzy matching changes test identity

**Observed:** `anti ttg igg` matches `ttg-iga`; combining it with `anti ttg iga` produces one Anti-tTG IgA series without a warning in the deterministic build. Other reproduced mappings include `gliadin iga` to IgG, `Complement C5` to C3, and `Immunoglobulin E` to IgG.

**Why it matters:** the characters treated as spelling errors can define a different test. Accurate extraction can therefore become an inaccurate history. A later optional model check is not a reliable prerequisite to displaying or exporting the first build.

**Recommended change:** protect identity-bearing tokens such as antibody classes and component numbers. Treat fuzzy matches as proposals when they change those tokens or have competing candidates. Keep uncertain identities separate until resolved.

**Acceptance:** these examples never silently merge; known harmless OCR spelling variants still work. Test model-off, model-delayed and model-failure paths as well as the successful model path.

Evidence: [fuzzy matching, match.ts:73–79](../api/src/records/match.ts#L73), [grouping by test key, build.ts:125](../api/src/records/build.ts#L125).

### G03 — Specimen qualifiers disappear before grouping

**Observed:** `Glucose i.U. | 30 mg/dL` and `Glucose i.S. | 100 mg/dL` enter one Glucose trend without a warning. The matcher strips the specimen suffix and treats the remaining name as an exact alias.

**Why it matters:** matching the analyte and unit is insufficient to establish that observations belong in one comparable history. LOINC explicitly includes the sample/system as part of test identity, and includes method where it distinguishes the measurement. [LOINC's definition of test identity](https://loinc.org/kb/users-guide/major-parts-of-a-loinc-term) supports this distinction; this recommendation is about faithful organization, not medical interpretation.

**Recommended change:** retain specimen qualifiers in the observation and grouping key. Preserve relevant method or collection-context qualifiers when printed; do not guess missing ones. Unknown compatibility should be visible rather than silently resolved by deleting information.

**Acceptance:** the two reproduced inputs remain separate. Unknown specimens do not silently bridge incompatible series. The original qualifier survives source inspection and export.

Evidence: [alias lookup, match.ts:88](../api/src/records/match.ts#L88), [withoutSpecimen:103](../api/src/records/match.ts#L103), [grouping, build.ts:125](../api/src/records/build.ts#L125).

### G04 — Thousands separators become decimal points

**Observed:** an English fixture correctly yields document decimal style `"."`, yet Ferritin `1,234 ng/mL` is parsed and plotted as `1.234` without a warning. The original text remains `1,234`, so the displayed string and chart position disagree by a factor of 1,000.

**Why it matters:** this needs no OCR error. The parser unconditionally replaces a comma with a decimal point and does not use the detected formatting evidence for this decision.

**Recommended change:** use document and cell formatting evidence consistently when parsing numbers and reference intervals. Preserve the raw string, parsed value and interpretation. Ambiguous separators should require confirmation.

**Acceptance:** cover `1,234`, `1.234`, `1 234`, `1,234.5` and `1.234,5` in appropriate English, German and Polish fixtures. Check plotted coordinates as well as displayed text; ambiguous cases must not silently plot.

Evidence: [numeric conversion, tokens.ts:94](../api/src/results/tokens.ts#L94), [row parsing:272](../api/src/results/rows.ts#L272), [detected decimal style, locale.ts:35](../api/src/results/locale.ts#L35).

### G05 — Encrypted reads permit a plaintext downgrade

**Observed:** when a storage key is configured, data lacking the `CLAB1` prefix is still returned as plaintext. Replacing synthetic encrypted JSON with plaintext `{"value":999}` was accepted by the decoder.

**Why it matters:** a party able to replace storage files without the key can bypass the authenticated-encryption check by replacing the entire envelope. This requires storage-write access; it is not a demonstrated remote exploit or authentication bypass. The current compatibility behavior weakens the intended integrity guarantee.

**Recommended change:** enforce encrypted-only reads in production. Keep legacy plaintext reading in an explicit offline migration mode, with inventory and verification before switching the runtime policy.

**Acceptance:** a production read rejects plaintext replacement, wrong prefixes, modified ciphertext and a file copied from another account/path. An explicitly selected migration workflow can still process legitimate legacy data.

Evidence: [decodeStored, storage-crypto.ts:20](../api/src/security/storage-crypto.ts#L20).

### G06 — Opening results starts external processing without a preceding choice

**Observed:** the normal records GET starts a model job when work is pending and a provider is configured. Review prompts include printed names, values, units and dates. The upload approval describes saving the redacted copy; the result screen reports automatic processing after that path has begun. There is no preceding control to decline this routine inference while retaining deterministic organization.

**Why it matters:** agreeing to save a document and agreeing to send its health information to another processor are materially different choices. The explicit recovery workflow is clearer than routine automatic matching.

**Recommended change:** explain the configured recipient and fields before the first transfer; offer local/rule-based results without that transfer. Persist a clear account preference and provide an explicit processing action. Separate read-only retrieval from starting a billable external job. Explain what happens to identifiers the user deliberately leaves visible.

**Acceptance:** a stub provider receives zero requests before the relevant choice. Declining still permits deterministic results and export. Enabling it sends only the disclosed data, and changing the choice prevents subsequent jobs.

Evidence: [automatic job start, records.service.ts:42](../api/src/records/records.service.ts#L42), [prompt fields, prompts.ts:76](../api/src/records/prompts.ts#L76), [approval wording, review.page.html:188](../src/app/review/review.page.html#L188).

### G07 — A missing reading can have no completion path

**Observed:** corrections require an existing observation. If extraction misses a row and Meta recovery is unavailable, produces no proposal or exhausts its attempts, the user cannot add the visibly printed reading through the current workflow. Recovery also sits below the result history, reducing its discoverability as histories grow.

**Why it matters:** the person can identify the omission but cannot finish the task. This is especially consequential given the previously measured 57.5% exact-row recall in the small OCR benchmark. A general warning that recognition can fail does not supply a repair path.

**Recommended change:** add a prominent “A result is missing” action with source-linked manual transcription. Preserve the source crop, entered fields and user confirmation. Make clear that an empty warning list does not mean every printed row was extracted.

**Acceptance:** with recovery disabled, returning zero proposals or exhausted, a user can add one printed reading and inspect its source. Missing or unreadable fields stay unknown; the workflow does not invite invention.

Evidence: [recovery states, recovery-panel.html:25](../src/app/results/recovery-panel.html#L25), [existing-observation correction, source-dialog.ts:81](../src/app/results/source-dialog.ts#L81), [recovery placement, results.page.html:241](../src/app/results/results.page.html#L241).

### G08 — OCR confidence disappears before review and charting

**Observed:** an invented OCR word `4.0` with confidence `1` passes `pageToWords` and becomes an ordinary word with no confidence field. The function keeps words with confidence at least zero. Confidence helps orientation selection, but is not retained for downstream decisions. The record builder can plot unconfirmed values that satisfy its date, unit and plausibility checks.

**Why it matters:** a plausible recognition error can evade magnitude checks. Evidence indices prove that a value came from recognized words; they do not independently prove those words match the pixels. This audit reproduced the loss of confidence, not a real-image error rate.

**Recommended change:** retain recognition quality and extraction provenance through the pipeline. Make suspect values, dates and units visibly reviewable before use. Keep “read from image,” “verified against recognized text,” and “checked by the user” distinct. Confidence alone must not be treated as proof of correctness.

**Acceptance:** a low-confidence numeric/date/unit fixture is flagged for checking; its quality and verification state survive storage and export. Add image-level cases where an incorrect value remains numerically plausible, including high-confidence OCR errors.

Evidence: [word filtering/mapping, ocr-layout.ts:19](../src/app/extraction/ocr-layout.ts#L19), [record construction, build.ts:149](../api/src/records/build.ts#L149).

## P2 findings

### G09 — Retrying an uncertain save duplicates the document

Replaying the same synthetic upload creates two document IDs. If the server saves successfully but the response is lost, retrying from review can duplicate readings and consume quota. The replay proves the missing idempotency; the lost-response UI scenario follows from the request handling.

Use an operation ID for each approved document revision and return the same result on repeated or concurrent submissions. Do not deduplicate by date/value, because distinct observations may legitimately be equal.

**Acceptance:** drop the first successful response, retry, and verify one document, one set of readings and the same returned ID.

Evidence: [fresh ID on create, storage.ts:59](../api/src/documents/storage.ts#L59), [failed save handling, document-queue.service.ts:301](../src/app/core/document-queue.service.ts#L301).

### G10 — A confirmed unfamiliar unit can remain permanently unresolved

A stubbed model proposal for Calprotectin with canonical unit `µg/g` passes name adjudication, but a dated reading in that same unit stays excluded even after user confirmation. The dimensional parser cannot represent the unit, while the message asks the user to check it again.

Add verified unit dimensions or a carefully constrained native-unit series for a confirmed identity and exact compatible unit. Preserve unsupported results without promising that repeating confirmation will solve the problem.

**Acceptance:** the confirmed fixture becomes a clearly labelled native-unit history or receives an actionable explanation; incompatible units stay separate. No guessed conversion is introduced.

Evidence: [name decision, records.service.ts:162](../api/src/records/records.service.ts#L162), [unit parser, units.ts:70](../api/src/records/units.ts#L70), [unit gate, build.ts:113](../api/src/records/build.ts#L113).

### G11 — Large exports can fail with an impossible instruction

All unresolved and written readings remain included regardless of selected chart groups. A direct probe with **1,601 unresolved readings and zero selected chart groups** fails validation with “Choose fewer groups.” There are no more groups to remove. The same design also prevents a person from excluding unrelated written results from a focused appointment packet, although the UI does disclose their inclusion.

Provide explicit date/document scope and a visible inclusion summary, or generate numbered volumes. Preserve a clear account of intentionally excluded material rather than silently dropping rows. Estimate size before expensive generation.

**Acceptance:** a 60-report fixture containing 1,601 unresolved/written readings exports into complete bounded files. Verify no unintended omissions or duplicates and ensure every error offers an action that can actually resolve it.

Evidence: [always-included wording, appointment.page.html:15](../src/app/appointment/appointment.page.html#L15), [export input, appointment.page.ts:100](../src/app/appointment/appointment.page.ts#L100), [limit and message, appointment-pdf.ts:20](../src/app/appointment/appointment-pdf.ts#L20).

### G12 — “Print this page” and PDF export preserve different evidence

Browser-print chart tables omit printed reference intervals and generally show normalized test names. The downloadable PDF retains printed names and reference information. Two adjacent output choices therefore provide different context for the same appointment.

Use one presentation contract for both outputs, with source names, values, units, printed ranges, verification state and provenance.

**Acceptance:** compare both outputs from the same multilingual, converted-unit fixture. Their evidence fields must agree, even if pagination differs.

Evidence: [chart table, line-chart.ts:140](../src/app/results/line-chart.ts#L140), [PDF table, appointment-pdf.ts:152](../src/app/appointment/appointment-pdf.ts#L152).

### G13 — Accessible navigation does not scale with the history

Every chart point is a separate tab stop before the values-table control. A large history can require hundreds of stops. At small screen widths, the saved-document “Hide more” link hides its text; its icon is accessibility-hidden and the link has no explicit accessible label. These are markup findings, not a completed screen-reader usability study.

Provide an early table shortcut, one chart entry point with arrow-key movement between points, and explicit document-action labels.

**Acceptance:** navigate 1,000 readings without tabbing through every dot. At 360px, a screen reader announces each saved-document action meaningfully. Include focus visibility, zoom and TalkBack in the user's Android checks.

Evidence: [point tab stop, line-chart.ts:97](../src/app/results/line-chart.ts#L97), [mobile action, upload.page.html:186](../src/app/upload/upload.page.html#L186), [hidden icon, icon.ts:65](../src/app/ui/icon.ts#L65).

### G14 — The patient workflow is English-only

The application language and core privacy/recovery instructions are English; PDF language is fixed to `en-GB`. Reading Polish or German documents does not make these choices understandable to a retiree who cannot read English comfortably.

Add a selectable interface/export language, starting with privacy choices, uncertainty, errors, corrections and appointment preparation. Preserve original source text alongside translated interface labels.

**Acceptance:** native-language participants complete import, privacy review, correction/recovery and export without English assistance. This requires user testing as well as translated strings.

Evidence: [application language, index.html:2](../src/index.html#L2), [recovery instructions, recovery-panel.html:18](../src/app/results/recovery-panel.html#L18), [PDF language, appointment-pdf.ts:177](../src/app/appointment/appointment-pdf.ts#L177).

### G15 — A stuck OCR operation can block the queue

The queue awaits extraction sequentially. Its abort signal reaches the personal-detail model, but not the preceding OCR extraction. OCR awaits worker creation and recognition without a deadline; the termination method has no extraction cancellation integration. If recognition never settles, later files cannot start. Actual frequency on low-cost Android is unmeasured.

Add bounded cancellation, a worker restart path and actionable timeout messages. Ensure removing a file or ending a session stops its work, rather than only discarding the eventual result. Preserve other pending files where possible.

**Acceptance:** simulate a recognition promise that never resolves, cancel or time it out, and verify that the next file starts. Repeat during a session change; no stale result should appear.

Evidence: [sequential queue, document-queue.service.ts:118](../src/app/core/document-queue.service.ts#L118), [extraction and later abort signal:132](../src/app/core/document-queue.service.ts#L132), [worker recognition, ocr.service.ts:65](../src/app/extraction/ocr.service.ts#L65).

### G16 — A stored image can become ineligible for later redaction

A valid synthetic 4500×4500 JPEG grew from **5,246,349 bytes to 9,177,122 bytes** when sanitized. The sanitizer accepts inputs below 8 MB but does not constrain its output; later redaction sends the saved image through that input limit again and fails. Current browser downscaling reduces exposure, so this is an API-boundary defect rather than a reproduced ordinary phone upload failure.

Make the accepted/stored image contract closed under repeated redaction: bounded output encoding or a separate validated internal path, without allowing hidden pixels to reappear.

**Acceptance:** every accepted page remains redactable, including high-entropy images near supported size limits. Repeated masking preserves previous masks.

Evidence: [input limit and re-encoding, images.ts:8–20](../api/src/documents/images.ts#L8), [redaction of stored pixels, storage.ts:77](../api/src/documents/storage.ts#L77).

### G17 — Crash recovery misses temporary JSON payloads

A synthetic `corrections.json.<uuid>.tmp` representing an interrupted write survives a fresh storage instance and document read. Recovery handles account-level directory swaps, but does not collect document-level JSON temporary files. These payloads remain encrypted when a key is enabled; this is not evidence of a plaintext leak. They can retain abandoned data, consume quota and block migration that rejects unknown files.

Add bounded recovery or quarantine for these known temporary-file patterns, coordinated with writes and the supported single-writer deployment model.

**Acceptance:** interrupt between temporary-file sync and rename, restart, and verify cleanup or explicit recoverable quarantine while retaining the last committed correction.

Evidence: [JSON temporary write, storage.ts:137](../api/src/documents/storage.ts#L137), [recovery scope, storage.ts:210](../api/src/documents/storage.ts#L210).

## Product questions and validation still needed

These are important next investigations, not additional reproduced defects:

1. **One person per history.** The current document/result contracts do not carry a separate patient-profile identity. Test what happens when a caregiver imports a spouse's report into the same account. A simple local confirmation or opaque profile identifier could prevent accidental mixing without uploading identifying information.
2. **The actual 20-minute appointment.** Ask a clinician to find one requested test, inspect its original context and understand what is missing from a large fictional history. The PDF has a source bibliography, but offline evidence inspection still depends on access to the underlying reports. Consider an optional redacted source-crop appendix and user-authored reason-for-visit section; validate their usefulness before adding pages.
3. **Completeness, latency and effort at realistic scale.** Measure 50–100 varied reports, including partial extraction, poor photographs, interrupted processing and mixed languages. Count time spent by the patient, missing rows, wrong meaning, wrong series, review burden and time to find evidence—not only rows plotted. Keep image-level ground truth independent of the OCR output.
4. **Provider and browser trust boundaries.** Document which third-party scripts execute in the page that handles originals, and what the configured inference host stores. This audit did not demonstrate document exfiltration or verify hosted retention settings. Prepared encryption and deployment files do not establish production operation by themselves.

## What would make this stronger for the hackathon

Using the supplied rubric, the best next investment is a visibly trustworthy patient journey. A judge should see one difficult, invented multilingual report become a usable history, including an ambiguity the system correctly refuses to merge and a missing reading that the person can recover.

| Rubric | Gap to close | Persuasive evidence |
| --- | --- | --- |
| Impact — 30% | The patient can still get stuck; the short appointment outcome has not been tested with its users. | A retiree completes the flow, and a clinician finds a requested history and its source promptly. Report actual observations, not assumed time savings. |
| Meta tooling — 25% | A successful recovery call exists, but general value and failure behavior need broader evidence. | Show what deterministic extraction missed, the Meta proposal, the source-index checks, human acceptance and the resulting history. Include repeated-run outcomes, latency and cost. |
| Technical depth — 20% | Semantic identity and boundary invariants have counterexamples. | A compact adversarial suite covering G01–G06, preserved source evidence and safe behavior when the model is unavailable. |
| Demo — 25% | Prepared sample data alone does not demonstrate the whole product. | One real signed-in synthetic upload through privacy review, recovery and an offline packet; rehearse both a successful and a failed model response. |

The strongest technical “wow” would be **an inspectable chain from source pixels to organized result, with uncertainty carried through every step**. More autonomous medical interpretation would weaken the product's intended role and conflict with the supplied event constraints. Patient-authored context and source-grounded organization are appropriate areas to extend.

## Recommended order

1. **Close silent meaning changes:** G01–G04. Add these counterexamples to an independent benchmark and inspect chart position as well as displayed strings.
2. **Close trust gaps:** G05–G06, then G08. Verify encrypted-only behavior, pre-transfer control and honest quality/verification states.
3. **Make completion possible:** G07, G09–G11 and G15. A failed model, lost response or stuck recognition must have a usable path forward.
4. **Make the handoff inclusive and consistent:** G12–G14, followed by a retiree/clinician rehearsal and the user's physical Android checks.
5. **Finish operational edges:** G16–G17 and the existing real-session, hosting, retention/restore, security-review and publication gates.

The proposed fixes should be targeted; a framework rewrite or a visual redesign is not justified by this evidence. After addressing the relevant gaps, revise the readiness statement and rerun the affected checks plus the end-to-end synthetic journey. No fix or closure is claimed by this report.

The latest account-wide weekly usage reading during this audit was **40%**, below the previously discussed 50% ceiling. It includes other account activity and is not a per-task cost measurement.
