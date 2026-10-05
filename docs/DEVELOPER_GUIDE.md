# Developer guide

[← Project](../README.md) · [Boss architecture](BOSS_ARCHITECTURE.md) · [Windows 1.8.1 verification](WINDOWS_1_8_1_VERIFICATION.md) · [Mac 1.8.1 verification](MACOS_1_8_1_VERIFICATION.md)

## Current implementation

Converge **1.8.1** is an Electron desktop application with the same boss and two workers on Windows x64 and Apple Silicon macOS. `desktop-main.js` is the production entry point; `renderer/browser.html` is the shell. Three embedded pages connect through an imported ChatGPT browser session. The current flow does not use the API implementation retained under `src/core`.

`src/browser/boss-coordinator.js` owns planning, worker dispatch, candidate identity, queued user instructions and completion. The earlier two-reviewer coordinator, extension and API implementations are preserved for history and regression checks. Shared validation helpers remain in `chrome-extension/background.js`, and the page-preload build derives its bridge from `chrome-extension/content.js`. Editing those shared files can therefore change the desktop app even when you are not building the extension.

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
npm test -- --test-concurrency=1
npm run qa:boss
npm run qa:desktop
```

`qa:boss` exercises the production three-page shell and sandboxed bridge with offline model fixtures: uploads, generated file bytes, hash verification, queued instructions, sliding boss bounds, Stop, Reset, chat modes, follow-ups, five backgrounds and three character styles. `qa:desktop` runs the preserved two-reviewer transport regression with its explicit legacy coordinator option. These local fixtures do not establish live provider availability or answer quality.

On macOS, run the full suite with `npm test -- --test-concurrency=1`, as the native CI workflow does. The GUI fixtures share the WindowServer and focused editing; running them serially avoids one fixture occluding another.

`npm test` uses Node's test runner. The Windows 1.8.1 audit recorded **425 passing source tests**, **16 packaged boss workflows** and **18 Chromium attachment checks**. Native Mac 1.8.1 CI separately passed **425 source tests**, **16 packaged boss workflows**, **24 legacy transport workflows**, ARM64 archive verification, actual startup/native editing/Close/reopen and a clean-source gate. Consult each release record for its frozen build and exact scope. The **351 tests in Windows 1.6.5** and **377 tests in Mac 1.7.0** belong to historical releases.

Public parser/test fixtures use synthetic content. A historical live-review excerpt was replaced for publication, with its parser assertions preserved and its test description updated. Packaged runtime/source byte parity is checked separately for each release; raw authenticated evidence stays private. Publication checks are separate from the original release gates.

After building, `npm run qa:boss:packaged` checks runtime/source byte parity and version metadata, then runs the current boss workflows against the actual archive. Its default is `dist/win-unpacked/resources/app.asar`; on Mac, set `CONVERGE_PACKAGED_ASAR` to `dist/mac-arm64/Converge.app/Contents/Resources/app.asar`. `scripts/qa-packaged-boss.js` requires all 16 workflows and complete captures. It loads the production archive under a metadata-matched Electron launcher; actual packaged executable startup is a separate gate.

`npm run qa:desktop` regenerates the bridge and launches the preserved two-reviewer fixture. Historical Windows 1.6.5 and Mac 1.7.0 releases each passed **24 controlled workflows using their actual archives**. These remain legacy transport checks, not evidence for the new boss flow.

Useful targeted commands:

```powershell
node --test test/downloads.test.js
node --test test/boss-coordinator.test.js
node --test test/desktop-window-controls.test.js
node --test test/page-appearance.test.js
node --test test/renderer-boss-workspace.test.js
```

The fixture scripts under `scripts/` document additional desktop, extension, attachment and package-parity checks. Read each script's inputs before running it. Earlier API/PDF/Codex smoke scripts are not supported packaged desktop workflows; some depend on optional tools or packages that are not declared by the current desktop installation. Do not treat every historical smoke script as a current release gate.

### Live verification

Controlled tests cannot establish that today's provider UI, authentication or native download metadata works. A live check should use an explicitly authorized account/session and fresh test chats, with no private task data in published evidence.

Check the selected model on **both workers and the boss**, all original uploads, distinct worker assignments, queued additions, minimum rounds, candidate replacements, actual file capture/relay, both final checks and native Save. Independently audit the **saved final bytes**, rather than testing a retyped or reconstructed answer. Keep provider-reported test claims separate from independently executed checks.

The Windows 1.8.1 live task used **GPT-5.6 Sol High on all three pages** through production source under the matching development runtime. Four cycles produced a checked C4 candidate; its two saved Python files passed 28 independent tests. Packaged transport and actual portable startup were verified separately. These checks do not claim installer installation, a physical Mac test or a live task inside the Mac executable.

## Build Windows artifacts

The command below builds the current source version. Historical downloads keep their original version labels.

```powershell
npm run build:win -- --publish never
```

The build produces:

```text
dist/
  Converge-Setup-1.8.1-x64.exe
  Converge-Portable-1.8.1-x64.exe
  win-unpacked/
    Converge.exe
    resources/app.asar
