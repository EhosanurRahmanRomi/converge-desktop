# Developer guide

[← Project](../README.md) · [Architecture](ARCHITECTURE.md) · [Verification](VERIFICATION.md)

## Current implementation

Converge is an **Electron desktop application**. Version 1.7.0 adds Apple Silicon macOS support; the separately recorded Windows release is 1.6.5. Its production entry point is `desktop-main.js`; `renderer/browser.html` is the application shell. Two embedded pages connect through an imported ChatGPT browser session. The current flow does not use the API implementation retained under `src/core`.

Earlier extension and API implementations are preserved for project history. The desktop coordinator reuses the review engine in `chrome-extension/background.js`, and the page-preload build derives its bridge from `chrome-extension/content.js`. Editing those shared files can therefore change the desktop application even when you are not building the extension.

## Local setup

Use Windows for x64 builds or Apple Silicon macOS for ARM64 Mac builds. Node.js **22.13.0 or newer** and npm are required for development. The project pins **Electron 44.5.1** and **electron-builder 26.15.3** in its lockfile. **pdfjs-dist 5.6.205** is a development dependency for the retained PDF-adapter tests; it is excluded from the packaged browser app. Packaged applications include their runtime and do not require Node.js.

```powershell
git clone https://github.com/EhosanurRahmanRomi/converge-desktop.git
cd converge-desktop
npm ci
npm start
```

`npm start` first regenerates `src/browser/page-preload.js`, then launches Electron. The app still needs a valid imported session for authenticated provider use. Do not place that export in the checkout.

## Verify a change

```powershell
npm test
npm run qa:desktop
```

On macOS, run the full suite with `npm test -- --test-concurrency=1`, as the native CI workflow does. The GUI fixtures share the WindowServer and focused editing; running them serially avoids one fixture occluding another.

`npm test` uses Node's test runner. The Windows 1.6.5 suite passed **351 tests**; the native Mac 1.7.0 suite passed **377 tests**. The current suite covers coordinator behavior, content submission, candidate identity, source retention, media authorization, cookie handling, file limits, cancellation, mode checks, layout, animation preferences, window controls and Mac lifecycle/archive checks.

Public parser/test fixtures use synthetic content. A historical live-review excerpt was replaced for publication, with its parser assertions preserved and its test description updated. Packaged runtime/source byte parity is checked separately for each release; raw authenticated evidence stays private. Publication checks are separate from the original release gates.

`npm run qa:desktop` regenerates the bridge and launches the controlled desktop fixture. Fixture replies and sample content are not live ChatGPT verification. Both recorded releases passed **24 controlled workflows using their actual application archives**. The Mac run loads the production archive under a development Electron launcher carrying its package metadata; a separate startup check launches the actual `Converge.app` executable and verifies native editing, Close cleanup and fresh activation.

Useful targeted commands:

```powershell
node --test test/downloads.test.js
node --test test/desktop-window-controls.test.js
node --test test/renderer-cookie-file.test.js
node --test test/renderer-workspace-layout.test.js
```

The fixture scripts under `scripts/` document additional desktop, extension, attachment and package-parity checks. Read each script's inputs before running it. Earlier API/PDF/Codex smoke scripts are not supported packaged desktop workflows; some depend on optional tools or packages that are not declared by the current desktop installation. Do not treat every historical smoke script as a current release gate.

### Live verification

Controlled tests cannot establish that today's provider UI, authentication or native download metadata works. A live check should use an explicitly authorized account/session and fresh test chats, with no private task data in published evidence.

Check the selected model on both visible pages, original upload delivery, independent drafts, minimum rounds, exact candidate replacements, actual file capture/relay, dual acceptance and native Save. Independently audit the **saved final bytes**, rather than testing a retyped or reconstructed answer. Keep provider-reported test claims separate from independently executed checks.

The recorded live run used GPT 5.6 High through the frozen source launcher. The built archive matched that source. Visible startup of the actual unpacked executable was separately observed. Those are different checks; neither claims a fresh installer installation or authenticated review inside the built-window smoke test.

## Build Windows artifacts

The command below builds the current source version. The existing public Windows installers remain 1.6.5; the 1.7.0 release adds Mac artifacts without relabeling or replacing those Windows installers.

```powershell
npm run build:win -- --publish never
```

The build produces:

```text
dist/
  Converge-Setup-1.7.0-x64.exe
  Converge-Portable-1.7.0-x64.exe
  win-unpacked/
    Converge.exe
    resources/app.asar
```

NSIS is configured as a wizard installation with a selectable installation directory and desktop/Start Menu shortcuts. The portable target is also x64. Both wrappers are unsigned in this release; code-signing is disabled in the current build configuration.

## Build Apple Silicon Mac artifacts

On an Apple Silicon Mac running macOS 13 or newer:

```sh
npm ci
npm run build:mac
npm run verify:mac
```

