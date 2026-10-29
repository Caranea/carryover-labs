# Carryover evaluation — 29 October 2026

The core patient-to-appointment concept now works as an integrated prototype. Its strongest differentiator is a result that can be traced to source evidence, corrected without rewriting history, and exported for a short clinical visit. Readiness for a hackathon demonstration is stronger than readiness for general use with sensitive records.

## Functional

**Implemented:** multilingual document ingestion; local personal-detail review and masking; grouped longitudinal charts; conservative dates/units; original-value preservation; repeated/bounded results; source viewing; correction history; missed-row recovery with explicit human acceptance; selected appointment PDF. Ambiguous rows remain visible outside charts. Account isolation, image validation, encrypted content storage, cache invalidation and migration/restore verification have automated coverage.

**Main limitation:** recognition coverage. The generated multilingual benchmark reached 95% exact row recall with positioned text, but 57.5% after actual OCR of clean/small variants. No incorrect plotted point occurred in that small set; that is encouraging safety evidence, not proof of universal error detection. Improving photo capture quality and OCR/layout handling has greater immediate patient value than adding clinical interpretation. Complex cumulative tables, unreadable originals and handwriting remain limited.

**Security promise:** the application reduces exposure and has substantive safeguards. “Ironclad” would be an unjustified claim. Production key custody, HTTPS, provider retention, backups, operational access and independent review are still deployment gates. Intentional unredacted upload remains disabled; it must not be advertised as available.

## UX and accessibility

**Implemented:** three clear steps; neutral file titles; explicit full/local or lightweight/manual privacy choice; truthful progress and incomplete-check acknowledgement; source access from a point or table; large controls and visible focus; keyboard/two-tap masking alternatives; readable errors; optional questions; direct PDF download with a location confirmation. The green, restrained visual style suits a records tool. Charts, review items and written results have separate presentations.

**Verified limits:** 360-pixel browser layouts are responsive, and the direct PDF download works. They do not establish usability on a low-memory Android device. The user will run the physical-phone checklist. Test with a retiree and a TalkBack user before claiming simplicity or accessibility conformance. The PDF has selectable Unicode text but is not tagged PDF/UA; HTML data tables remain the better accessibility fallback. First-use full detection still has a large optional model download; the lightweight path avoids it, with a clear manual-review tradeoff.

**Polish priorities:** make the first successful fictional upload the centre of onboarding, observe whether users understand “needs checking,” and measure the number of taps needed to find TSH and prepare a packet. Do not add more controls before those observations.

## Code and technical execution

**Strengths:** pure extraction and chart logic separated from UI; strict runtime schema checks; deterministic conversions; source hashes and optimistic revisions; explicit pending/accepted recovery states; per-account caches; bounded jobs and workers; authenticated encryption tied to account/path; synthetic reproducible benchmarks; isolated HTTP integration; failure-path and stale-account tests. Lazy PDF code keeps document generation out of the initial bundle.

**Technical demonstration:** Meta proposes source-word indices rather than authoring a new medical reading. Deterministic code verifies the evidence and a person confirms it before it appears in the record. A real configured Meta open-weight model completed that path on an invented missed row. Show both the source and the pending state; these make the engineering understandable to a judge.

**Maintainability limits:** client/server contracts are manually mirrored; a generated shared contract is a sensible later refactor. Some coordination services are becoming large and should be split by state transition when requirements stabilize. The file store intentionally supports one API writer. Horizontal scaling would require a different persistence/coordination design, not another instance pointed at the same directory. CommonJS warnings come from the lazy PDF library. No performance or concurrency claim should exceed the measured local tests.

## Hackathon judgement

| Supplied criterion | Strongest evidence | Remaining preparation |
| --- | --- | --- |
| Impact, 30% | A concrete patient problem and a doctor-readable packet | Observe a retiree and a clinician using it; do not invent time-saved numbers |
| Meta tooling, 25% | Source-index recovery, multilingual matching, verified structured proposals | Rehearse a real synthetic call; allow no-proposal/error outcomes |
| Technical execution, 20% | Provenance, privacy boundaries, recovery/rotation tooling, reproducible tests | Show a compact evidence view and explain one meaningful failure case |
| Demo, 25% | Source → masking → chart → checked recovery → offline PDF | Record the three-minute script on the intended device; verify links and original-work attribution |

No score or winning probability is assigned: judging depends on the competing projects and the final live presentation. The submission should lead with the patient outcome and use the verification mechanism as evidence of craft.
