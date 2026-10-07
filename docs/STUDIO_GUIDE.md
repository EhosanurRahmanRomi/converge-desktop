# Project studio guide

**Version 1.9.9**

[← Converge](../README.md) · [User guide](USER_GUIDE.md) · [Document quality](DOCUMENT_QUALITY.md) · [Windows verification](WINDOWS_1_9_9_VERIFICATION.md)

Open **Project studio** in the header. The studio covers the embedded chat panes; closing it returns you to the boss and workers. Its six sections keep the task and its evidence together.

## Brief: define a complete result

Choose **Automatic**, **Software**, **Research**, **Documents**, **Images** or **Trading research**. Presets add appropriate review concerns; they do not change the model, supply unavailable data or install missing tools.

Enter one concrete acceptance criterion per line, up to **30**. Good criteria identify something inspectable:

- Every chart states units and data source.
- Deliver the complete corrected source and a test file.
- Cover every item in the supplied source outline.
- Record actual compiler/test results tied to the delivered files.
- Give concrete rendered-page findings for the final PDF.

Use **Apply to this task** to commit settings to an idle task. Start or continue through the boss controls. **Stop** remains available during work.

Unsubmitted settings, criteria, assessments, issue notes and project names survive studio navigation, close/reopen and same-window checkpoint refreshes. They are drafts until Apply/Save. Controls that would change the acceptance contract become unavailable during an active task.

### Document design

| Profile | Intended presentation |
|---|---|
| **Academic math notes** | Readable body and mathematical typography, structured derivations and learning notes |
| **Match attached reference** | Compare actual reference pages and follow their typography, spacing and hierarchy |
| **Editorial report** | Balanced section openers, legible figures and report structure |
| **Neutral document** | Restrained layout suitable for reading and printing |

Academic is the default. **Design notes** allow up to **6,000 characters** for page size, fonts, equations, margins, figure treatment and other presentation requirements.

Use **Add a design reference** in Review controls to attach the actual example. The filename list in Brief is editable, one exact uploaded name per line, up to **five** names. Naming a file does not upload it. Content inputs and design references share the task's **five-file / 1 GiB** original-input allowance.

References guide **appearance only**. Their text does not expand the task's lecture/topic scope or become additional user instructions. Reference names are committed after delivery to all three pages; missing references remain unavailable in the review context.

For explicit document production, content and layout acceptance are separate. Reference styling adds another comparison condition. A source/reference PDF attached merely for reading does not automatically mean a new output PDF is required.

Final PDF review identifies each exact file hash, page count, rendered pages and visually inspected pages, with specific typography, spacing, mathematics, figure and reference observations. Incomplete page coverage or unavailable inspection stays unverified. A model report remains **Model review**; the app cannot independently confirm what a model looked at. Read the [document quality guide](DOCUMENT_QUALITY.md).

## Requirements: read the evidence

| Status | Meaning |
|---|---|
| **Met** | Sufficient evidence was recorded for this condition on the selected candidate |
| **Failed** | A check identified an unresolved problem |
| **Unverified** | Evidence, coverage or required tooling is missing |

Evidence sources are **Executed**, **Model review** and **Manual**. These labels describe different kinds of support.

**Record your assessment** records what you inspected and observed. It cannot turn a model claim into an executed test or replace a requirement for native execution.

Changing the candidate, restoring a revision or adding task instructions requires acceptance against the new current work. Green history is not automatically reused as final approval.

## Revisions: compare and recover exact files

Select a revision and **Compare against** another. The answer view highlights added/removed lines. File comparisons use byte hashes to label files added, changed, unchanged or removed.

Written-answer comparison is bounded plain text. It is not a semantic code analysis or a binary-document comparison.

- **Preview** opens supported text/images; large text previews can be truncated.
- **Open PDF** opens an app-created temporary copy in your document viewer.
- **Download** saves the selected revision's retained file.
- **Use this revision** makes an earlier result current while the task is idle.

Selecting an earlier revision preserves its bytes and invalidates earlier completion. Use **Continue task** to work from it, with fresh requests and checks. Late preview responses are discarded after navigation, selection changes or closing the studio.

Completed worker checkpoints can also be downloaded in **Results & downloads → Other completed drafts**. A checkpoint is not automatically a boss-approved candidate.

## Issues: close the loop

A finding records priority, assignment, evidence and status history. Describe the actual problem and the check needed to resolve it.

The progression is **Found → Assigned → Fixed → Rechecked**. **Reopened** records a returned failure or a candidate change that needs a fresh check. “Fixed” alone is not a recheck.

Keep remaining issues specific. Unsupported certainty or a generic “looks good” does not establish that the defect was tested.

## Verification: distinguish local checks from review

**Run verification** checks the current retrieved candidate and files. The report names the candidate and hashes. A later change invalidates that report for the replacement.

Queued instructions during verification return the boss to the updated task before finishing. Stop retires pending verification; a late report cannot approve a cancelled check. Required reruns can remove earlier completion when they fail.

