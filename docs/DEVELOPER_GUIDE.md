# Developer guide

[← Project](../README.md) · [Project studio](STUDIO_GUIDE.md) · [Boss architecture](BOSS_ARCHITECTURE.md) · [Windows 1.9.9 verification](WINDOWS_1_9_9_VERIFICATION.md) · [Mac installation](MACOS_GUIDE.md)

## Current implementation

The current source version is **1.9.9**, an Electron project studio with a boss and two workers. Windows x64 installer/portable and Apple Silicon macOS DMG/ZIP targets share the production application. Each release artifact has its own verification record; the approved portable's evidence is in the [Windows record](WINDOWS_1_9_9_VERIFICATION.md). See [model error recovery](MODEL_ERROR_RECOVERY.md) and [document quality](DOCUMENT_QUALITY.md). `desktop-main.js` is the production entry point; `renderer/browser.html` is the shell. Three embedded pages connect through an imported ChatGPT browser session. The current flow does not use the API implementation retained under `src/core`.

`src/browser/boss-coordinator.js` owns planning, worker dispatch, candidate identity, queued user instructions and completion. The earlier two-reviewer coordinator, extension and API implementations are preserved for history and regression checks. Shared validation helpers remain in `chrome-extension/background.js`, and the page-preload build derives its bridge from `chrome-extension/content.js`. Editing those shared files can therefore change the desktop app even when you are not building the extension.

## Local setup

