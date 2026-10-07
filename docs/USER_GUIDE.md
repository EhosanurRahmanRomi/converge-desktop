# Converge user guide

**Version 1.9.9 · Windows x64 and Apple Silicon Mac**

[← Project](../README.md) · [Project studio](STUDIO_GUIDE.md) · [Mac installation](MACOS_GUIDE.md) · [Recovery details](MODEL_ERROR_RECOVERY.md)

## 1. Install or open the app

Get the files from the [1.9.9 release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.9.9).

- **Windows Setup:** run Converge-Setup-1.9.9-x64.exe and follow the installation wizard.
- **Windows Portable:** open Converge-Portable-1.9.9-x64.exe. A portable executable still saves recovery projects and preferences in local app data.
- **Apple Silicon Mac:** use the ARM64 DMG or ZIP and follow the [Mac guide](MACOS_GUIDE.md). Windows EXEs do not run natively on macOS.

Close an older Converge window before switching versions. Its running process stays on the old version even after a newer file is downloaded. Check the version in the header.

The release bundles the desktop runtime. Windows files are unsigned; Mac files use an ad-hoc signature without notarization. The [Windows verification record](WINDOWS_1_9_9_VERIFICATION.md) identifies the tested portable. A passed startup check does not establish installation or upgrade testing.

Use the top-left menu to show or hide **Review controls**. The middle character opens the sliding boss panel. **Project studio** opens the task library and review tools. **Results & downloads** in the bottom bar opens the answer and files.

## 2. Import your own session

1. Open the controls drawer and choose **Import JSON file**.
2. Select a current ChatGPT cookie export belonging to your own account.
3. Wait for the import status. Import starts immediately; there is no second import click.

The file must be JSON, at most **1 MiB**, and contain a nonempty cookie array or an object with a nonempty cookies array. **Or paste cookie JSON** is an alternative.

Only the filename is displayed. Import inputs clear after an attempt. Cancelling the picker keeps the current state, and an invalid replacement does not remove a valid imported session.

Converge imports the session into its own in-memory profile. It does not change, clear or log out Chrome. **Clear session** affects only Converge. Closing the workspace clears its imported session; local saved projects remain.

Keep exports private. They can grant access to the account. Do not upload one as a source file, paste it into a model conversation, commit it to Git or attach it to an issue. An expired session or normal provider verification still needs your attention.

## 3. Open the team

| Mode | What opens |
|---|---|
| **Temporary** | Three distinct Temporary conversations |
| **Normal** | Three distinct regular conversations |
| **Work mode** | Three Work conversations when the account exposes and confirms that mode |

Choose the mode, then press **Open the team**. The boss and both workers must be ready before starting. If Temporary state cannot be read, confirm the mode on all three visible pages when requested. A visibly unavailable mode remains blocked; Work does not silently fall back to Normal.

Select the desired model **in each page's own menu**. The boss, worker A and worker B have independent selections. Models and tools depend on the account; Converge does not provide an extra model tier or remove usage limits.

Use the app controls for coordinated tasks. Typing into the native ChatGPT composer opens a direct conversation; it does not dispatch work to the other pages.

## 4. Write a useful brief

Enter the task in **Instruction to the boss**, or use **Brief the boss** in Review controls. State:

- What you want created, corrected or answered.
- Which source files define the scope.
- The exact output format and filenames when they matter.
- Constraints that must be preserved.
- Acceptance conditions and any checks that must actually run.

For example:

> Improve the attached Python function without mutating its inputs. Cover empty input, touching intervals and containment. Deliver the complete corrected Python file and a test file. Record which tests actually ran and any missing tools.

For a document:

> Expand every topic in the attached source into a readable PDF, in the original order. Show intermediate derivation steps, define new terms and include labelled figures where useful. Keep a source-coverage checklist. Use the attached design reference for appearance only. Report any content or layout that you could not verify.

The main task field allows **20,000 characters**. Optional **Boss instructions** allow **10,000 characters**. Avoid asking the team to invent objections, compete for confidence or claim absolute certainty.

### Choose the review route

| Route | Minimum |
|---|---|
| **Auto** | Four improvement cycles for general, creative and file work; recognized simple fixed arithmetic uses two verification steps |
| **Improve** | Four improvement cycles |
| **Verify** | Two verification steps |

