# Converge for macOS

[← Project](../README.md) · [Mac 1.8.1 verification](MACOS_1_8_1_VERIFICATION.md) · [Boss workflow](BOSS_WORKSPACE.md)

**Version 1.8.1 · Apple Silicon ARM64 · MacBook Air M4**

Converge shares its boss, two workers, file transfers, sliding controls, result views and artwork across Windows and Mac. The center boss character opens a separate chat panel. Mac integration adds Command shortcuts, system app and Edit menus, native file dialogs and normal Dock behavior.

Native Mac 1.8.1 verification passed on an Apple Silicon GitHub runner: **425 source tests**, **16 packaged boss workflows**, **24 legacy transport workflows**, and actual packaged startup, native editing and Close/reopen checks. Both ARM64 archives passed signature, bundle and runtime/source parity checks. The [verification record](MACOS_1_8_1_VERIFICATION.md) gives the build identity and exact scope. A physical MacBook Air M4 test and live authenticated Mac task have not been performed. The [1.7.0 record](MACOS_VERIFICATION.md) is historical evidence for the earlier two-reviewer app.

## Requirements

- An Apple Silicon Mac. This ARM64 build targets the MacBook Air M4 and runs natively without Rosetta.
- **macOS 13 Ventura or later**, the [minimum supported by the bundled Electron 44 runtime](https://www.electronjs.org/blog/electron-44-0).
- An internet connection and a current ChatGPT account session. Features and models depend on your account.

The downloaded app includes its desktop runtime. You do not need to install Node.js, npm or Electron to use it.

## Install

1. Open the [Converge 1.8.1 release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.8.1).
2. Download **[Converge-1.8.1-macOS-arm64.dmg](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.8.1/Converge-1.8.1-macOS-arm64.dmg)**.
3. Double-click the DMG, then drag **Converge** into **Applications**.
4. Eject the disk image. Open **Applications → Converge**.

Alternatively, download **[Converge-1.8.1-macOS-arm64.zip](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.8.1/Converge-1.8.1-macOS-arm64.zip)**, extract it, and move **Converge.app** into **Applications** before opening it. Install one copy of the app.

### If macOS blocks the first launch

This release uses an ad-hoc code signature. It has **no Apple Developer ID signature and no Apple notarization**, so macOS may block the first launch.

If you downloaded this exact release and choose to allow it, attempt to open **Converge.app**, then go to **Apple menu → System Settings → Privacy & Security**. Find the message about Converge, choose **Open Anyway**, and confirm the app name in the next dialog. See [Apple's instructions for opening an unnotarized app](https://support.apple.com/en-us/102445).

If macOS reports that the app is damaged or will harm your computer, stop and download it again from the release page. Compare its checksum with the release record; report a continuing failure with the app version and macOS version. Keep the Mac's system security protections enabled.

## Start your first team task

1. Open the controls drawer and click **Import JSON file**. Choose a current `.json` cookie export for your own ChatGPT account; import begins immediately.
2. Choose **Temporary**, **Normal** or **Work mode**, then click **Open the team**. Work is available only when your account exposes it. Converge opens three distinct conversations.
3. Select a model in each worker page. Click the **center boss character**, then select the boss page's model as well. Each of the three model selectors is independent; the app uses your selections.
4. Attach source documents, images or code through the controls drawer or the boss panel's attachment button. Source files are supplied to the boss and both workers before the task begins.
5. Enter the task in **Instruction to the boss**, then click **Send to boss** or press **Command + Enter**. You can also start through **Brief the boss** in the controls drawer.
6. Watch the workers and the bottom progress bar. The boss assigns work, receives both results and generated files, and requests further checks. Open the result drawer to inspect the candidate and any remaining limitations.
7. Use **Save final files** when available and choose destinations in the native Mac Save dialogs.

Use **Instruction to the boss** to guide the team. The ChatGPT composer above it is for direct conversation and does not control workers.

### Add an idea or start another task

Send an additional instruction through the boss box while work continues. A busy model does not lose the instruction: the queue status shows it waiting, and the boss receives it before further assignments or completion.

After the task finishes, a new boss instruction reuses the same conversations. **Stop** cancels the active exchange. **Reset** clears all three conversations and lets you choose the next chat type while keeping the imported session.

The [boss workflow guide](BOSS_WORKSPACE.md) explains candidate checks, review limits, required files and stopping. Its Windows installation references apply only to Windows; use this page for Mac setup and shortcuts. Agreement is a review result, not a guarantee that every answer is correct.

## Appearance

Settings offer five still **Chat backgrounds**, applied to the boss and both worker pages: **Night sky**, **Black horror**, **Alien**, **Cyberpunk** and **Anime**.

**Team characters** offers **Expressive robots**, **Curious explorers** and **Wonder spirits**, each with a boss in the middle. **Atmosphere** changes the upper and lower animation bands: **Glowing stars**, **Ghost** or **Flowers**. These choices do not change the models or the task.

Turn **Animations** off in settings or use the header effects button to pause decoration. Chat backgrounds remain still; hidden or minimized windows suspend decorative animation. System reduced-motion preferences are respected.

## Window controls and shortcuts

| Action | Mac behavior |
|---|---|
| Start a task or send a boss instruction | **Command + Enter** in the corresponding instruction box |
| Copy, paste, cut, select all, undo and redo | Standard **Command** shortcuts; also available in **Edit** |
| Hide the boss panel | Its Close button or **Escape**; the worker task continues |
| Move the window | Drag a noninteractive area of the custom header |
| Minimize | Use the header Minimize control; an active review continues |
| Maximize or restore | Use the header Maximize/Restore control |
| Close the window | Ends that workspace and clears its imported session and unsaved review state |
| Open again from the Dock | Creates a fresh setup window; import the session again |
| Quit Converge | **Command + Q** or **Converge → Quit Converge** |

Save useful files before closing, quitting or resetting. Minimizing preserves the current workspace; decorative animation pauses while the window is minimized. Closing the window leaves the Mac app available in the Dock, but the closed workspace is not restored.

## Your session and files

Converge imports the selected cookie export into its own session in memory. It does not modify or sign out your Chrome profile. **Clear session** affects only Converge. Closing the workspace or quitting removes the imported session; reopening starts fresh.

Cookie exports can grant access to your account. Keep them private: do not add them to Git, attach them to an issue, or paste them into a model chat. The picker displays only the filename and clears its input after import. Supported exports are a nonempty cookie array or an object containing one; the file must be `.json` and at most **1 MiB**.

Source selection accepts up to **five files**, **12 MB per file** and **24 MB combined**. Combined sources and worker outputs support up to **15 distinct attachments**, staged in batches of five files and 24 MB. Every expected receipt must appear before submission; provider limits or missing files stop the transfer visibly. Your account may impose a lower limit.

Saved outputs use the candidate's actual captured bytes and filename. Converge does not provide a permanent local conversation archive. ChatGPT's own storage and retention depend on your selected mode and account settings.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Mac says the developer cannot be verified | Follow the first-launch instructions above and Apple's linked guidance |
| You downloaded an `.exe` | Use the ARM64 DMG or ZIP linked on this page |
| No session after reopening from the Dock | Closing intentionally clears the session; import a current JSON export again |
| Cookie import fails | Check the file shape, `.json` extension, 1 MiB limit, cookie expiry and any normal account verification |
| Start is disabled | Open all three chats, wait for readiness, enter a task and resolve any upload errors or Temporary-mode confirmation |
| The boss answers but workers do not start | Use **Instruction to the boss**, not the native ChatGPT composer above it |
| Command + Enter does nothing | Use an app instruction box; check its shown error or disabled Send/Start reason |
| No final file is available | Request the exact downloadable output and inspect the missing-file findings |
| The Mac gets warm | Turn **Animations** Off; model work continues. The three provider pages still consume resources |

For a bug report, include Converge version, macOS version, chip, chat mode, steps, expected result and observed result. Redact account details and private task content. Never share a cookie export or authentication token.