Use Windows for x64 builds or Apple Silicon macOS for ARM64 Mac builds. Node.js **22.13.0 or newer** and npm are required for development. The project pins **Electron 44.5.1** and **electron-builder 26.15.3** in its lockfile. **pdfjs-dist 6.4.299** is a packaged runtime dependency for trusted PDF parsing and bounded rendering. Packaged applications include their runtime and do not require Node.js.

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
npm run qa:studio
npm run qa:desktop
```

`qa:boss` exercises the production three-page shell and sandboxed bridge with offline model fixtures: uploads, generated file bytes, hash verification, queued instructions, sliding boss bounds, Stop, Reset, chat modes, follow-ups, five backgrounds and three character styles. `qa:studio` covers contracts, revisions, local checks, fresh audit and project recovery/export. `qa:desktop` runs the preserved two-reviewer transport regression with its explicit legacy coordinator option. These local fixtures do not establish live provider availability or answer quality.

On macOS, run the full suite with `npm test -- --test-concurrency=1`, as the native CI workflow does. The GUI fixtures share the WindowServer and focused editing; running them serially avoids one fixture occluding another.

`npm test` uses a wrapper around Node's test runner, resolves Electron once and defaults to two workers. Use sequential execution for release verification and focused GUI tests. The frozen **1.9.1 source suite passed 566 / 566 tests**. **48 packaged checks**, actual portable startup/Close and an authenticated GPT-5.6 Sol High file task passed against the final artifact. See the [1.9.1 record](WINDOWS_1_9_1_VERIFICATION.md) for exact scope.

The previous [1.9.0 record](WINDOWS_1_9_0_VERIFICATION.md) retains **498 source tests, 20 packaged workflow checks, 13 studio checks and 6 large-upload checks**, plus actual portable startup and Close. Historical [1.8.2 evidence](WINDOWS_1_8_2_VERIFICATION.md) retains that candidate's source and delivery results; neither record establishes 1.9.1 or a new live-provider run.

The Windows 1.8.1 audit recorded **425 passing source tests**, **16 packaged boss workflows** and **18 Chromium attachment checks**. Native Mac 1.8.1 CI separately passed **425 source tests**, **16 packaged boss workflows**, **24 legacy transport workflows**, ARM64 archive verification, actual startup/native editing/Close/reopen and a clean-source gate. Consult each release record for its frozen build and exact scope. The **351 tests in Windows 1.6.5** and **377 tests in Mac 1.7.0** belong to historical releases.

Public parser/test fixtures use synthetic content. A historical live-review excerpt was replaced for publication, with its parser assertions preserved and its test description updated. Packaged runtime/source byte parity is checked separately for each release; raw authenticated evidence stays private. Publication checks are separate from the original release gates.

After building, `npm run qa:boss:packaged` and `npm run qa:studio:packaged` check runtime/source byte parity and version metadata, then run their controlled workflows against the actual archive. Their default is `dist/win-unpacked/resources/app.asar`; on Mac, set `CONVERGE_PACKAGED_ASAR` to `dist/mac-arm64/Converge.app/Contents/Resources/app.asar`. The current boss fixture has 22 checks and the studio fixture has 17 checks. They load the production archive under a metadata-matched Electron launcher; actual packaged executable startup and installer installation are separate gates.

`npm run qa:desktop` regenerates the bridge and launches the preserved two-reviewer fixture. Historical Windows 1.6.5 and Mac 1.7.0 releases each passed **24 controlled workflows using their actual archives**. These remain legacy transport checks, not evidence for the new boss flow.

Useful targeted commands:

```powershell
node --test test/downloads.test.js
node --test test/upload-transport.test.js test/upload-status.test.js
node --test test/content-submission.test.js
node --test test/large-upload.test.js
node --test test/boss-coordinator.test.js
node --test test/studio-workflow.test.js test/studio-services.test.js test/studio-desktop.test.js
node --test test/desktop-window-controls.test.js
node --test test/page-appearance.test.js
node --test test/renderer-studio.test.js
node --test test/renderer-boss-workspace.test.js
```

The fixture scripts under `scripts/` document additional desktop, extension, attachment and package-parity checks. Read each script's inputs before running it. Earlier API/PDF/Codex smoke scripts are not supported packaged desktop workflows; some depend on optional tools or packages that are not declared by the current desktop installation. Do not treat every historical smoke script as a current release gate.

The 1.8.2 regressions cover upload completion signalled only by attributes, receipt-only rechecks, bounded staging, exact large-file bytes, response timers beyond one hour, temporarily unmounted current turns, worker progress ownership, explicit provider interruption, human edits and cancellation/Continue. Timer scheduling and simulated clock tests establish the application budgets; they do not represent a real two-hour remote model run.

The 1.9.1 regressions cover editor drafts across recovery updates, cancelled imports, focused controls during running tasks, stale previews and closing events, verification/container toggle consistency, concurrent project operations, failed save-as identity, current-byte exports, queued instructions during pending verification, late reports after Stop and restored-revision Continue with exact original source bytes. The page appearance fixture checks actual local Manrope glyphs in native WebContents with network fonts blocked, preserving monospace code.

`test/large-upload.test.js` launches `scripts/qa-large-upload.js` against the production shell, native picker IPC, three sandboxed views and generated preload using a **100 MiB PDF** and local provider fixture. It checks bytes/hashes and completed receipts on the boss and both workers. To check the built archive separately, set `CONVERGE_PACKAGED_ASAR=dist/win-unpacked/resources/app.asar` and run the script with Electron. These fixture uploads do not establish ChatGPT's acceptance limits.

The separate `scripts/qa-512-upload.js` gate uses a real **512 MiB PDF** through the native chooser and all three Chromium File inputs. Its fixture uses `File.stream()` and bounded Node SHA-256 reads, checks shell heartbeats and cancellation after delivered chunks, rejects 512 MiB plus one byte, then saves, reloads and exports the original source with matching hashes. Run it with Electron after building the page preload. `node scripts/qa-packaged-512-upload.js` checks current source/runtime parity and binds the same gate to the final ASAR hash. The scripts write evidence under `.live-test/512-upload/`; running them is a separate release gate and does not establish live provider acceptance.

### Live verification

Controlled tests cannot establish that today's provider UI, authentication or native download metadata works. A live check should use an explicitly authorized account/session and fresh test chats, with no private task data in published evidence.

Check the selected model on **both workers and the boss**, all original uploads, distinct worker assignments, queued additions, minimum rounds, candidate replacements, actual file capture/relay, both final checks and native Save. Independently audit the **saved final bytes**, rather than testing a retyped or reconstructed answer. Keep provider-reported test claims separate from independently executed checks.

The Windows 1.8.1 live task used **GPT-5.6 Sol High on all three pages** through production source under the matching development runtime. Four cycles produced a checked C4 candidate; its two saved Python files passed 28 independent tests. Packaged transport and actual portable startup were verified separately. These checks do not claim installer installation, a physical Mac test or a live task inside the Mac executable.

## Build Windows artifacts

Build both the Windows installer and portable. Historical downloads keep their original version labels.

```powershell
npm run build:win -- --publish never
```

The build produces:

```text
dist/
  Converge-Setup-1.9.9-x64.exe
  Converge-Portable-1.9.9-x64.exe
  win-unpacked/
    Converge.exe
    resources/app.asar