The boss decides the substantive assignments and next useful changes. Minimum cycles are a workflow rule, not an answer-quality guarantee. The default maximum is six; settings allow up to 12.

Open **Project studio → Brief** for task presets, acceptance criteria, document design, local verification and a fresh final audit. Use **Apply to this task** to commit changes to an idle task.

## 5. Attach content and appearance references

Open the team before attaching files.

- **Attach files, images or code** adds content sources.
- **Add a design reference** adds appearance examples separately.
- Both kinds are delivered to the boss and workers. They share the original-input allowance.

| Local input limit | Value |
|---|---:|
| Content files + design references retained for the task | **5 total** |
| One file | **512 MiB** |
| Combined original input bytes | **1 GiB** |
| Image input guard | **20 MiB** |
| Spreadsheet input guard | **50 MiB** |

The service can impose lower format, token, processing or account limits. These are app transport/guard limits, not a promise that every file is accepted by the provider.

Common supported sources include PDF, images, text, Markdown, CSV/TSV, JSON, DOCX, XLSX, PPTX and readable programming source. Text must use supported UTF-8 or BOM-marked UTF-16. Some code uploads use a readable TXT alias while retaining their original name and byte identity. That alias does not change the final output's canonical filename.

Standard supported single-disk ZIP inputs are relayed as unchanged bytes after container-header checks. Converge does not extract, run or certify their contents. Multipart/ZIP64 inputs and unsupported executable or binary formats are rejected.

### Follow the upload state

Large files are read and transferred in bounded chunks. The panel reports actual bytes during local reading/sending; provider processing is shown as processing, without an invented percentage.

Starting remains blocked until all three pages confirm the expected attachments. If an upload is partial or times out, use **Check pending uploads**. It checks existing receipts without uploading the same selection again. Resolve that batch before adding another.

Use **Cancel upload** or the header **Stop** while a transfer is pending. A stopped or failed upload is not counted as a delivered source.

### Original source versus candidate

- **Original source:** a file you supplied as content.
- **Design reference:** a supplied appearance example; it does not expand the content scope.
- **Candidate C1, C2…:** a generated result under review.
- **Worker checkpoint W1, W2…:** a completed worker result that may not be the boss-selected candidate.

Generated files are transferred with their actual captured bytes and identities. Describing a new file does not count as delivering it. Required file work must provide the requested downloadable artifact; analysis-only tasks can leave **Require a revised file** off.

## 6. Run, guide and stop

Start through the app instruction box. **Ctrl + Enter** on Windows or **Command + Enter** on Mac sends the instruction.

The boss plans, both workers work, completed replies/files return to the boss, and the team revises or verifies the current candidate. The bottom band shows the present action, cycle and available files.

You can send text additions through **Instruction to the boss** while work continues. Busy requests keep their ownership; the queue shows that your instruction is waiting. The boss receives it before later assignments or completion. New attachments must wait until the active task is idle.

### Long tasks and interruptions

The host checks owned requests every **five minutes** and reacts to supported observed interruptions. Slow, healthy analysis is allowed to continue. Baseline safeguards are **two hours per response** and **24 hours per workflow**, with separate file-transfer handling.

For recoverable failures, the boss requests a focused repair from retained work. A healthy teammate and completed files are preserved. Recovery is bounded; repeated failures, authentication, account limits or unavailable prerequisites can still leave the task blocked. The app cannot force the provider to finish a terminated response.

**Stop** remains in the header during work, even with the controls hidden. It retires active coordinated requests; a late reply or verification result cannot turn the stopped task into a completed one. Page cancellation still depends on the provider responding to its normal stop control.

### Read the outcome

| Outcome | Meaning |
|---|---|
| **Final reviewed result** | The selected candidate met the app's required checks and the boss approved it |
| **Current draft** | Work is running or required acceptance is still incomplete |
| **Stopped** | You cancelled the exchange; completed drafts can still be useful |
| **Blocked / limit reached** | A prerequisite, repeated failure or safeguard prevented completion |
| **Error** | Inspect the shown page, upload, delivery or request failure |

A green result applies to the exact current candidate and recorded evidence. It does not prove universal accuracy, profitability or the truth of every model claim.

## 7. Find your answer and download files

Open **Results & downloads** in the bottom bar. The files appear before the long answer.

