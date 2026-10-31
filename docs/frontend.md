# Frontend (Angular)

Angular 21, standalone components, signals, no zone.js, client-side rendering only. Styles use Tailwind/daisyUI with global tokens in `src/styles.css`.

## Routes (`app.routes.ts`)

| Path | Component | Purpose |
| --- | --- | --- |
| `/` | `HomePage` | Public homepage |
| `/documents` | `UploadPage` | Add files and reopen browser history |
| `/review/:localId` | `ReviewPage` | Review redaction and save locally |
| `/saved/:serverId` | `OpenSavedPage` | Open a locally saved source (parameter name retained) |
| `/results` | `ResultsPage` | Source-linked charts and Meta checks |
| `/demo` | `ResultsPage` | Fictional prepared sample |
| `/appointment` | `AppointmentPage` | Select sections and export a PDF |

All routes are public. All pages are lazy-loaded. Unknown paths redirect to `/`.

## Services

| Service | File | Responsibility |
| --- | --- | --- |
| `LocalHistory` | `core/local-history.ts` | Atomic localStorage history and corrections; IndexedDB page images; idempotent approvals and revision checks |
| `QueueRecovery` | `core/queue-recovery.ts` | Atomic IndexedDB file/edit checkpoints with small localStorage progress markers; refresh recovery and stale-tab protection |
| Name privacy validation | `core/document-name.ts` | Recognises visible report dates when validating a user-entered title; no local result parsing or categorisation |
| Name suggestions | `api/src/demo/source-processing.ts` | Spark suggests a general title after transcription; user-entered names are preserved |
| Repeated personal details | `pii/remembered-details.ts` | Local, source-attributed matches across automatic/manual reviews; persisted in IndexedDB, excluded from progress markers and manifests |
| Clinical term protection | `pii/medical-terms.ts` | Exact catalogue spans in result rows or standalone headings survive automatic false positives; explicit hides and drawn regions remain |
| `DocumentQueueService` | `core/document-queue.service.ts` | All document state and the workflow: add, process, rescan, toggle, regions, rename, approve, open saved, delete |
| `DocumentsApi` | `core/documents-api.ts` | Local history plus stateless Meta requests |
| `ExtractionService` | `extraction/extraction.service.ts` | File type detection and limits, dispatch to readers |
| `OcrService` | `extraction/ocr.service.ts` | One reusable multilingual OCR worker, one pass per page, original-image coordinates and timings |
| `NerService` | `pii/ner.service.ts` | Starts the model worker, reports download/startup/page progress and measured estimates, supports cancellation and explicit retry |

## Readers

- **PDF**: pdf.js freshly renders pages at the existing rendering resolution. Text layers are never read. Each raster gets one privacy OCR pass. Only approved redacted rasters can be uploaded.
- **Images**: HEIC/HEIF uses the existing decoder. Browser display orientation is respected, but no OCR autorotation occurs. Full-resolution images are retained for accurate masks; only the OCR input is scaled to a maximum side of 2000 pixels. OCR boxes map back to original pixels.
- **OCR**: Tesseract 7, LSTM `pol+deu+eng`, one call with `rotateAuto:false`. No OSD worker, angle search or retry loop. Sparse/unreadable output does not imply privacy safety.
- **DOCX/TXT/CSV**: visible text is rendered into pages and privacy checked, so these imports also upload only pixels.
- Limits: 40 MB per original file and 40 rendered pages. Old Word `.doc` remains unsupported.

The existing queue persists the batch ID, documents, user masks and confirmed personal-detail reuse. Every image page requires explicit manual privacy acknowledgement. Completed page transcriptions are saved independently in browser history. The Documents/Results views show transcription and normalization progress. Results remain unavailable while queue documents need preparation, approval or removal; failed page processing offers retry through the existing flow.

## Components

- `App` (`app.ts`): header with wordmark and public navigation.
- `DetectorStatus`: opens a native privacy-check dialog when the full check starts. Shows why the check is needed, download/startup/page stages, measured time estimates when available, and plain-language failure/retry guidance. Closing it keeps work running; the header button reopens it. Switching to the lighter check stops the worker, preserves files and existing masks, and applies to waiting documents. Manual review acknowledgement remains required for incomplete checks. Downloads time out after two minutes without progress or one hour overall, allowing an active large download on a slow connection; each page check is bounded to 45 seconds. Cached weights skip the network-download stage.
- `UploadPage`: privacy mode choices, drop zone ("Choose files", "Take a photo" on
  touch devices), "On this device" queue with progress, "Saved in this browser" list
  with "Hide more" and delete confirmation.
