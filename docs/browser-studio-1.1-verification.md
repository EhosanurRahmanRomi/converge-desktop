> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Browser Studio 1.1 verification

Date: 2026-10-01. Windows x64, Electron 44.5.1.

## Changes from the supplied recording

The recording showed successful cookie import, two signed-in pages, a mandatory Unpersonalized gate, and an unrecognized “Ask ChatGPT” composer after reload. The file button could not be used while that readiness failure persisted.

The replacement separates cookie import from opening the pair. It offers Temporary, Normal and Work with an explicit OK button; Temporary permits the existing personalization choice. Composer detection includes the current Ask ChatGPT variants, ignores nested duplicate editor wrappers, and refreshes after delayed page hydration. Missing input is reported as unknown readiness rather than automatically declaring a signed-out session.

Later commands reuse the same two conversations with a fresh review identity and ledger. Reset returns to the opening choices and preserves the app's imported cookies. Normal and Temporary leave a visibly selected Work surface before becoming ready; Work needs visible selection evidence.

## File workflow

- Native file selection reads a supported source document and attaches it to both pages. Both uploads need visible confirmation.
- A PDF upload enables Require a revised file. A required PDF task needs actual downloadable PDFs from both independent drafts; text alone cannot satisfy agreement.
- Candidate output files are attached to the next reviewer. A changed file creates a new candidate and invalidates previous acceptance. Prose describing a correction does not become a corrected PDF.
- Exports support readable displayed images, accessible download links and visible native file download actions, including supported filename links using the sandbox scheme. Native downloads go through the page's own click handler and Chromium download event. The app does not invent a private file API URL.
- Original page/request identity, filename, MIME and file bytes are checked during relay and saving. Later exports must match the first content hash.
- Save final files saves the accepted candidate. Save current files preserves a completed candidate after Stop, without restarting canceled automatic exchange.
- Reload is blocked while source files await submission. Before sending, a draft also checks that its expected source documents remain attached.
- Limits: five files, 12 MB each and 24 MB total. Native transfer files use private temporary paths and are removed after reading or cancellation.

## Automated checks

`npm test`: **128 passed, 0 failed**. Coverage includes mode selection and Work exit, follow-up commands, exact candidate agreement, required PDF outputs, removed source documents, native download isolation and size bounds, Stop cancellation, saving retained completed outputs, changed file rejection, and export filenames.

Source desktop integration: **18 stages passed**. Packaged desktop integration: **18 stages passed**. Both native application and renderer bootstrap report **1.1.0**. All **11 production files** loaded from the final app archive match source by SHA-256. The packaged run captured the shell, PDF result card and separate native views with no capture warnings. The earlier source run reported unsupported native child capture; it is not presented as a live browser screenshot.

Final Windows builds completed:

- `dist/Converge-Setup-1.1.0-x64.exe`, 111,594,799 bytes. SHA-256: `9414ad70ad9fa33c0fef4ac5cf15e0b79db6c7e4ee1a311210200db39608ac24`.
- `dist/Converge-Portable-1.1.0-x64.exe`, 111,297,888 bytes. SHA-256: `fd3b004aa85a5e86844918e4e2ea37ed12fa0b803cdd5a0fca8d8fd6d25e5d3b`.
- Final `app.asar` SHA-256: `6c82f9e4d334d6dc834fb8896b0df6456022555167ca57d0291a5734b516f3d7`.

The packaged tests load the actual production archive under a temporary Electron launcher carrying its package metadata. Installer execution and a new live authenticated session were not tested.

The desktop integration scripts run the actual Electron shell, sandboxed generated preload, guarded IPC, two native page views, source file reading, Chromium downloads and final file writing. All remote requests are blocked, imported cookies are fictitious, and model replies come from local fixtures. The source and packaged result reports record the completed stages and precise scope.

The native PDF fixture is a real one-page PDF with a content stream, font, cross-reference table and trailer. The test compares saved bytes with the exact revised PDF accepted by both fixture reviewers. This verifies transport and saving, rather than the quality of a real model's edits.

## Live testing boundary

The installed 1.0 app and supplied recording were inspected at the beginning of this turn. The user then stopped Computer Use with the physical Escape key. No further live app or Chrome controls were used. The replacement's authenticated ChatGPT session, live Work selection and live PDF exchange have **not** been verified in this turn.

The earlier 1.0 live Chrome text test is historical evidence only; it does not establish live PDF or Work support in 1.1. See the preserved 1.0 report for its exact scope. No Chrome profile or account logout was performed.

## Remaining limits

- ChatGPT must accept the locally imported current session and expose supported visible controls. Authentication challenges, account usage limits and unavailable Work access can prevent a run.
- A model must actually generate an accessible downloadable file. Unknown output controls, expired downloads, changed files and unreadable attachments stop with an explanation.
- Both reviewers accepting the same candidate does not prove it is 100% correct or change the underlying model's reasoning setting.
- The installer is unsigned. App cookies, conversation state and transcripts are not preserved after app exit.
