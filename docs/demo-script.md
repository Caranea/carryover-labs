# Carryover: three-minute submission demo

Working script for **Build for Your World**, based on the participant guide supplied by the team. Carryover organizes source records for an appointment; it does not diagnose, interpret results or recommend treatment. All visible people, documents and readings must be entirely fictional.

## Recording gates

The main script below is the target recording, not a claim that every step has already passed live verification.

| Segment | Required evidence before recording | Current recording rule |
| --- | --- | --- |
| Local masking and save | Run the actual upload/review/save flow with a fictional file and the session used for recording | Use a real authenticated session for a public product demo. If using isolated test authentication, label it explicitly; do not present it as a completed Clerk sign-in. |
| Prepared multilingual history | Inspect `/demo`, or an explicitly prepared fictional account with the same source-backed readings | Show a persistent **Fictional prepared sample** label. `/demo` does not call an AI model. |
| Live missed-row recovery | Confirm a fresh request to the configured Meta model with the split-row fixture; record model/provider, time, returned evidence, and successful explicit acceptance | Service-path verification passed on 29 October: Baseten `meta-models/muse-spark-open-1026`, 9.9-second model step, 10.1 seconds overall. One verified proposal was explicitly accepted and charted. The immediately preceding identical-fixture attempt returned no verified proposal. Rehearse the real browser flow separately and retain the fallback. See [the full evidence and caveats](synthetic-recovery-check.md). |
| PDF download | Click the actual download button, open the resulting file, and check its contents | The current export engine passed visual inspection, and the integration owner confirmed an actual browser download. Recheck the final selected groups/questions in the recording browser. |

Do not show an edited jump from a loading state to prepared output as continuous live inference. If a wait is shortened, put **Processing shortened: actual wait X seconds** on screen. A recording of a real earlier inference must say **Recorded live run**, with its date and actual duration. If no real run succeeds, use the honest fallback below.

## Setup

- Use the fictional multilingual fixture set and `split-row-challenge` from `fixtures/synthetic-labs/cases.mjs`. Inspect its rendered image before recording. Do not use private medical photo fixtures, even if the names were replaced.
- Prepare a fresh copy of the split-row source with no previous recovery decision. The chosen row must be missing from the first extraction, visibly present on the saved source, and supported by a printed unit and unambiguous collection date. Check that the live model actually recovers it; do not fabricate a proposal.
- Keep the five-report prepared timeline available. If it is a separate tab/account-free sample, say that transition aloud and retain its fictional label. Do not imply that one new upload created the years of history.
- Warm only the ordinary application assets needed for a smooth recording. Do not conceal the first-use privacy-model download: the full check is roughly 280 MB; the lightweight option skips it and requires the user to check missed names/addresses. A desktop recording is not proof of budget-phone performance.
- Use a general document title such as “Fictional September report”. Check that masked names remain hidden in both saved image and accessible text. Show the real storage notice; development plaintext must never be described as encrypted.
- Prepare one short question, such as “Which previous results should we review together?” Keep the source, a chart point and the PDF large enough to read at video resolution. Use visible pointer focus and captions; avoid rapid scrolling.

## Timed script

The spoken copy is deliberately short to leave room for interaction and a visible model wait. Rehearse to 2:55, leaving five seconds of export margin.

