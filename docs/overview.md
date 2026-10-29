# Overview

Carryover helps a patient organise a history of lab reports for a short medical appointment. It keeps the clinician responsible for interpretation.

1. Add a photo, PDF, Word or text document. Reading and personal-detail detection happen locally.
2. Check the hidden details on every page. Hide more with words or regions, then approve the redacted copy.
3. Open results grouped by domain and test. Each reading links to its source; missing dates, missing units and uncertain readings remain visible for checking.
4. Correct a reading while inspecting the source. The original and change history remain available.
5. Choose the sections to bring to the appointment, add your own questions and print or save the record as a PDF.

The `/demo` route uses entirely fictional records and requires no account. It is a prepared sample, not a live inference run.

Muse Spark helps map unfamiliar lab names and flag possible reading/matching errors. Deterministic code handles numeric conversions, validates model response shape and preserves source references. Carryover does not generate diagnoses, treatment plans or a medical interpretation.

See [limitations](limitations.md), [privacy](privacy-and-redaction.md), [records](records.md) and [development](development.md).