| Check | What runs locally | What it establishes |
|---|---|---|
| Byte identity | Hashes retained file bytes and candidate identity | The report and outputs refer to the same captured data |
| JavaScript | Trusted Node syntax parsing | Supported source parses; it is not run |
| Python | Trusted Python abstract-syntax parsing | Supported source parses; it is not run |
| JSON | Strict text decoding and parsing | Readable, syntactically valid JSON |
| CSV/TSV | Quoted fields and row-width checks | Supported delimited structure is consistent |
| Markdown | Local bundle-link checks | Named local bundle files exist; remote links are not fetched |
| PDF | PDF.js text/dimension parsing plus bounded rasterization | Parsed pages and reported rendered pages can be read by those tools |
| Images | Supported image decoding and dimensions | Bytes decode within the checker bounds |

### Check coverage and bounds

Text checks are limited to **16 MiB per file**. Image decoding is bounded to **16 MiB / 50 megapixels**. PDF checks are bounded to **64 MiB** and **1–1,000 pages**.

PDF rasterization renders all pages of documents up to **12 pages**. Longer PDFs use a bounded **eight-page sample** from the beginning, middle and end, at most **1,200 pixels per dimension**. The report names the actual pages. This local sample is distinct from a model's reported all-page visual review.

Larger files can still receive byte/hash checks while their content checks stay unverified. Missing interpreters, renderers, unsupported formats, expensive-input timeouts and unavailable coverage are reported explicitly.

Passing a parser does not establish factual accuracy, visual quality, clipping, integration behavior or trading performance. Native compilation/backtesting requires genuine native reports tied to the candidate source.

### Optional isolated program tests

An explicit “unit tests pass” condition requires an executed result. Syntax parsing and a model saying that tests passed cannot satisfy it.

Enable **Container tests** in Brief for supplied Node test files or Python test files. This also enables local verification. The option requires Docker Desktop with Linux containers and fixed images already installed locally:

- converge-verification-node:1 for Node tests.
- converge-verification-python:1 for Python tests.

The application uses the immutable image ID. It does not download images or install dependencies. Prepare needed dependencies in your image before the task. The runtime must run as user 65534 with read-only inputs.

Tests use no network, a read-only root filesystem/input copy, dropped capabilities, bounded temporary storage and CPU/memory/process/time/log limits. Generated programs are not executed directly on the host through this feature.

Docker was unavailable on the recorded Windows verification machine, so actual generated-program test execution was not established there. An unavailable runtime is reported, not counted as a pass.

### Fresh final audit

When enabled, a new conversation opens in the **right worker pane** after regular candidate checks. It receives the exact candidate, files, acceptance contract and findings.

This is an additional **Model review**, with fresh conversation context. It does not replace an executed requirement or independently validate a model's claimed page inspection. A replacement candidate needs new acceptance.

## Projects: save, download and reconnect

Recovery checkpoints retain committed brief/instructions, source and revision bytes, requirements, findings and review history in local app data. Name the project and use **Save project** for an explicit checkpoint. Failed saves remain visible.

**Projects** lists recent work first. **Download saved files** retrieves captured outputs without replacing the active task, even while another task is running. Each saved project labels reviewed/draft outputs and its historical workflow state.

**Open project** restores a task while idle. Reconnect the team before continuing. Browser authentication and temporary remote conversations are not restored. Earlier acceptance/reports remain history and need fresh acceptance for continued work. The app never automatically replays a stale interrupted request.

**Previous workflow status** in Results & downloads records the prior stage/error when available. It explains historical interruptions; it is not current live progress.

### Export the right archive

| Export | Purpose | Included data |
|---|---|---|
| **Export project** | Back up or move a recoverable task | Safe project metadata, original sources and retained revisions |
| **Export delivery package** | Share the selected output and its evidence | Answer/files, checks, requirements, findings, change history, boss summary, limitations and hash manifest |

Project export first requires a successful save of the current task; an older checkpoint cannot silently substitute after a save error. Delivery export records the actual status. Blocked work remains partial, and unavailable checks remain unverified. If the candidate/evidence changes while choosing a destination, retry the export.

Project archives use Converge's bounded **ZIP STORE** format with project metadata and SHA-addressed blobs. They retain up to **3 GiB of distinct file bytes** and **48 candidate revisions**. Repeated identical bytes share storage. Ordinary ZIP readers can inspect them; imports require the complete supported Converge format. Recompression, encryption, extra members, ZIP64 and unsupported compressed members are rejected. A delivery ZIP cannot be imported as a project.

Credentials, authentication and live request identifiers are excluded from project metadata. Task sources and outputs are retained and can be private; inspect archives before sharing.

## Navigation and typography

The app bundles **Manrope** for interface headings, controls and evidence views, with monospace technical displays. Document typography is controlled separately by the design brief.

Arrow keys, **Home** and **End** navigate studio tabs. **Escape** closes the studio. Focus remains inside the open dialog and returns to its opening control on close.

The studio helps you inspect review evidence. Two agreeing workers, a matching hash, a parsed file and a fresh audit each establish different properties; none guarantees a completely correct result.
