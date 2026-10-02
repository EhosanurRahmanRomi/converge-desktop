# Converge

![Converge — One task. Two perspectives.](docs/images/banner.svg)

A desktop workspace where two ChatGPT conversations draft independently, review each other's work, exchange the actual generated files, and check the same final candidate before stopping.

**Windows: 1.6.5 · macOS: 1.7.0 ARM64 in validation · Source available for inspection**

[Windows release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.6.5) · [Mac release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.7.0) · [Mac guide](docs/MACOS_GUIDE.md) · [User guide](docs/USER_GUIDE.md) · [Developer guide](docs/DEVELOPER_GUIDE.md)

| Platform | Release | Downloads | Verification |
|---|---|---|---|
| Windows x64 | **1.6.5** | [Installer](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.6.5/Converge-Setup-1.6.5-x64.exe) · [Portable](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.6.5/Converge-Portable-1.6.5-x64.exe) | [Recorded Windows evidence](docs/VERIFICATION.md) |
| macOS Apple Silicon, including MacBook Air M4 | **1.7.0 — native validation pending** | [DMG](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.7.0/Converge-1.7.0-macOS-arm64.dmg) · [ZIP](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.7.0/Converge-1.7.0-macOS-arm64.zip) | [Mac evidence and pending gates](docs/MACOS_VERIFICATION.md) |

The Mac build preserves the same workspace, animations, chat review and generated-file handoff. It adds Command shortcuts, native app/Edit menus, Mac file dialogs and Dock behavior. Mac downloads become available when the 1.7.0 release is published; native validation is currently in progress.

![Converge's two-chat workspace with the controls hidden](docs/images/desktop-working.png)

*Windows 1.6.5 interface preview using controlled fixture activity. These images show the shared layout; they are not Mac screenshots or screenshots of the authenticated verification run.*

## What it does

- **Two visible reviewers.** A left/right workspace keeps both ChatGPT pages in view. Each page uses the model you select in its own menu.
- **Automatic review.** Both pages answer the same task, then exchange critiques and replacements. Improvement tasks require at least four full rounds; a simple fixed answer receives two verification steps.
- **Real file handoff.** Supported generated files and displayed images are captured and sent to the other reviewer. Candidate identities and byte hashes keep the accepted result tied to its actual files.
- **An explicit finish.** Agreement requires both reviewers to accept the same current candidate, with no unresolved findings and the required deliverables present. Limits and Stop keep the run bounded.
- **Your workspace, your pace.** Reuse the same chats for a follow-up, or Reset to choose Temporary, Normal or Work mode again. Work is conditional on the account exposing it.
- **A focused interface.** A frameless header, tall chats, a slide-out controls drawer and a compact progress/files band keep the working area open.
- **Optional atmosphere.** Glowing stars, Ghost and Flowers decorate the upper and lower strips. Animations can be turned off while the review continues.

Converge uses an imported ChatGPT browser session. The current desktop flow does not require an API key. It uses its own in-memory session and does not modify or log out your Chrome profile.

## Start a review

1. On Windows, download the [installer](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.6.5/Converge-Setup-1.6.5-x64.exe) or [portable app](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.6.5/Converge-Portable-1.6.5-x64.exe). On an Apple Silicon Mac, use the [1.7.0 DMG](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/download/v1.7.0/Converge-1.7.0-macOS-arm64.dmg) and follow the [Mac installation guide](docs/MACOS_GUIDE.md).
2. Open **Import JSON file** and choose your current ChatGPT cookie export. Import begins immediately; pasting JSON is an optional alternative.
3. Choose a chat type and press **Open both chats**. Select the desired model in each page.
4. Enter a task, attach any source files, and press **Start automatic exchange**.
5. Watch the progress band, open the result drawer to inspect revisions/findings, and use **Save final files** when the result is accepted.

The Windows executables are unsigned. Installation and portable-wrapper startup were not exercised in the recorded 1.6.5 verification; the actual unpacked built application was visibly launched and closed.

The Mac release uses an ad-hoc signature and has no Apple Developer ID signature or notarization. See the [Mac guide](docs/MACOS_GUIDE.md) for first-launch instructions and the [Mac verification record](docs/MACOS_VERIFICATION.md) for its own test scope.

![The slide-out controls and task brief](docs/images/desktop-controls.png)

*The controls panel is opaque for readability and slides away when a review starts.*

## What was verified for 1.6.5

| Check | Recorded result |
|---|---|
| Automated suite | **351 / 351 passed** |
| Packaged workflows with controlled local replies | **24 / 24 passed** |
| Source and packaged runtime parity | **18 runtime files plus metadata matched; 23 frozen inputs unchanged** |
| Actual Windows built-app startup | Visible **v1.6.5**, custom header and Close observed |
| Live GPT 5.6 High file review | **4 full rounds**, **2 actual candidate revisions**, both reviewers accepted **C3** |
| Generated Python file capture, relay and Save | Native downloads completed; saved bytes exactly matched accepted C3 |
| Independent audit of that saved file | **1,244 / 1,244 recorded checks passed** |

[Read the evidence and its limits →](docs/VERIFICATION.md)

Agreement is a review result, not a guarantee of correctness. Reviewers can share a mistake. Repeated exchanges do not turn a model or reasoning setting into a stronger model, and important answers still need appropriate independent checks. The account's availability, upload rules and usage limits apply to both pages; future ChatGPT page changes may require adapter updates.

## Explore the project

| Document | Contents |
|---|---|
| [User guide](docs/USER_GUIDE.md) | Setup, modes, files, review controls, results and troubleshooting |
| [Mac guide](docs/MACOS_GUIDE.md) | Apple Silicon installation, Command shortcuts, Dock behavior and native file dialogs |
| [Mac verification](docs/MACOS_VERIFICATION.md) | Native build gates, package identities and Mac-specific evidence |
| [Developer guide](docs/DEVELOPER_GUIDE.md) | Local setup, tests, Windows build and source map |
| [Architecture](docs/ARCHITECTURE.md) | Session boundaries, review lifecycle and file identity |
| [Verification](docs/VERIFICATION.md) | Recorded tests, live review, artifact hashes and scope |
| [Release notes](docs/RELEASE_NOTES.md) | Changes in 1.6.5 |
| [Artwork](docs/ARTWORK.md) | Current visual assets and provenance |
| [Historical documentation](docs/history/README.md) | Earlier development records, kept separate from current claims |

## Develop

```powershell
npm ci
npm test
npm run qa:desktop
npm start
npm run build:win -- --publish never
```

The desktop runtime is Electron. The source also retains earlier extension/API experiments; these are not the current desktop connection path. See the [developer guide](docs/DEVELOPER_GUIDE.md) before changing the browser bridge or coordinator.

## Session privacy and project status

Treat cookie exports as account credentials. Never upload them to this repository, attach them to an issue, or paste them into a model conversation. The app reads the file you select, displays only its filename, clears the import input, and keeps its imported session in memory. Closing the app loses its session and exchange state. Generated files are saved only when you choose to save them; provider-side storage depends on the selected ChatGPT mode.

On Mac, closing the window clears that workspace and its imported session. The app remains available in the Dock; opening it again creates a fresh setup window. Use **Command + Q** to quit, or minimize to keep the current review running.

Converge is an independent project and is not an official OpenAI or ChatGPT application. Its own source remains **UNLICENSED**, as declared in `package.json`; public visibility does not grant reuse rights. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
