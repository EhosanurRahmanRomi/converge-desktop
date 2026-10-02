# Converge for macOS

[← Project](../README.md) · [Mac verification](MACOS_VERIFICATION.md) · [Full review guide](USER_GUIDE.md)

**Version 1.7.0 · Apple Silicon ARM64 · MacBook Air M4**

Converge uses the same two-chat workspace, review engine, file handoff, controls drawer, result views and Stars/Ghost/Flowers artwork on Mac. Mac integration adds Command shortcuts, the system app and Edit menus, native file dialogs and normal Dock behavior.

The release passed its native Mac build, startup and controlled review checks. The [verification record](MACOS_VERIFICATION.md) includes its exact scope and checksums. A physical MacBook Air M4 test and live authenticated Mac review have not been performed.

## Requirements

- An Apple Silicon Mac. This ARM64 build targets the MacBook Air M4 and runs natively without Rosetta.
- **macOS 13 Ventura or later**, the [minimum supported by the bundled Electron 44 runtime](https://www.electronjs.org/blog/electron-44-0).
- An internet connection and a current ChatGPT account session. Features and models depend on your account.

The downloaded app includes its desktop runtime. You do not need to install Node.js, npm or Electron to use it.

## Install

1. Open the [Converge 1.7.0 Mac release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.7.0).
2. Download **[Converge-1.7.0-macOS-arm64.dmg](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.7.0/Converge-1.7.0-macOS-arm64.dmg)**.
3. Double-click the DMG, then drag **Converge** into **Applications**.
4. Eject the disk image. Open **Applications → Converge**.

Alternatively, download **[Converge-1.7.0-macOS-arm64.zip](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.7.0/Converge-1.7.0-macOS-arm64.zip)**, double-click to extract it, and move **Converge.app** into **Applications** before opening it. Install one copy of the app.

### If macOS blocks the first launch

This release uses an ad-hoc code signature. It has **no Apple Developer ID signature and no Apple notarization**, so macOS may block the first launch.

If you downloaded this exact release and choose to allow it, attempt to open **Converge.app**, then go to **Apple menu → System Settings → Privacy & Security**. Find the message about Converge, choose **Open Anyway**, and confirm the app name in the next dialog. See [Apple's instructions for opening an unnotarized app](https://support.apple.com/en-us/102445).

If macOS reports that the app is damaged or will harm your computer, stop and download it again from the release page. Compare its checksum with the release record; report a continuing failure with the app version and macOS version. Keep the Mac's system security protections enabled.

## Start your first review

1. Click **Import JSON file**. The Mac file picker lets you select a current `.json` cookie export for your own ChatGPT account. Import begins as soon as you choose the file.
2. Choose **Temporary**, **Normal** or **Work mode**, then press **Open both chats**. Work is available only when your account exposes it.
3. Choose your desired model in each visible ChatGPT page.
4. Enter the task in **Your task**, add source files if needed, and press **Start automatic exchange**. You can also press **Command + Enter** in the task panel.
5. Inspect the review progress, findings and final candidate. Use **Save final files** and choose a destination in the Mac Save dialog.

The complete [review guide](USER_GUIDE.md) explains review approaches, required files, candidate revisions, limits, stopping and follow-up tasks. Its Windows installation instructions and Ctrl shortcut apply to the Windows release; use this page for Mac setup and shortcuts.

## Window controls and shortcuts

| Action | Mac behavior |
|---|---|
| Start automatic exchange | **Command + Enter** in the task panel, or the Start button |
| Copy, paste, cut, select all, undo and redo | Standard **Command** shortcuts; also available in **Edit** |
| Move the window | Drag a noninteractive area of the custom header |
| Minimize | Use the header Minimize control; an active review continues |
| Maximize or restore | Use the header Maximize/Restore control |
| Close the window | Ends that workspace and clears its imported session and unsaved review state |
| Open again from the Dock | Creates a fresh setup window; import the session again |
| Quit Converge | **Command + Q** or **Converge → Quit Converge** |

Save useful files before closing, quitting or resetting. Minimizing preserves the current workspace; decorative animation pauses while the window is minimized. Closing the window leaves the Mac app available in the Dock, but the closed workspace is not restored.

## Your session and files

Converge imports the selected cookie export into its own session in memory. It does not modify or sign out your Chrome profile. **Clear session** affects only Converge. Closing the workspace or quitting removes the imported session; reopening starts fresh.

Cookie exports can grant access to your account. Keep them private: do not add them to Git, attach them to an issue, or paste them into either reviewer. The picker displays only the filename and clears its input after import. Supported exports are a nonempty cookie array or an object containing one; the file must be `.json` and at most **1 MiB**.

Saved outputs use the candidate's actual captured bytes and filename. Converge does not provide a permanent local conversation archive. ChatGPT's own storage and retention depend on your selected mode and account settings.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Mac says the developer cannot be verified | Follow the first-launch instructions above and Apple's linked guidance |
| You downloaded an `.exe` | Use the ARM64 DMG or ZIP linked on this page |
| No session after reopening from the Dock | Closing intentionally clears the session; import a current JSON export again |
| Cookie import fails | Check the file shape, `.json` extension, 1 MiB limit, cookie expiry and any normal account verification |
| Start is disabled | Import a session, open both pages, wait for them to be ready, enter a task and resolve any upload errors |
| Command + Enter does nothing | Use it in the task panel after both chats are ready; check the shown error or disabled Start reason |
| No final file is available | Request the exact downloadable output and inspect the missing-file findings |
| The Mac gets warm | Turn **Animations** Off; chat work continues. The two provider pages still consume resources |

For a bug report, include Converge version, macOS version, chip, chat mode, steps, expected result and observed result. Redact account details and private task content. Never share a cookie export or authentication token.
