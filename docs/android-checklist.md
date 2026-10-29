# Physical Android check

**Status: not run on a physical phone.** Desktop browser checks and synthetic fixtures do not establish performance, accessibility or reliability on a budget Android device. Complete this sheet on the actual phone before making those claims.

Use fictional records only, a separate test account and the intended HTTPS test site. Start with one clear page, then a small multi-page document; do not begin with someone's medical history.

| Record before testing | Value |
| --- | --- |
| Phone model, RAM and available storage | Not recorded |
| Android version and Chrome version | Not recorded |
| App version / commit and test date | Not recorded |
| Connection: Wi-Fi / mobile, signal quality | Not recorded |
| Browser cache: fresh / repeat visit | Not recorded |
| Tester and assistance needed | Not recorded |

Mark each item **pass / fail / not tested** and record what happened. Capture only fictional content in screenshots.

1. **First visit and smaller download.** Open Add lab results in a fresh browser profile/site cache. Confirm Full local check is recommended and the download warning is readable. Select Lightweight review *before* adding a file. It must reach review without downloading the roughly 280 MB name/address detector; OCR and app files can still download. If available, verify requests with Chrome remote debugging; do not infer “no download” from speed alone. Record first-use and repeat-use time to review, and whether the browser reloads or closes.
2. **Camera and documents.** Take a clear fictional page photo. Test portrait and landscape, a rotated photo, a PDF, and three pages queued together. Progress should remain understandable; switching apps briefly and returning should not silently lose work. If Android discards the tab, record the limitation and whether the user understands that unsaved originals must be added again.
3. **Hide personal details.** Zoom the page, hide a word, draw a region by tapping its two corners, undo a new region, and inspect the final preview. A word inside a retained black region must not become visible through Keep. Check margins, stamps and signatures manually. The neutral saved title must not inherit a name or identifier from the original filename.
4. **Incomplete check is explicit.** In Lightweight review, saving must stay blocked until the user acknowledges checking every page. A later edit must require acknowledgement again. “Check again” must keep the lightweight path; the larger detector starts only after the separate explicit upgrade choice. If the full detector fails or is interrupted, the incomplete warning must remain visible.
5. **Full local check.** On Wi-Fi, explicitly choose the full check and repeat the same fictional page with a fresh cache, then a warm cache. Record download size, time to review, responsiveness and any tab crashes. Remove the document during processing: it must not reappear later. A timeout must produce a recoverable message, not an endless spinner. This result determines whether full mode is practical on this phone.
6. **Accessibility and touch.** Enable Android TalkBack, then test large system text and Chrome zoom at 200%. Reach the file picker, check-mode choices, redaction controls, page navigation, acknowledgement and Save. Labels and reading order must make sense; focused controls must remain visible. Check the source image can be zoomed and that chart readings are also available as text/table. Note any action that requires someone else's help.
7. **Slow connection and interrupted saving.** Turn connectivity off before saving, then restore it and retry. The error should explain what to do and preserve the local review. Check the saved list for duplicates after an uncertain upload response. Do not assume a timeout means the server received nothing.
8. **Saved results and human checks.** Open a chart point, inspect its original page, make a fictional correction with a note, and reopen it. For an AI-proposed missed reading, verify nothing is added until source inspection, confirmation and a note. Hiding more source content must invalidate earlier recovery/correction results from that document.
9. **Appointment PDF.** Choose groups, add a fictional question and download. Open the downloaded file in the phone's PDF viewer, then enable airplane mode and reopen it. Check every page for clipped text, missing accents, decimal/comparator changes, missing questions and readable sources. Written/unresolved results must be included as described. Record export time and any memory-related failure; this tests the downloaded PDF, not an offline web app.
10. **Account boundary and cleanup.** Leave a fictional document in review, then sign out and sign into a second test account. Previous local pages, results and saved titles must disappear, including after old requests finish. Repeat while exporting if practical. Delete test documents through the app and remove downloaded PDFs/photos from this test phone; signing out does not erase files in Downloads or the camera roll.

Record each failure with the item number, exact steps, expected/actual result, timing and a fictional screenshot. Privacy leaks, wrong chart values, silent loss of acknowledgement and inability to recover from a stuck state block release. Record slow performance and accessibility problems explicitly; do not convert an untested item into a pass.