| Time | Screen and action | Spoken copy |
| --- | --- | --- |
| 0:00–0:15 | Show three fictional reports in Polish, German and English, then the simple Add files screen. Small caption: **Fictional records · Built for the appointment**. | “Ten years of illness can become a pile of reports in different languages. Your next doctor has twenty minutes. Carryover helps you bring a readable history, with the original evidence close at hand.” |
| 0:15–0:45 | Add the fictional split-row report. Choose the demonstrated privacy mode. Hide its invented identity, zoom once, and inspect the preview before saving. Show the incomplete-check acknowledgement if using lightweight review. | “The document is read on this device. I can hide personal details before approving the copy to save. On an older phone, lightweight review skips the large detector download. It still needs my careful check.” |
| 0:45–1:00 | In results, choose the saved document and page under **Find missed readings**. Show the disclosure, then press the explicit start button. Keep the actual working state visible briefly. | “This row was split across lines and the first pass missed it. I explicitly ask the configured Meta model to check this saved page. Only its visible text is sent; anything I left visible is included.” |
| 1:00–1:32 | While the request runs, show the clearly labelled prepared multilingual history. Choose Thyroid. Point out TSH and free T4 on separate charts, open one point and its source, then show the missing-unit reading held for review. | “Here is our prepared fictional history. Different printed names become a navigable timeline. Each test has its own scale, and every point leads back to its source. Missing dates, uncertain readings and incompatible units stay visible for checking instead of quietly becoming a confident-looking chart.” |
| 1:32–2:10 | Return to the real recovery request. Show the actual proposal and saved source. Compare name/value/unit/date; tick confirmation, enter a short factual note and accept. Show the refreshed result and its checked status. | “The model proposes a reading by citing words already on the page. The server checks that evidence. It cannot add a chart point on its own. I inspect the source and accept this exact proposal. The decision is recorded; a missing unit or date would still need correction.” |
| 2:10–2:45 | Open appointment view. Select Thyroid, enter the question and click **Download appointment PDF**. Open the downloaded file. Show a chart/table, unresolved section and source bibliography. If feasible, open the saved file after disconnecting the network. | “For the appointment, I choose the relevant groups and add my question. The downloaded PDF includes readable charts, exact source values, readings still to check and source references. Polish and German text survive the export. Once saved, this file opens without an internet connection.” |
| 2:45–3:00 | End on the appointment record and a small new-work/evidence card. Do not replace the product with a wall of architecture text. | “Carryover helps a person arrive prepared and helps a doctor find the evidence. Meta handles the difficult language and layout proposals; explicit checks preserve the source. Our focus is trustworthy organization, with medical decisions left to the clinician.” |

If the actual recovery has not returned by 1:32, keep its honest status visible and use the recorded fallback. Never accept a different row merely to reach the next scene. If the accepted row remains unresolved, show that truthful outcome and explain what must be checked; do not imply that acceptance guarantees chart eligibility.

## Fallbacks that preserve credibility

**Real earlier run available:** label the segment **Recorded live Meta run — [date], [model], [actual elapsed seconds]**. Retain the original uncut recording and redacted request/result evidence. Narration: “The provider is taking longer in this take. This is a recording of our earlier real request on the same fictional layout; the user still has to verify and accept it.” Do not call this segment live.

**No successful real recovery run:** retain the source-linked charts and PDF as the working product. Show the real unavailable/error status, then use a brief explicitly labelled **Recovery workflow preview — simulated response** only if helpful. Narration: “The source-constrained recovery workflow is implemented and tested with controlled responses. This session has not verified it against the live provider, so we are not presenting it as a successful live model result.” State this limitation in the submission. Do not substitute the successful name-mapping check for missed-row recovery evidence.

**PDF interaction fails:** show the actual error and, if necessary, open the independently generated sample labelled **Pre-generated PDF from the same export engine**. Do not say that the failed click downloaded it. Fix the interaction before submitting if time permits.

**Local processing is slow:** leave the stage/status visible, briefly explain it, and continue with the labelled prepared sample. The final video may shorten the wait with its actual duration shown. Never claim instantaneous import or physical Android performance from desktop testing.

## What to show as technical depth

Use one short evidence card during the close, with more detail in the repository. The visual centerpiece should remain the verified proposal becoming a source-linked result.

| Judge category from supplied guide | Evidence in the demo | Supporting repository evidence |
| --- | --- | --- |
| Impact — 30% | A patient can find one test across years, prepare questions and carry a readable appointment record | Simple capture/check/view flow, older-phone privacy option, keyboard alternatives and chart tables; physical-device validation still needs evidence |
| Meta tooling — 25% | A real request proposes a missed split-row reading; multilingual name matching joins equivalent tests | Visible-word evidence contract and validation; account-specific matching cache; real model/provider and actual latency recorded separately |
| Technical depth and execution — 20% | Source inspection, uncertainty held out, explicit acceptance, trustworthy PDF dates and references | Strict response schemas, source revisions, correction/recovery audit trail, stale-source rejection, account isolation, bounded work and deterministic export tests |
| Demo — 25% | A coherent three-minute journey ending in a useful file | Readable capture, labelled prepared/synthetic material, a rehearsed fallback and verifiable recording evidence |

