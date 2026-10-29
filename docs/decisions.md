# Decisions

Short records of choices made so far. Newest last.

### 1. Redaction happens on the device, not on the server
Uploading originals and redacting server-side would mean holding unredacted health records, even
briefly. Doing it in the browser means the server never has them. Cost: heavier front end (OCR engine,
model download).

### 2. A browser model finds personal details, with rules alongside
Allowlists ("keep only known lab test names") and document skeletons both failed on real documents:
doctors' names, technicians, insurance numbers and lab addresses appear in unpredictable places.
A multilingual token classification model generalises to those; rules add targeted checks for
structured things (PESEL checksum, postcodes, labelled fields) and keep working if the model can't load.

### 3. Recall first, with the user as the final check
Over-hiding costs a click to show a word; under-hiding leaks data. So every detector can only add bars,
unknown model labels are hidden, and the user approves the redacted version before anything is saved.
Result values are protected so recall doesn't destroy the data the product exists for.

### 4. Upload a burned image plus visible text, not the original with annotations
A new JPEG has nothing under the bars and no metadata. Visible text is uploaded too so step 2 can read
results without running OCR again. Hidden words are kept as `null` with their position, so the layout
(and step 2's table parsing) still works.

### 5. Saved documents can only gain hidden parts
"Hide more" edits the already-redacted copy. The server enforces that nothing hidden before becomes
visible, so a client bug can't undo a redaction.

### 6. Backend in NestJS (TypeScript), not Python
Same language and tooling as the Angular app, and the maintainer works in TypeScript. Model inference
for step 1 runs in the browser, so Python's ML ecosystem isn't needed on the server yet.

### 7. Client-side rendering only
The original scaffold had SSR. It was removed: the work needs browser APIs, every page but sign-in is
behind auth, and SSR would complicate dynamic imports of browser-only libraries for no benefit.

### 8. Self-host processing assets
OCR engine, language data, PDF worker and ONNX runtime are served by the app instead of a CDN, so
third parties don't see when documents are being processed. Exceptions: the model download from Hugging
Face (no user data, cached) and Clerk's sign-in UI.

### 9. Clerk for authentication
Hosted sign-in (e-mail, social) with no password storage on our side. Clerk's npm package ships
without UI, so the UI script is loaded from Clerk's CDN on account screens only.

### 10. Files on disk for storage (for now)
Folder per user (hashed id) and per document, atomic writes. Enough for the hackathon and easy to
inspect. The storage class is injected so it can move to object storage later.

### 11. Unsaved documents live in memory only
Reloading the tab discards them. Keeping originals in IndexedDB would be convenient but would leave
unredacted health data on the device after the user thinks they're done.

### 12. No "Your details" for the demo
An optional panel where users typed their own name, PESEL and address (kept in browser storage) to
improve matching was removed to keep the demo simple. Rules and the model already find labelled names;
the review step and the server's PESEL check cover the rest. The declined-form matching survives in the
file-name cleaner, which compares against words hidden in the document instead.

### 13. A visual system built from the subject
For the demo, the visual layer has to carry the product. Following greptile.com's technical-editorial
confidence (one loud display face, a mono voice, one electric accent, hatching, shaped buttons) but
grounded in lab printouts: black bars for what's removed, highlighter for what's kept, a monospaced
printout voice. Atkinson Hyperlegible stays for body text because many users are chronically ill and
older.

### 14. Switch to daisyUI, with a calmer medical tone
The custom technical-editorial look (monospace, sharp corners) read as a developer tool, not a health
product. The UI moved to Tailwind CSS 4 + daisyUI 5 with a custom teal theme, rounded components,
Outfit + Figtree type and Lucide icons. The landing page is modelled on daisyui.com's homepage. Using a
mature component library also keeps the design consistent as new screens (charts) are added.

### 15. Deterministic extraction first, models second

Step 2 rebuilds result rows with plain TypeScript rules (headers, columns, ranges, locale) rather than
a model. The rules are fast, free, testable, and they always point to the exact words used. Muse Spark
will be added for the rows the rules miss, with every model value checked against the page, so a
number that is not printed there can never enter the record.

### 16. Extraction on the server, from redacted words

The API extracts from the visible words the user approved, not from the original file. This keeps
the privacy boundary of step 1 intact, and lets results be recomputed for every document when the
extractor improves (`EXTRACTOR_VERSION`), without the user uploading again.

### 17. Preserve source readings; do not infer a decimal point

Printed reference ranges remain source data. Values, ranges and units are not changed to fit a range or a lab flag. A suspicious reading becomes a review item, and a user can confirm or correct it with an auditable overlay.

### 18. Rules first; Meta suggestions scoped to one account

Common aliases and verified unit arithmetic are deterministic. Muse Spark maps unfamiliar names and checks name matches. Strict response schemas and application checks precede use. Learned suggestions belong to one account and are invalidated by document deletion/redaction. They are not safe to share globally because missed personal text can enter an extracted field.

### 19. Numeric conversions require deterministic evidence

Only compatible dimensions, known scales and known molar masses authorise factors. A model-generated positive number is not proof of a valid conversion. Missing or incompatible units stay unresolved for source review.
### 20. A test is charted in the unit printed most often for it

So a Polish user sees mg/dL and tys/µl, not a foreign standard. The printed value and unit are kept on
every point and shown in the tooltip.

### 21. Hand-drawn SVG charts

No chart library: the charts are small, need a custom hover (source document, open the page) and must
match the design system. One file, no new dependency for the Windows install.