```

The build recipe is not evidence that the artifact has passed its gates. After building, run `npm run qa:boss:packaged`, `npm run qa:studio:packaged`, the packaged large-file fixture and `node scripts/qa-native-windows-startup.js`. The native startup script launches the portable executable itself, checks the version, visible shell, drawers, view disposal and Close using a nonce-bound completion report. It uses an isolated smoke profile and does not authenticate, navigate to the provider, run a live model task or access the clipboard.

The Windows targets are x64 and unsigned; code-signing is disabled in the current configuration. The NSIS installer is a wizard with a selectable directory and desktop/Start Menu shortcuts. For the installer alone, regenerate the bridge then run `npx electron-builder --win nsis --x64 --publish never`. Clean-runner installation checks belong in the Windows release workflow; do not install a test build over a user's active installation. Wrapper compression can make the installer and portable download sizes differ.

## Build Apple Silicon Mac artifacts

Build the current Mac release on native Apple Silicon macOS. The app requires macOS 13 or newer:

```sh
npm ci
npm test -- --test-concurrency=1
npm run build:mac
npm run verify:mac
node scripts/qa-native-macos-startup.js
CONVERGE_PACKAGED_ASAR=dist/mac-arm64/Converge.app/Contents/Resources/app.asar npm run qa:boss:packaged
CONVERGE_PACKAGED_ASAR=dist/mac-arm64/Converge.app/Contents/Resources/app.asar npm run qa:studio:packaged
```

Outputs follow the current package version: `dist/Converge-<version>-macOS-arm64.dmg` and `dist/Converge-<version>-macOS-arm64.zip`, containing the same `Converge.app`. These commands do not establish that new archives have been built or verified. The build uses native ARM64 Electron and ad-hoc signing, without Developer ID signing or Apple notarization. Native signing, bundle verification and DMG creation run on macOS.

The workflow in `.github/workflows/macos-arm64.yml` requires a native ARM64 host, the full sequential suite, built-bundle verification, actual packaged startup, preserved legacy integration checks, the current packaged boss and studio workflows before uploading artifacts. ZIP extraction and a read-only DMG mount check the shipped bundles, permissions, framework links, metadata, signatures, runtime/source parity and packaged PDF parser/worker/native renderer. Build verification records the source commit and workflow provenance.

`scripts/qa-native-macos-startup.js` launches the actual packaged executable. Native editing must pass on **five surfaces**: shell input, worker A, worker B, the boss's ChatGPT view and **Instruction to the boss**. It also requires the visible native key window, Command hint, Edit menu, boss drawer, Close cleanup and a fresh workspace after an application activation event. This activation check does not simulate a physical Dock click; the startup fixture does not authenticate or run a live provider task.

See [Mac installation](MACOS_GUIDE.md) and the current release's verification report for status and remaining hardware checks. The [Mac 1.8.1 record](MACOS_1_8_1_VERIFICATION.md) and [1.7.0 record](MACOS_VERIFICATION.md) retain historical evidence.

The successful 1.8.1 run was [GitHub Actions 37348451621](https://github.com/EhosanurRahmanRomi/converge-desktop/actions/runs/37348451621), using source commit `3e1449046fc1b86a1a3f2960e6b94e61027f05cf`. Its actual packaged native editing passed on all five surfaces. The host was an Apple Silicon CI runner; no physical MacBook Air M4 test or authenticated live Mac task was performed.

The shell, reviewer bridge, review engine, file transfer and animation assets are shared. `src/platform/desktop-lifecycle.js` handles menu roles and window lifecycle; the renderer chooses the Command shortcut on macOS. Keep platform adaptation separate from the shared review and file logic.

Before publishing a new release:

1. Freeze the runtime inputs and record their identities.
2. Regenerate the page preload, run the full suite and build with publishing disabled.
3. Compare the packaged runtime files and metadata with the frozen source.
4. Run the packaged controlled workflows and inspect the actual built shell.
5. Run only the live checks needed to resolve the changed behavior.
6. Record artifact sizes, SHA-256 hashes, any missing evidence and the exact scope tested.

Do not publish `node_modules`, `tmp/`, local cookie files, private project inputs, personal recordings, live account traces or unrestricted development profiles. Release executables belong in **GitHub Releases**, not Git history. Check the staged tree before committing it and record artifact lengths and SHA-256 in `docs/release-artifacts.json`.

## Source map

| Path | Responsibility |
|---|---|
| `desktop-main.js` | Native window, isolated session, three page views, guarded IPC, file brokers and Save dialogs |
| `desktop-preload.js` | Narrow bridge between the shell and main process |
| `src/platform/desktop-lifecycle.js` | Platform application menu, single-window ownership, Dock activation and quit behavior |
| `src/platform/studio-desktop.js` | Guarded native project operations, recovery checkpoints, previews, local verification and exports |
| `src/studio/workflow.js`, `src/studio/project.js` | Acceptance contracts, evidence, revision state and safe recovery envelopes |
| `src/studio-services/` | Bounded archives, SHA-addressed project bytes, trusted parsers, isolated tests and delivery packages |
| `src/browser/boss-coordinator.js` | Boss plans, worker assignments, queued additions, candidates and completion checks |
| `renderer/browser.html` | Window controls, setup drawer, worker stage, sliding boss, instructions and results/files UI |
| `renderer/browser-app.js` | Shell state, readiness, direct JSON import, task controls, window actions and result rendering |
| `renderer/browser.css` | Desktop/compact layout, drawer typography and custom chrome |
| `renderer/studio-ui.js`, `renderer/studio-ui.css` | Studio sections, retained editor drafts, safe previews and keyboard navigation |
| `renderer/assets/fonts/` | Bundled Manrope font and its open font licence |
| `renderer/galaxy-scene.js`, `renderer/galaxy-scene.css` | Still backdrop and decorative team movement |
| `renderer/star-ribbons.js` | Cached Stars/Ghost/Flowers movement in the two narrow strips |
| `src/browser/cookies.js` | Export parsing, supported cookie validation and session import |
| `src/browser/files.js` | Source/output type checks, readable text representations, sizes and container checks |
| `src/browser/upload-transport.js` | Bounded ordered upload staging and validated single commit |
| `src/browser/downloads.js` | Authorization and exact native-download capture |
| `src/browser/desktop-coordinator.js` | Transport adapter and preserved two-reviewer coordinator |
| `chrome-extension/background.js` | Shared validation and legacy review lifecycle |
| `chrome-extension/content.js` | Visible page editor/submission/reply/mode/media bridge |
| `scripts/build-page-preload.js` | Generates `src/browser/page-preload.js` from the shared bridge |
| `src/browser/page-appearance.js` | Five still chat backgrounds and permitted cosmetic page behavior |
| `scripts/qa-packaged-boss.js` | Current boss archive parity and offline integration gate |
| `scripts/qa-packaged-studio.js` | Project studio archive parity and offline integration gate |
| `scripts/qa-large-upload.js` | Production picker/IPC/view upload fixture with a 100 MiB PDF |
| `scripts/qa-native-windows-startup.js` | Actual Windows portable startup, drawers and Close cleanup gate |
| `scripts/qa-native-macos-startup.js` | Actual Mac executable startup, native editing and Close/reopen gate |
| `test/`, `chrome-extension/test/` | Automated desktop/shared-bridge and historical-core coverage |
| `src/core/`, earlier renderer files | Retained earlier implementations; not the current production connection path |

Treat `src/browser/page-preload.js` as a generated output. Change its source/build inputs and regenerate it; direct edits can be overwritten.

## Change boundaries

### Browser adapter

The provider can change its page structure, labels and upload/download behavior. Prefer visible-page checks and explicit bounded errors. A busy page or unsent draft must not be mistaken for an idle composer. Submission success is not reply completion; completion must be tied to a new owned response.

### Files

Keep owner/request/candidate identity, filename, size, byte hash, readable-content validation and cancellation checks together. A MIME exception should be narrowly justified by actual provider metadata. In 1.6.5, native `text/x-python` is accepted only for a selected `.py` output whose canonical representation is `text/plain`; that is not a general `text/*` bypass.

Source selection is limited to five files, **512 MiB per file / 1 GiB combined**. Internal combined transfers allow up to 15 distinct files, staged in five-file / 1 GiB batches with the same per-file cap. ChatGPT's documented lower limits include 20 MB images, approximately 50 MB spreadsheets and 2 million tokens per document. [OpenAI file-upload FAQ](https://help.openai.com/en/articles/8555545-file-uploads-faq). Check every expected receipt before sending. Large IPC payloads must use bounded chunks, preserving ordered offsets, declared size, canonical data, exact ownership and one commit. Do not retry an ambiguously submitted prompt.

Large native sources use private file-store descriptors (`name`, `mimeType`, `blobId`, `byteLength`, `contentSha256`) rather than an in-memory base64 payload. Stream the verified bytes into bounded transfer chunks; decode each chunk into browser Blob parts without joining the full encoded string. Keep cancellation checks between reads, page sends and project archive writes. `attachments.progress` exposes actual byte counts during `reading` and `staging`, and indeterminate `processing` with page receipt counts. Progress never substitutes for a completed attachment receipt.

Project storage permits **3 GiB of distinct blobs**, separate from the 1 GiB upload batch cap. Use streaming project archive APIs for large files; bounded in-memory archive APIs reject oversized data. Provider uploads and individual native downloads have 30-minute allowances, native page acknowledgement allows 35 minutes, and a five-file export has a three-hour ceiling. Stop remains independent of pending reads, chunk acknowledgements and provider processing.

An incomplete source upload can be rechecked through `RECHECK_ATTACHMENTS` without repeating its selection/upload. Retain exact source bytes privately and release them to Start only when all three tracked receipt sets are complete. Completion can arrive through `aria-busy` or upload-state attributes alone, so readiness must not depend only on child/text mutations.

Never substitute an HTML error page, stale attachment or prose description for the requested file. Reviewers should receive the actual candidate bytes, and Save should preserve the same bytes.

### Review logic

Minimum rounds, user revisions, candidate replacements and acceptance are separate facts. The boss's substantive plan must satisfy required user work and candidate-bound checks. Required backtesting or compilation cannot disappear because a model lacks tools. Preserve queued additions before further assignments or completion, and prevent cancelled work from restarting.

Keep the **two-hour model / 24-hour workflow** budgets separate from file deadlines. Five-minute supervision must preserve active generations and recover only a confirmed stopped, app-owned request with no newer human turn. Continue is an explicit user action for blocked/limited tasks, retains completed work and issues fresh requests after cancellation acknowledgement. Stop must remain responsive while any page, file or model operation is pending.

### Appearance

Keep decoration independent from task progress. Animations Off must stop it while provider work continues. Five chat backgrounds remain still; avoid full-screen redraws or per-frame filters. Respect hidden/minimized state and reduced motion. Character moods do not measure answer confidence.

### Project operations and studio state

`projectSave({name, saveAs: true})` creates a separate saved identity only after a successful write. Failure preserves the existing identity and exposes the error for retry. The current UI uses **Save project** to update its checkpoint. Export must save the current snapshot successfully before reading its archive; delivery export checks both project identity and snapshot content after the destination dialog. Guard concurrent mutations and recheck idle/closed state after asynchronous dialogs.

Retain unsubmitted renderer drafts through status updates, then clear them on explicit project replacement. Invalidate pending previews when the selected revision, section or workspace changes. Local verification runs outside the coordinator queue; candidate hash and user revision decide whether its result can apply. A queued instruction, Stop or restored revision must retire stale final checks and require current acceptance.

## License and attribution

The project's own code remains **UNLICENSED** in `package.json`. This repository does not grant an open-source license. Keep bundled third-party notices and licenses with their covered components. Current artwork provenance is summarized in [ARTWORK.md](ARTWORK.md).
