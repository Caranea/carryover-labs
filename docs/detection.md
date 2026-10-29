# Detection of personal details

Code: `src/app/pii/`. Tests: `rules.spec.ts`, `ner-sequences.spec.ts`.

The recommended full local check combines rules and the browser model in `detect.ts → applyDetections()`. A word is
hidden if **any** detector says so, unless it is a protected result value. An explicit lightweight upload choice skips the model entirely (including download), uses rules only, and marks the document's check incomplete. The user must review every page and acknowledge that incomplete check before saving. Stricter pattern rescans do not silently enable the model; upgrading to the full check is a separate action.

## 1. Rules (`rules.ts`)

Deterministic and language-aware (Polish, German, English). Text is compared after
`normalizeToken()`: lowercase, diacritics removed (ł→l, ß→ss), edge punctuation stripped.

| Rule | Example | Hidden as |
| --- | --- | --- |
| PESEL with valid checksum | `44051401359` | national-id |
| E-mail | `biuro@lab.pl` | contact |
| German insurance number (KVNR) | `A123456789` | id-number |
| Long digit strings (≥ 7 digits, ≥ 9 on result rows), not dates | order, sample, card numbers | id-number |
| Polish postcode + following capitalised town | `31-123 Kraków` | address |
| Street cue + up to 4 words | `ul. Długa 12/3`, `Hauptstr. 5` | address |
| Phone numbers split across words | `+48 601 234 567` | contact |
| Titles + up to 3 capitalised words | `dr n. med. Ewa Zielińska`, `Prof. Dr. Weber` | person |
| Field labels + value | `Pacjent:`, `Lekarz zlecający:`, `Einsender:`, `Geburtsdatum:`, `Medicare No:` | per label |
| Name on the line below its label, in the label's column | `Nazwisko i imię:` ⏎ name; `Wykonał: … Autoryzował:` ⏎ two names | person |
| Names under a person column header | `Autoryzował` header above `P.NOWAK, 19412` rows | person, id-number |
| Initial + surname, then a licence number | `P.NOWAK, 19412` | person, id-number |
| Surname first with a title | `SMITH,DR.`, `BROWN, DR.` | person |
| Words from the file name, printed in the document outside result rows | `Jane_Doe_2012.png` → `JANE DOE` on the page | person |

Address, postcode and phone rules are skipped on result rows, so `150-400` or `4,0 - 10,0` are never
mistaken for a postcode or phone number.

File-name words (`fileNameHints`) skip generic words (`wyniki`, `scan`, `results`, `morfologia`…) and
any word that also appears in a result row, so `TSH_2022.pdf` never hides "TSH".

A word that is itself a label is never taken as another label's value. Words that start a table
(`Badanie`, `Wynik`, `Result`…) or name a lab (`Laboratorium`, `Diagnostyka`) are never taken as a
name below a label.

**Label values stop** at: the next `Label:`, a word followed by a `Label:`, a column gap wider than 3×
the text height, a date (except for birth-date labels), a number or lowercase word (for person labels,
except `von/van/de/der/du/da`).

**Result rows** (`isResultLine`): a line with a unit (`g/dl`, `tys/µl`, `mmol/l`…), or with a value and
a range and no address cue. On these lines, values, units and ranges are never hidden by the model.

## 2. The on-device model (`ner.worker.ts`, `NerService`)

- Model: `bardsai/eu-pii-anonimization-multilang` (XLM-RoBERTa base, token classification, BIO labels,
  Apache-2.0), 8-bit quantised ONNX, about 280 MB, run with transformers.js on the WebAssembly backend
  in a web worker.
- **Word-aligned input** (`ner-sequences.ts`): each OCR/PDF word is tokenised separately, so every
  prediction maps back to exactly one word box. Lines are packed into sequences of up to 500 tokens;
  neighbouring lines give context ("Lekarz:" on one line, the name on the next).
- **Per word**, the highest-probability non-`O` label across its sub-tokens is used (`aggregateWord`),
  which favours recall.
- **Label mapping** (`labels.ts → decideLabel`): identity labels are hidden (names, addresses, IDs,
  contact, birth dates, ages). Health, diagnosis, plain date/time, sex and organisation labels are kept
  visible. Unknown labels are hidden (recall first).
- Threshold 0.5 normally, 0.25 in strict mode.
- If the model can't load (no network on first use, old browser, low memory), detection continues with
  rules only and the UI shows a warning on the upload and review pages.

## Combining (`detect.ts`)

1. Words the user toggled (`userSet`), words already removed on the server (`locked`) and words with
   no text are left as they are.
2. A rule hit hides the word.
3. Otherwise a model prediction above the threshold hides it, unless it's a protected result token.
4. **Propagation:** any hidden name, address part or ID of 3+ letters is hidden everywhere else in the
   document, including other pages. The same happens when the user hides a word by hand.

## Document title

Default titles are neutral (for example, Lab document 1), not derived from the original filename. The original filename is local-only. User-entered titles are checked against hidden words and common identifiers, but this cannot certify that a title contains no personal details.

## Strict mode

"Check again, more strictly" reuses the cached model predictions with threshold 0.25 and hides capitalised words directly next to any hidden name (`expandAroundPeople`).
Hand edits are kept.