- `ReviewPage`: toolbar (Click words / Draw a box, See under the bars, Text only), pages, side panel
  (document name, hidden count by kind, "What was hidden" list with Show buttons, checklist, strict
  re-scan, Approve and save / Save changes, Discard).
- `PageView`: page image with an SVG overlay in page coordinates. Visible words are invisible click
  targets; hidden words and regions are black rectangles drawn with the same padding as the burn-in, so
  the screen matches the saved image.
- `ResultsPage` (`/results`): sends each unprocessed approved OCR document to `POST /api/demo/extract`, then server-derived rows/classifications to `POST /api/demo/records` ([records.md](records.md)). A loader is followed by results or a retryable error; local charts are not used as a fallback. Up to three documents process concurrently. Per-document results are saved immediately for refresh/retry; completed charts are cached against the current history revision. Approval itself only saves the redacted source and images, without local row parsing or category-based title suggestions.
  - Counts, search, and jump links per section.
  - Per domain: chart cards (`LineChart`) and a "Measured once" list.
  - "Results in words", "Left out of the charts" (each with its reason), and "Everything that was read"
    (the raw rows, with OCR corrections underlined).
  - No high, low or normal anywhere.
- `LineChart`: hand-drawn SVG time chart. Crosshair tooltip with value, printed name and source;
  click or Enter on a dot emits the point.
- `SourceDialog`: opens a saved page and outlines the box a value was read from, scrolled into view.
- `TextView`: words as buttons line by line. Used for DOCX/TXT and as a keyboard-accessible view of
  any page.

## State model (`core/models.ts`)

- `LocalDocument`: `localId`, optional `serverId`, `name` (sanitised title), `fileName` (local only),
  `sourceKind`, `status` (`queued | reading | detecting | review | saving | saved | error`), `strict`,
  `progress`, `message`, `error`, `pages`, `file`.
- `WorkingPage`: size, local image Blob + object URL, `words`, `regions`, `lockedRegions`, `ocr`.
- `WorkingWord`: `id`, `text` (null once removed), `box`, `line`, `hidden`, `locked`, `userSet`,
  `kind`, `source` (`model | rule | you`), `score`.

Queue files, extracted pages, redaction edits, names, privacy choices and selected document are checkpointed on this device. IndexedDB stores the full queue atomically; localStorage holds a small progress marker, never photo payloads. Ready documents reopen after refresh, interrupted OCR/detection resumes, and an interrupted approval is matched to local history by its queue ID so it cannot create a duplicate. Originals are removed from the checkpoint after approval or discard. Progress percentages alone do not rewrite files. Storage failures remain visible with retry, block the “saved” indicator and trigger a browser leave warning while changes are uncommitted. A revision check prevents another tab from silently overwriting the queue. Existing base64 history images remain readable; new approved page images use IndexedDB.

## Self-hosted assets (`angular.json → assets`)

Copied from `node_modules` at build time:

