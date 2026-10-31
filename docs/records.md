# Source-linked records

The device does privacy work only: render each page, run one OCR pass without orientation detection or rotation retries, detect identifying details, review, and burn permanent blackouts into a fresh raster. The server never receives the local OCR as authoritative transcription.

## Transcription and normalization

Standard Muse Spark 1.3 receives one approved page image per request. It returns the printed test name, value/comparator, unit, reference interval, flag, specimen/method context, separate collection/order/report dates, uncertainty and source region where available. Every row has a stable document/page/row reference. The raw transcription remains unchanged alongside user corrections and normalized results. The existing source dialog opens the saved image and displays the original transcription.

Once every retained document is approved and every page succeeds, standard Muse Wonder 1.0 receives distinct structured name/unit/context combinations across the batch. It proposes catalogue identities or new identities with readable labels and existing categories. Exact reference coverage and schemas are validated. Unresolved mappings remain visible and cannot fall through to fuzzy catalogue aliases. Different forms, specimens and methods stay separate series. Recognized specimen translations can share identity; unfamiliar explicit specimens and methods are conservatively separated by their printed context.

The model never supplies numeric conversion factors or molar masses. Existing verified unit parsing, dimension/scale arithmetic and catalogue molar masses perform supported conversions. Missing, incompatible or unsupported units do not get guessed. Every point retains its printed value, unit, reference and source. Exact and bounded values remain separate observations, even on the same date. Related tests may share a chart category without becoming one series.

## Browser coordination

The existing queue checkpoint stores a random batch ID and stable local document IDs. Approved history stores document/page references, completed page transcriptions and the final normalization response. Binary page images remain in IndexedDB; text metadata and results remain in localStorage. Approval starts eligible page transcription while other files are still being prepared/reviewed. At most three pages run at once. Each success is persisted immediately; failures remain retryable without repeating completed pages. Normalization never starts while retained documents need approval or pages remain unfinished.

Processing version 2 invalidates earlier extraction/normalization caches. Saved approved images are reused without re-uploading originals or repeating local OCR. Legacy text-only saves without an image must be added and reviewed again. Explicit user corrections are retained during migration. Existing revisions reject responses for deleted or replaced documents and stale normalization snapshots. No new server coordination or retrieval mechanism was added.

The selected-page missed-reading flow reuses Spark image transcription. Suggestions remain excluded until the user inspects the source and accepts them with a note. Old word-index recovery is no longer a network path.

## Limits and verification

A model can omit or misread text and can classify identity incorrectly. Schema checks do not prove image-reading accuracy. Date or unit gaps remain unresolved, and uncertainty is visible in the source dialog. Local one-pass OCR is unreliable on sideways/upside-down text; explicit manual privacy confirmation remains mandatory for image pages.

See [pipeline verification](pipeline-verification.md), [API details](api.md) and [privacy boundary](privacy-and-redaction.md).