The Meta contribution is constrained language/layout reasoning. It does not invent a missing number, supply clinical interpretation, perform all OCR, or guarantee privacy. Redaction, deterministic unit handling, evidence checks and export are separate engineering work. State the model identifier actually configured for the verified run; do not infer it from a product label.

## Benchmark language

Use the final regenerated benchmark reports at submission time, not a copied percentage from an earlier run. Record mode, fixture count, date and code revision beside any figure.

- `node scripts/benchmark.mjs` uses positioned synthetic text; it does not measure OCR.
- `node scripts/benchmark.mjs --ocr` adds Tesseract recognition of clean and reduced-size synthetic images. It is still not a real-world clinical or camera study.
- Report exact-row recall, precision, unsafe plotted readings and held-for-review counts separately. A useful result can be “this error was held for checking”; that is not successful extraction.
- Pattern-based personal-word box coverage excludes the optional NER model and is not overall privacy recall. Perfect coverage on invented names/layouts cannot establish that every real identifier will be removed.
- Recovery success on one deliberately split row is an integration demonstration. It is not evidence of general extraction accuracy. Keep its result separate from the benchmark unless the benchmark explicitly includes that exact live stage.

Safe voiceover if asked: “We publish a small reproducible synthetic benchmark and its failures. We have not clinically validated this system or established real-world privacy recall.”

## Honest new-work attribution

The supplied building period starts **27 October**. The repository's initial commit is **83c6e58, dated 26 October**, and is an Angular scaffold. There was also uncommitted work before this review; that commit alone does not prove when every later file was authored.

Before submission, have the team fill a feature-by-feature inventory with **pre-event / built during event / provenance uncertain**, contributor, dates and supporting evidence. Link the inventory beside the demo and show a legible closing card listing only verified event contributions. Do not backdate a commit, call the entire working tree new, or relabel unverified work as event-built.

Candidate items from the 28–29 October implementation sessions include source-preserving extraction repairs, conservative dates/units, checked corrections, account-isolated caches, stronger redaction/storage boundaries, accessible source controls, the labelled fictional sample, source-constrained recovery, direct appointment PDF export, lightweight privacy review, benchmark tooling and storage-operation verification. The team must confirm their individual dates and contributors. Existing upload/OCR/PII detection/charting/Meta integration foundations need their own provenance check.

A useful inventory row is: **Feature → files → initial state → event change → author/date → evidence → demo timestamp**. Preserve a snapshot of the actual pre-event material if available and a final submission commit. A diff against the scaffold is supporting evidence, not proof that all changes occurred after the event began. Public code and a working video must remain accessible; remove credentials, private documents and patient-derived fixtures before publication.

## Verified PDF artifact

`output/pdf/carryover-fictional-appointment.pdf` is a six-page, 46,660-byte fabricated appointment record. On 29 October it was regenerated from the current `scripts/export-sample-pdf.ts` and `pdf-engine.ts`; the new bytes matched the delivered artifact exactly:

`SHA-256 181599fde28ec79f333e90c5035e0ac1ce63497e329aad23c769f1776f812419`

All pages were rendered and inspected. Text extraction retained Polish/German characters and calendar dates; page boundaries and footers were checked. This verifies that sample and export engine, not the browser's download permission behavior, PDF accessibility conformance, clinical correctness or arbitrary future documents. The PDF contains health information when used with real records; it is not an encrypted file.

## Final recording evidence log

Keep this small log with the uncut recording. Replace placeholders only with observed results.

| Check | Record before submission |
| --- | --- |
| Source and account | Fictional fixture ID/hash; actual authentication or explicitly labelled isolated test session |
| Live recovery | Date, model/provider, elapsed time, source revision, proposal evidence, acceptance result; otherwise state “not verified” |
| Browser export | Browser/device, successful download filename, opened page count, selected groups/question preserved |
| Benchmark | Report paths, run date, fixture count/mode, code revision, failures and held-out readings |
| New work | Team-approved attribution inventory and event contribution list |
| Hardware/accessibility | Actual device and checks performed; do not turn a responsive viewport into a physical-phone claim |

Do not claim “ironclad”, “clinically validated”, “all personal data removed”, “production-ready”, or “works offline” for the whole application. The narrower demonstrated claims—explicit local review, source-constrained proposals, transparent uncertainty and an offline-readable saved PDF—are stronger because the judges can inspect them.