| Served at | From |
| --- | --- |
| `vendor/pdfjs/pdf.worker.min.mjs` | pdfjs-dist |
| `vendor/pdfjs/{wasm,cmaps,standard_fonts,iccs}/` | pdfjs-dist (decoders for scanned PDFs) |
| `vendor/tesseract/worker.min.js` | tesseract.js |
| `vendor/tesseract-core/*.wasm.js` | tesseract.js-core (legacy OSD and LSTM variants; only the needed cores are fetched) |
| `vendor/tessdata/{pol,deu,eng}.traineddata.gz` | @tesseract.js-data/* (4.0.0_best_int) |
| `vendor/tessdata/osd.traineddata.gz` | Tesseract tessdata 4.1.0; compressed size 4.39 MB, Apache-2.0 |
| `vendor/ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` | onnxruntime-web |

Paths are defined once in `core/assets.ts`. The model worker is built from `tsconfig.worker.json`.

## Device selection and local model preparation

`model-selection.ts` checks a real WebGPU adapter, `shader-f16`, buffer limits of at least 384,003,072 bytes, and successful device creation before any privacy weights are requested. Software adapters and reported device memory of 4 GB or less use CPU/Q8. A four-second timeout also selects CPU. The main page previews that decision without downloading weights; the worker repeats the check before loading. Only an available GPU export manifest enables GPU loading. A GPU load/warm-up failure is retried in a **fresh worker** on CPU, because a failed runtime session can poison subsequent sessions in the same worker.

The GPU model is the same `bardsai/eu-pii-anonimization-multilang` detector, converted from original full-precision weights at revision `62ca5712368705bac11b8fea19e42e65cce088dd`. Prepare it before `npm run build`:

```sh
python -m pip install onnx==1.23.2 onnxruntime==1.31.1
python scripts/prepare-gpu-model.py
```

The script downloads the public original model (about 1.11 GB) once for development, converts it with ONNX Runtime's FP16 converter, checks graph/runtime validity, and writes the approximately 555 MB export and provenance manifest to `public/models/pii-fp16-62ca5712-v1/`. Original and generated weights are Git-ignored. Include the generated directory in the deployed build; without it, selection safely uses CPU. The versioned path keeps an old browser cache from silently serving a different export. Re-running the script verifies and reuses an intact export. Do not use the generic onnxconverter-common converter for this checkpoint: its output retained incompatible float32 Cast attributes in the attention layers.

The recommendation is a small badge beside the applicable option. Timing labels show broad, explicitly rough planning ranges for a 500-word page until session measurements replace them. Measured detector time is normalized to 500 words and combined with recent photo-reading time. Manual-review timing covers photo reading only, not the person's editing time. Download time is separate, uses observed network transfers from the model's origin when available, then the browser's coarse downlink hint (or explicitly states a 10 Mbps assumption). It updates from actual transfer progress and disappears when the selected weights are cached. These estimates are not hardware benchmarks or completion guarantees.

## Design system (daisyUI)

The UI is built with **Tailwind CSS 4** and **daisyUI 5**, with one custom light theme named
`carryover` defined in `src/styles.css`. The public landing page follows the structure of
[daisyui.com](https://daisyui.com): a two-weight headline, pill buttons, and a tilted stack of real UI
cards. The tone aims for calm and medical rather than technical: soft rounded shapes, a trustworthy teal,
friendly type.

**Two marks still carry the meaning:** a black bar means *removed*, a yellow highlighter means *kept*.

### Theme tokens (`@plugin 'daisyui/theme'`)

| Token | Value | Use |
| --- | --- | --- |
| `base-100` / `base-200` / `base-300` | `#ffffff` / `#f4f7f6` / `#e3ebe8` | Surfaces, section bands, borders |
| `base-content` | `#16302c` | Text (deep green-ink) |
| `primary` | `#0d7a68` | Main actions, steps, icons (teal) |
| `secondary` | `#ea7d61` | Reserved for warm accents |
| `accent` | `#fcd34d` | Highlighter: kept values, "new result" |
| `neutral` | `#16302c` | Dark cards ("Blacked out") |
| `success` / `info` / `warning` / `error` | `#17a058` / `#2f7fd8` / `#f2a516` / `#d4372c` | Statuses |
| Radii | box 1.25rem, field 0.75rem, selector 2rem | Rounded and soft; buttons use `rounded-full` |

**Type:** *Outfit* (headings, as on daisyUI's site; bold and light weights paired in one headline) and
*Figtree* (body). Both are self-hosted through @fontsource.

**Icons:** Lucide line icons through `app-icon` (`src/app/ui/icon.ts`). They are imported one by one
from `lucide-static`, so only the icons used end up in the bundle. To add one, import it and add it to
the `ICONS` map.

### daisyUI components in use

| Where | Components |
| --- | --- |
| Shell | `navbar`, privacy status button + native `modal` with `progress`, `toast` + `alert`, `footer` |
| Landing (`landing/home.page`) | Hero copy and cards, public navigation, steps and FAQ |
| Upload | Dashed `card` dropzone, `list` / `list-row` queue with `badge` and `progress`, `table` of documents, `skeleton` loading, `modal` to confirm deletion |
| Review | `steps`, `breadcrumbs`, `join` mode switch, `toggle` for "See under bars" / "Text only", `fieldset` + `input`, `badge` counts, `collapse` list with "Keep" buttons, `alert`, `loading`, block `btn` for approve |

### Things to know

- **Class name clashes:** Tailwind and daisyUI own some generic class names. `hidden` sets
  `display: none`, and `stack`, `range`, `collapse` and others are daisyUI components. Custom classes
  in component styles must avoid them; that's why redacted words use `.redacted`.
- **Whitespace:** Angular strips whitespace between elements. Use `{{ ' ' }}` between inline spans
  that need a space (for example two-weight headlines).
- **Accessibility:**
  - daisyUI focus styles;
  - 44 px or larger touch targets for primary actions;
  - a text-only view for keyboard use;
  - reduced motion respected;
  - responsive layouts (the tilted stack becomes a flat column on small screens, and the step
    indicator hides on phones).