```

NSIS is configured as a wizard installation with a selectable installation directory and desktop/Start Menu shortcuts. The portable target is also x64. Both wrappers are unsigned in this release; code-signing is disabled in the current build configuration.

## Build Apple Silicon Mac artifacts

On an Apple Silicon Mac running macOS 13 or newer:

```sh
npm ci
npm test -- --test-concurrency=1
npm run build:mac
npm run verify:mac
node scripts/qa-native-macos-startup.js
CONVERGE_PACKAGED_ASAR=dist/mac-arm64/Converge.app/Contents/Resources/app.asar npm run qa:boss:packaged
```

Outputs are `dist/Converge-1.8.1-macOS-arm64.dmg` and `dist/Converge-1.8.1-macOS-arm64.zip`, containing the same `Converge.app`. Artifact names follow the current package version. The build uses native ARM64 Electron and ad-hoc signing, without Developer ID signing or Apple notarization. Native signing, bundle verification and DMG creation run on macOS.

The workflow in `.github/workflows/macos-arm64.yml` requires a native ARM64 host, the full sequential suite, built-bundle verification, actual packaged startup, preserved legacy integration checks and all 16 packaged boss workflows before uploading artifacts. ZIP extraction and a read-only DMG mount check the shipped bundles, permissions, framework links, metadata, signatures and runtime/source parity.

`scripts/qa-native-macos-startup.js` launches the actual packaged executable. Native editing must pass on **five surfaces**: shell input, worker A, worker B, the boss's ChatGPT view and **Instruction to the boss**. It also requires the visible native key window, Command hint, Edit menu, boss drawer, Close cleanup and a fresh workspace after an application activation event. This activation check does not simulate a physical Dock click; the startup fixture does not authenticate or run a live provider task.

See [Mac installation](MACOS_GUIDE.md) and the [Mac 1.8.1 record](MACOS_1_8_1_VERIFICATION.md) for status and remaining hardware checks. The [1.7.0 record](MACOS_VERIFICATION.md) documents the earlier Mac release.

The successful 1.8.1 run was [GitHub Actions 37348451621](https://github.com/EhosanurRahmanRomi/converge-desktop/actions/runs/37348451621), using source commit `3e1449046fc1b86a1a3f2960e6b94e61027f05cf`. Its actual packaged native editing passed on all five surfaces. The host was an Apple Silicon CI runner; no physical MacBook Air M4 test or authenticated live Mac task was performed.

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
| `desktop-main.js` | Native window, isolated session, three page views, guarded IPC, file brokers and Save dialogs |
| `desktop-preload.js` | Narrow bridge between the shell and main process |
| `src/platform/desktop-lifecycle.js` | Platform application menu, single-window ownership, Dock activation and quit behavior |
| `src/browser/boss-coordinator.js` | Boss plans, worker assignments, queued additions, candidates and completion checks |
| `renderer/browser.html` | Window controls, setup drawer, worker stage, sliding boss, instructions and results/files UI |
| `renderer/browser-app.js` | Shell state, readiness, direct JSON import, task controls, window actions and result rendering |
| `renderer/browser.css` | Desktop/compact layout, drawer typography and custom chrome |
| `renderer/galaxy-scene.js`, `renderer/galaxy-scene.css` | Still backdrop and decorative team movement |
| `renderer/star-ribbons.js` | Cached Stars/Ghost/Flowers movement in the two narrow strips |
| `src/browser/cookies.js` | Export parsing, supported cookie validation and session import |
| `src/browser/files.js` | Source/output type checks, readable text representations, sizes and container checks |
| `src/browser/downloads.js` | Authorization and exact native-download capture |
| `src/browser/desktop-coordinator.js` | Transport adapter and preserved two-reviewer coordinator |
| `chrome-extension/background.js` | Shared validation and legacy review lifecycle |
| `chrome-extension/content.js` | Visible page editor/submission/reply/mode/media bridge |
| `scripts/build-page-preload.js` | Generates `src/browser/page-preload.js` from the shared bridge |
| `src/browser/page-appearance.js` | Five still chat backgrounds and permitted cosmetic page behavior |
| `scripts/qa-packaged-boss.js` | Current boss archive parity and offline integration gate |
| `scripts/qa-native-macos-startup.js` | Actual Mac executable startup, native editing and Close/reopen gate |
| `test/`, `chrome-extension/test/` | Automated desktop/shared-bridge and historical-core coverage |
| `src/core/`, earlier renderer files | Retained earlier implementations; not the current production connection path |

Treat `src/browser/page-preload.js` as a generated output. Change its source/build inputs and regenerate it; direct edits can be overwritten.

## Change boundaries

### Browser adapter

The provider can change its page structure, labels and upload/download behavior. Prefer visible-page checks and explicit bounded errors. A busy page or unsent draft must not be mistaken for an idle composer. Submission success is not reply completion; completion must be tied to a new owned response.

### Files

Keep owner/request/candidate identity, filename, size, byte hash, readable-content validation and cancellation checks together. A MIME exception should be narrowly justified by actual provider metadata. In 1.6.5, native `text/x-python` is accepted only for a selected `.py` output whose canonical representation is `text/plain`; that is not a general `text/*` bypass.

Source selection is limited to five files and 24 MB combined. Internal combined transfers allow up to 15 distinct files, staged in five-file/24 MB batches. Check every expected receipt before sending; a provider may impose a lower cumulative limit.

Never substitute an HTML error page, stale attachment or prose description for the requested file. Reviewers should receive the actual candidate bytes, and Save should preserve the same bytes.

### Review logic

Minimum rounds, user revisions, candidate replacements and acceptance are separate facts. The boss's substantive plan must satisfy required user work and candidate-bound checks. Required backtesting or compilation cannot disappear because a model lacks tools. Preserve queued additions before further assignments or completion, and prevent cancelled work from restarting.

### Appearance

Keep decoration independent from task progress. Animations Off must stop it while provider work continues. Five chat backgrounds remain still; avoid full-screen redraws or per-frame filters. Respect hidden/minimized state and reduced motion. Character moods do not measure answer confidence.

## License and attribution

The project's own code remains **UNLICENSED** in `package.json`. This repository does not grant an open-source license. Keep bundled third-party notices and licenses with their covered components. Current artwork provenance is summarized in [ARTWORK.md](ARTWORK.md).