- Use **Download** beside one file.
- Use **Download all final files** or **Download all draft files** for the current selection.
- Open **Other completed drafts** for completed worker outputs, including a newer result that the boss has not selected.
- Read the answer, full exchange, remaining issues and reported limitations.

Downloads use the captured file identity. They remain available during work and after opening a saved project; reconnecting a chat is not required to download retained bytes. Saving a draft does not approve it.

If a task produced only text, use **Copy** or **Export .md**. If you required a PDF or another downloadable format and none was retrieved, inspect the missing-file finding. The app cannot turn a prose claim into an actual provider file.

**Previous workflow status** is saved history, including a stopping reason when available. It is not live progress. Older projects may not have that history.

## 8. Save projects and continue

Open **Project studio → Projects**.

| Action | Purpose |
|---|---|
| **Save project** | Save the committed brief, sources, revisions and review history locally |
| **Download saved files** | Retrieve a saved project's outputs without replacing the active task |
| **Open project** | Restore a saved task to continue its review |
| **Export project** | Back up or move the complete bounded project archive |
| **Export delivery package** | Share the selected result with its evidence, issues, limitations and hash manifest |

Automatic recovery checkpoints retain committed task data. A visible save failure means you should retry; unsubmitted editor drafts are retained only in the current window. Use explicit Save/export for important work.

A recovered project starts disconnected. Import the session, open the team and use **Continue task** with a focused instruction. Retained sources are reattached, and continued work needs fresh acceptance. Interrupted remote prompts are not replayed automatically.

After completion, another boss instruction starts a new task in the same conversations. **Reset** opens a fresh team and returns to the mode choices while keeping the imported app session. Preserve useful projects/files before replacing a task.

Project archives use Converge's ZIP STORE format, retain up to **3 GiB of distinct file bytes**, and support up to **48 candidate revisions**. They exclude browser credentials and live requests, but contain your private task inputs/outputs. Inspect them before sharing.

## 9. Appearance and performance

Open **Preferences & review rules → Appearance**.

| Setting | Options |
|---|---|
| Atmosphere | Glowing stars, Ghost, Flowers |
| Chat backgrounds | Night sky, Black horror, Alien world, Cyberpunk city, Anime twilight |
| Team characters | Expressive robots, Curious explorers, Wonder spirits |
| Motion detail | Full motion, Low power · task activity only, Off |

The chat backgrounds stay still. Decorative motion is concentrated in the upper and lower bands. Low power keeps task-related activity while pausing background loops; Off removes decorative animation. **Pause effects / Resume effects** controls the same animation preference.

Hidden/minimized windows suspend decoration, and system reduced-motion preferences are respected. These features bound decorative work; no exact GPU-saving percentage is claimed. Three provider pages can still consume memory, CPU and GPU resources.

## Troubleshooting

| Symptom | Next step |
|---|---|
| Start is disabled | Check session, all three pages, task text, mode confirmation and upload status |
| Boss answers but workers stay idle | Send through **Instruction to the boss**, not the native page composer |
| Upload is partial or timed out | **Check pending uploads** before choosing the files again |
| Model stopped thinking or delivery failed | Inspect the recovery/activity log; wait for confirmed idle and the bounded repair. For a blocker, resolve the shown cause and use **Continue task** |
| Boss cannot repair an account/model limit | Select an available model or wait for the account limit; continue explicitly |
| No final file | Check **Results & downloads**, other drafts and required-file findings; ask for the exact downloadable format |
| Chats are disconnected after recovery | Download retained files directly, or reconnect the team before continuing |
| PDF structure passed but layout looks poor | Inspect the full PDF; record a layout issue and continue. Rasterization is not aesthetic approval |
| A required program test is unavailable | Configure the optional local runtime or record the missing tool; parsing is not execution |
| App gets warm | Use Low power or Off; healthy task work continues |
| Provider layout changed | Capture safe diagnostics and report the broken control/receipt detection |

For a [bug report](https://github.com/EhosanurRahmanRomi/converge-desktop/issues), include the app version, operating system, chat mode, safe reproduction steps, expected result and observed error. Use **Copy safe page diagnostics** when useful, then inspect/redact it. Never submit session exports, tokens or private source documents.

See [Project studio](STUDIO_GUIDE.md) for detailed evidence and [model error recovery](MODEL_ERROR_RECOVERY.md) for supported failure categories.