Outputs are `dist/Converge-1.7.0-macOS-arm64.dmg` and `dist/Converge-1.7.0-macOS-arm64.zip`, containing the same `Converge.app`. The build uses native ARM64 Electron and ad-hoc signing. It does not include Developer ID signing or Apple notarization. Native signing, bundle verification and DMG creation run on macOS; the Mac build command does not substitute a Windows-generated unsigned bundle.

The repository's Mac workflow builds on a native Apple Silicon runner with publishing disabled, verifies the packaged runtime and runs the controlled desktop tests. See [Mac installation](MACOS_GUIDE.md) and [Mac verification](MACOS_VERIFICATION.md) for the exact evidence and remaining hardware checks.

The shell, reviewer bridge, review engine, file transfer and animation assets are shared. `src/platform/desktop-lifecycle.js` handles menu roles and window lifecycle; the renderer chooses the Command shortcut on macOS. Keep platform adaptation separate from the shared review and file logic.

Before publishing a new release:

1. Freeze the runtime inputs and record their identities.
2. Regenerate the page preload, run the full suite and build with publishing disabled.
3. Compare the packaged runtime files and metadata with the frozen source.
4. Run the packaged controlled workflows and inspect the actual built shell.
5. Run only the live checks needed to resolve the changed behavior.
6. Record artifact sizes, SHA-256 hashes, any missing evidence and the exact scope tested.

Do not publish `node_modules`, local cookie files, personal recordings, live account traces or unrestricted development profiles. Release executables belong in **GitHub Releases**, not Git history. Check the staged tree before committing it.

## Source map

| Path | Responsibility |
|---|---|
| `desktop-main.js` | Native window, isolated browser session, page views, guarded IPC, upload/download brokers and Save dialogs |
| `desktop-preload.js` | Narrow bridge between the shell and main process |
| `src/platform/desktop-lifecycle.js` | Platform application menu, single-window ownership, Dock activation and quit behavior |
| `renderer/browser.html` | Window controls, setup/task drawer, reviewer stage and results/files UI |
| `renderer/browser-app.js` | Shell state, readiness, direct JSON import, task controls, window actions and result rendering |
| `renderer/browser.css` | Desktop/compact layout, drawer typography and custom chrome |
| `renderer/galaxy-scene.js`, `renderer/galaxy-scene.css` | Still galaxy backdrop and shell appearance |
| `renderer/star-ribbons.js` | Cached Stars/Ghost/Flowers movement in the two narrow strips |
| `src/browser/cookies.js` | Export parsing, supported cookie validation and session import |
| `src/browser/files.js` | Source/output type checks, readable text representations, sizes and container checks |
| `src/browser/downloads.js` | Authorization and exact native-download capture |
| `src/browser/desktop-coordinator.js` | Adapter hosting the tested review coordinator for two page views |
| `chrome-extension/background.js` | Review lifecycle, candidate IDs, acceptance ledger, required-work checks and cancellation |
| `chrome-extension/content.js` | Visible page editor/submission/reply/mode/media bridge |
| `scripts/build-page-preload.js` | Generates `src/browser/page-preload.js` from the shared bridge |
| `src/browser/page-appearance.js` | Permitted cosmetic page background behavior, pause and disposal |
| `test/`, `chrome-extension/test/` | Automated desktop/shared-bridge and historical-core coverage |
| `src/core/`, earlier renderer files | Retained earlier implementations; not the current production connection path |

Treat `src/browser/page-preload.js` as a generated output. Change its source/build inputs and regenerate it; direct edits can be overwritten.

## Change boundaries

### Browser adapter

The provider can change its page structure, labels and upload/download behavior. Prefer visible-page checks and explicit bounded errors. A busy page or unsent draft must not be mistaken for an idle composer. Submission success is not reply completion; completion must be tied to a new owned response.

### Files

Keep owner/request/candidate identity, filename, size, byte hash, readable-content validation and cancellation checks together. A MIME exception should be narrowly justified by actual provider metadata. In 1.6.5, native `text/x-python` is accepted only for a selected `.py` output whose canonical representation is `text/plain`; that is not a general `text/*` bypass.

Never substitute an HTML error page, stale attachment or prose description for the requested file. Reviewers should receive the actual candidate bytes, and Save should preserve the same bytes.

### Review logic

Minimum rounds, candidate revisions and acceptance of the current replacement are separate facts. Keep all required user work attached to the run when a candidate changes. Required backtesting or compilation must not disappear simply because a reviewer cannot perform it.

### Appearance

Keep decorative motion independent from review progress. Animations Off must stop decoration while leaving provider work active. Avoid adding full-screen redraws or expensive per-frame filters to the still center area. Respect hidden/minimized state and reduced motion. Do not describe a cosmetic mood as a confidence measurement.

## License and attribution

The project's own code remains **UNLICENSED** in `package.json`. This repository does not grant an open-source license. Keep bundled third-party notices and licenses with their covered components. Current artwork provenance is summarized in [ARTWORK.md](ARTWORK.md).
