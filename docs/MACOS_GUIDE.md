# Converge for Apple Silicon Mac

**Version 1.9.9 · ARM64 · macOS 13+**

[← Project](../README.md) · [User guide](USER_GUIDE.md) · [Project studio](STUDIO_GUIDE.md)

The Mac app shares the boss, two workers, project studio, file transport, results and appearance controls with Windows. Native integration adds Command shortcuts, app/Edit menus, Mac file dialogs and Dock behavior.

This ARM64 build runs natively on Apple Silicon, including MacBook Air M4. A physical MacBook Air M4 and a live authenticated Mac task have not been tested.

## Requirements

- An Apple Silicon Mac.
- **macOS 13 Ventura or later**, the minimum for the bundled [Electron 44 runtime](https://www.electronjs.org/blog/electron-44-0).
- Internet access and a current ChatGPT account session.
- Local disk space for the app, uploaded sources and saved project revisions.

Node.js, npm and Electron are bundled or unnecessary for end-user installation. Optional container program tests need a separate compatible Docker installation and prepared local images; see [Verification](STUDIO_GUIDE.md#verification-distinguish-local-checks-from-review).

## Install

1. Open the [Converge 1.9.9 release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.9.9).
2. Download **[Converge-1.9.9-macOS-arm64.dmg](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.9.9/Converge-1.9.9-macOS-arm64.dmg)**.
3. Open the DMG and drag **Converge** to **Applications**.
4. Eject the disk image and open **Applications → Converge**.

Alternatively, download the **[ARM64 ZIP](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.9.9/Converge-1.9.9-macOS-arm64.zip)**, extract it and move Converge.app into Applications. Install one copy. Close an older Converge workspace before replacing the app.

The Windows EXE is a different artifact. Use the DMG/ZIP on macOS.

### If macOS blocks the first launch

The release uses an **ad-hoc signature**, with **no Developer ID signing or Apple notarization**.

If you obtained this exact release and choose to allow it, first attempt to open Converge. Then open **System Settings → Privacy & Security**, find the blocked-app message and use **Open Anyway**. Confirm the app name. Follow [Apple's first-launch guidance](https://support.apple.com/en-us/102445).

A damaged-app or malware warning should be checked against a fresh download and the release checksum. Report continuing failures with the artifact/version and macOS version. Keep system security protections enabled.

## Open your first team

1. Click **Import JSON file** and choose your own current ChatGPT cookie export.
2. Choose **Temporary**, **Normal** or **Work mode**, then **Open the team**.
3. Select a model in both worker pages. Click the middle boss character and select the boss model independently.
4. Attach content sources. Use **Add a design reference** for appearance examples.
5. Configure the task and document design in **Project studio → Brief** when needed.
6. Enter the task through **Instruction to the boss**. Send with **Command + Enter** or the displayed action button.
7. Inspect **Results & downloads** and save the project or delivery package.

The native ChatGPT composer is for direct conversation; use the app's instruction box to control the workers.

The [user guide](USER_GUIDE.md) covers receipt-only upload rechecks, 512 MiB transport limits, drafts, continued work, settings and recovery. Provider acceptance and account limits remain separate.

## Mac controls

| Action | Control |
|---|---|
| Send an app task/instruction | **Command + Enter** in the app instruction box |
| Copy, paste, cut, select all, undo/redo | Standard **Command** shortcuts and **Edit** menu |
| Close boss panel or studio | Its Close control or **Escape** |
| Move window | Drag a noninteractive header area |
| Minimize / maximize | Header window controls |
| Stop coordinated work | Header **Stop** |
| Quit | **Command + Q** or **Converge → Quit Converge** |

Minimizing keeps the task open and suspends decoration. Closing ends that workspace and clears its imported in-memory session. On macOS the app can remain in the Dock; activating it opens a fresh setup window. Saved local projects remain available in **Project studio → Projects**, with retained downloads and historical status.

To continue recovered work, import the session, open a new team and use **Continue task**. Browser sessions and interrupted remote requests are not restored or replayed automatically.

## Files and privacy

Content sources and design references share an allowance of **five original inputs**, **512 MiB each / 1 GiB combined**. Images/spreadsheets have additional local guards. Files are sent in bounded chunks; service format/token/account limits can be lower. Project storage is separate and can retain **3 GiB of distinct file bytes**.

Completed outputs are downloaded from their captured bytes through Mac Save dialogs. Drafts can be downloaded while review is pending or after recovery. A matching hash establishes identity, not correctness.

Converge does not modify or log out your Chrome profile. **Clear session** affects its own imported session. Cookie JSON must be at most **1 MiB** and follow the supported export shape. Never share it in a repository, screenshot or issue.

Saved projects omit browser credentials but contain task sources and outputs. Review archives before sharing.

## Appearance and battery use

Choose the same backgrounds and crews as on Windows. **Motion detail → Low power** pauses background loops while keeping task activity; **Off** removes decorative animation. The still chat backgrounds do not animate.

The app respects reduced motion and suspends decoration when hidden/minimized. The three provider pages still use resources. No measured battery-life or GPU-saving percentage is claimed.

## Verification status

Native ARM64 packaging and verification for **1.9.9** are being completed. Use the release's **macos-verification.json** and **SHA256SUMS-macOS.txt** once published for the exact artifacts and results. Earlier successful Mac runs do not verify this version.

The release workflow checks the source suite, packaged boss/studio/transport paths, actual packaged startup and native editing/Close/reopen, signatures and source/runtime parity. A gate is passed only when the corresponding current-run evidence exists.

Ad-hoc signature checks are not notarization. Controlled local workflow replies are not authenticated provider tests. Physical M4 hardware testing and a live authenticated Mac task remain unperformed.

## Troubleshooting

| Symptom | Check |
|---|---|
| macOS blocks the developer | Use the first-launch instructions and Apple guidance above |
| You downloaded an EXE | Choose the ARM64 DMG or ZIP |
| Session is missing after Dock reopen | Import again; recover the local project separately |
| Boss does not dispatch work | Use **Instruction to the boss**, not the page composer |
| Upload is incomplete | Use **Check pending uploads**, then inspect the visible failure |
| Final file is missing | Open **Results & downloads**, inspect other drafts and required-file findings |
| Machine gets warm | Select Low power or Off; inspect whether provider work is still active |
| Required test tooling is unavailable | Configure the optional local tools; a parser pass is not execution |

Report the Converge/macOS versions, chip, mode, safe steps and observed error. Redact private task content and account details. Never attach cookies or authentication tokens.
