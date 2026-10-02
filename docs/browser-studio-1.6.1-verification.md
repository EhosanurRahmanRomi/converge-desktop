> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.6.1 verification

Date: 2026-10-02, Asia/Dhaka. Windows x64.

**Status: the recorded UI release gates are complete.** Layout/motion, the full automated suite, frozen-source Windows build, packaged local fixture, runtime parity, exact artifact identities, standalone portable startup and decoded visual preview are verified for 1.6.1 within the scopes below. A fresh authenticated cloud exchange and fresh installer installation were not performed. Visual previews, packaged local fixtures and authenticated model exchanges are separate evidence.

## Layout and animation

### One upper stage and taller chats

The layout is a single, full-width upper animation stage, **108 px high** at the desktop test size and **92 px high** in the compact window, shared by both reviewer bots. The controls drawer opens **below** that stage so it does not cover or split the animation. The two long chat panes remain underneath; the bottom progress/files drawer remains accessible.

The updated layout test passed its requirements: the upper stage occupies at least **98% of the viewport width**, the controls drawer begins below it and each collapsed-drawer chat slot retains at least **60% of the viewport height** at 1366 by 768. The visual fixture measured a 1350-px-wide stage and 547-px-high chat slot there (**71.22% height**). The compact 900 by 650 window retained an 884-px-wide stage and 445-px-high chat slot (**68.46% height**). These measurements concern closed result drawers; expanding the result drawer intentionally uses additional vertical space. Width and height ratios are distinct.

### Robot workstations, expressions and meeting handoff

The robot revision adds visible PC screens, keyboards, hands typing and expressive gaze, plus varied cosmetic mood/emoji expressions. The production visual fixture observed two PC screens, changed head/hologram transforms during idle motion, changed typing/arm transforms during work and changed cosmetic moods. Cosmetic expressions do not indicate model confidence, reasoning quality, genuine emotions or answer acceptance. The activity text remains based on actual draft/review state.

The exchange choreography is a **2.8-second** approach, meeting/document handoff and return to the two workstations. The production fixture observed both bots move toward the center with a visible paper, then return to their original positions. The real renderer test checks both handoff directions, the matching successful submission acknowledgment, deduplication, pause/hidden/reduced-motion cleanup and rejection of busy-only, error, same-page and historical events. Working head cycles remain 24 seconds; idle head cycles remain 28 seconds. Pausing retains identical sampled head, arm, hologram and typing transforms.

### More dynamic galaxy

The revised procedural scene adds more visible drifting/parallax stars, brighter foreground glints, orbital comets and repeated meteor paths to the existing spiral and nebula motion. Current source is `renderer/galaxy-scene.js`, shared by the shell and embedded-page appearance module. No downloaded image or remote animation service is required.

The WebGL and Canvas2D paths retain bounded rendering, reduced-motion handling, user Pause effects, hidden-document pause and disposal. The isolated native-page test passed against the new generated preload, checking exact-origin, non-interactive decoration, answer/code readability, editor/Send operation, unchanged upload/download controls, pause/resume and disposal. Package/startup evidence is recorded separately below.

## Current 1.6.1 evidence and gates

| Gate | Current result | Evidence / requirement |
|---|---|---|
| Revised WebGL scene movement | Observed | `.design/cinematic-background-1.6.1-diagnostics.json` |
| Revised Canvas2D scene movement | Observed | Same diagnostics record; fallback explicitly selected |
| Scene pause and disposal | Observed in both paths | Frame counts remain fixed while paused; disposed states recorded |
| Unified upper stage, controls below, long chats | Passed within the full suite | `test/renderer-workspace-layout.test.js`; ≥98% stage width, ≥60% chat-slot height at the standard size |
| Workstation typing, cosmetic moods and 2.8 s meeting handoff | Production motion fixture passed; acknowledgment/direction regressions passed within the suite | `.design/expressive-1.6.1-animation-verification.json`, `test/renderer-workspace-layout.test.js` |
| Compact running controls | Stop, Pause effects and drawer controls receive their own pointer hit; visible | `.design/expressive-1.6.1-compact-running-hit-verification.json` |
| Isolated native-page appearance/input regression | Passed within the full suite | `test/page-appearance.test.js` |
| Full automated suite | **340 passed**, zero failures, cancellations or skips; exit 0 | `.live-test/release-1.6.1-final-unit-gate-result.json`, `.live-test/release-1.6.1-final-unit-gate.log` |
| Frozen source inputs during suite | All **20 unchanged**, no drift | `.live-test/release-1.6.1-final-source-before.json`, `.live-test/release-1.6.1-final-source-unchanged.json`, final unit result |
| Windows installer/portable build | **Passed**, exit 0; 134.735 s | `.live-test/release-1.6.1-package-gates-result.json`, `.live-test/release-1.6.1-final-windows-build.log` |
| Packaged local desktop fixture | **24 checks passed**, exit 0; 379.081 s; simulated replies | `.live-test/release-1.6.1-package-gates-result.json`, `.live-test/release-1.6.1-desktop-packaged-qa.log` |
| Packaged runtime/source parity and metadata | All **15 runtime files byte-equal**, metadata equal; 13.384 s parity/hash gate | `.live-test/release-1.6.1-asar-parity.json`, package gate result |
| Frozen inputs throughout package gates | All **20 unchanged**, no drift | `.live-test/release-1.6.1-package-gates-result.json` |
| Executable/archive sizes and SHA-256 | Recorded for exact installer, portable and ASAR | `.live-test/release-1.6.1-artifact-hashes.json` |
| Actual 1.6.1 portable startup | Observed exact portable/version, animation, controls and tall chats in its own empty profile | `.live-test/release-1.6.1-actual-portable-startup.json` |
| Final cinematic recording | Decoded 1366×768; sample chat/simulated activity explicitly recorded | `.design/cinematic-motion-preview-1.6.1-evidence.json`, `.design/cinematic-video-1.6.1-verification.json` |
| Fresh authenticated 1.6.1 exchange | Unverified | Earlier live runs and local fixtures do not establish a new cloud run |
| Fresh installer installation | Unverified | Build success is not installation evidence |

The final full suite ran from **2026-10-02 00:05:06.943 to 00:05:41.757 UTC**, elapsed **34.813 seconds**. Focused renderer layout/file checks (two tests) and the native appearance check (one test) also passed before the full gate. These focused checks are included in the 340 total; they are not added to it. The successful 1.6.1 suite is a new result, not a reused 1.6.0 count.

### Exact release artifacts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Converge-Setup-1.6.1-x64.exe (local evidence or build output; excluded from this source repository) | 111650103 | `e4dd36c9c8adfa2cb29e189b6e32a4175b0c118dfc8d565d15c952376336ba70` |
| Converge-Portable-1.6.1-x64.exe (local evidence or build output; excluded from this source repository) | 111353170 | `f4867e93d4d4108b28f8f13fa7d4feb6460b64f69416ba38b943389acc49e18c` |
| win-unpacked/resources/app.asar (local evidence or build output; excluded from this source repository) | 653828 | `c57794f2c18439fa68890e8b7ca92a52e7fc62c7860484aa0fbfd982c103acf4` |

The 1.6.1 package gates ran from **00:09:31.180 to 00:18:18.641 UTC** on 2026-10-02 and all passed. They include regeneration of the isolated page preload, Windows installer/portable compilation, runtime parity/artifact hashes and the packaged offline fixture. All 20 frozen production inputs remained unchanged throughout. The 15-file parity record and runtime metadata compare the exact generated page preload, application/core modules, renderer/galaxy assets and icons with source version 1.6.1.

The 24-check fixture exercises the packaged Electron app, real native views and IPC, local attachment/Save operations, two consecutive four-round improvement tasks, two-step arithmetic, PDF/image/MQ5 transfer and output identity, Stop/Reset, mode selection and explicit failure handling. Its provider pages/replies are simulations. It does not establish a new paid-account review, model reasoning quality, native MT5 performance or fresh installer installation.

### Actual standalone portable startup

The exact portable at the hash above was opened independently and inspected through its visible window screenshot and accessibility state on **2026-10-02 00:19:13.758 UTC**. The observed app showed **v1.6.1**, the full-width animation above the controls, both bots/PC screens with controls open, changing expressions and galaxy across snapshots, and two tall chat panes after an actual controls-close click. The remaining toggle was accessible as **Show controls**.

The portable used its own empty isolated profile; the importer was empty. Chrome's profile was not changed. This proves startup and the observed visual/control behavior of this exact executable. A live account was not imported or tested during this observation, and the installer was not executed.

### Final decoded motion preview

The final Converge-1.6.1-cinematic-motion-preview.webm (local evidence or build output; excluded from this source repository) is **3,698,058 bytes**. It records production renderer assets with visibly labeled **sample chat and simulated acknowledgments**. It is a visual preview, not cloud/file-relay evidence.

Its recording wall time was **40.670 seconds**, with 435 requested encoded frames and 342 distinct offscreen renderer paint events. Native video decoding measured **37.158089 seconds at 1366×768**; elapsed recording time and decoded playback duration are reported separately. Four decoded sample frames were captured at 0.5, 5, 15 and 33.2 seconds. The root reviewer inspected the meeting/document scene at 5 seconds and idle/expression scene at 33.2 seconds; the sample-chat styling was readable and correct.

An earlier direct-capture attempt yielded only 107 frames over approximately 40 seconds and was discarded. The final recording uses actual offscreen paint events, replacing that attempt. Recording-helper changes were outside the runtime/source freeze and do not alter the packaged production app. Evidence: `.design/cinematic-motion-preview-1.6.1-evidence.json` and `.design/cinematic-video-1.6.1-verification.json`.

### Initial timing-fixture failures and repair

The first full attempt passed 338 of 340 tests and failed two timing-sensitive fixtures; its result and complete failed log are retained as `.live-test/release-1.6.1-first-unit-attempt-result.json` and `.live-test/release-1.6.1-first-unit-attempt.log`. The repairs changed tests, not production behavior.

- The replacement Send-button fixture used a 40-ms wall-clock timer to mimic a React update. A deliberately stalled VM reproduction showed that an overdue polling interval could run first, causing one stale-button click and no confirmed submission. The fixture now commits the replacement in an input-driven asynchronous microtask after the first synchronous control check, and asserts exactly one replacement commit, zero stale clicks and one current-button click. The old timer-order reproduction is preserved in `.live-test/release-1.6.1-react-send-timer-order-reproduction.log`. This scopes the finding to the artificial event ordering; it does not certify every provider render transition.
- The Chromium reduced-motion fixture now waits for the visible disabled button/body pause state, with a bounded two-second timeout, rather than assuming the media-query change was already delivered after a short fixed wait. It verifies the real reduced-motion behavior in both directions.

After those fixture repairs, the full 340-test gate passed with all 20 frozen production inputs unchanged.

### New scene measurements

At an internal scene size of 1050 by 590, the revised WebGL observation advanced from **52 to 287 frames**; after pausing it remained at **288**. The explicitly selected Canvas2D fallback advanced from **32 to 353**, then stayed at **353** while paused. Both paths reported `disposed: true` with unchanged recorded frame counts after disposal. The frame cap was 30; these observations establish movement and stopping, not a frame-rate guarantee or complete desktop performance benchmark.

The new scene captures are:

- `.design/cinematic-background-1.6.1-webgl-start.png`
- `.design/cinematic-background-1.6.1-webgl-10s.png`
- `.design/cinematic-background-1.6.1-fallback-start.png`
- `.design/cinematic-background-1.6.1-fallback-10s.png`

These are visual scene fixtures. They do not show a live ChatGPT exchange or independently verify file transfer. Older 1.6.0 captures and context-recovery results remain historical rather than replacing a new version's evidence.

### New robot/layout captures

The root reviewer visually inspected the new production-renderer captures, including `.design/expressive-1.6.1-controls-open.png`, `.design/expressive-1.6.1-idle-t0.png`, `.design/expressive-1.6.1-idle-t4.png`, `.design/expressive-1.6.1-work-t0.png`, `.design/expressive-1.6.1-work-t4.png`, `.design/expressive-1.6.1-meeting-paper.png`, `.design/expressive-1.6.1-attention.png`, `.design/expressive-1.6.1-compact-controls.png` and `.design/expressive-1.6.1-compact-running.png`.

Their mock host state exercises the actual HTML/CSS/JS and records geometry/transforms; their activity is simulated. They establish the visual arrangement and controls, not a paid-account model exchange or answer improvement.

## Historical evidence retained separately

The intermediate **1.6.0** release passed 340 automated tests and 24 packaged local-fixture checks. Its 15 runtime files and package metadata matched source; all 20 frozen inputs remained unchanged through its gates. Exact installer/portable/ASAR bytes and hashes are recorded in `docs/browser-studio-1.6.0-verification.md`. Those counts and hashes are evidence for 1.6.0 only.

The earlier authenticated **1.4.1** run `cb63f6f6-5960-40ff-ba82-20278c9b3f45` completed two initial drafts, four full rounds, eight peer-review turns and seven file revisions, C1 to C8. Its 24 captured output records matched their hashes, and three actual native Save outputs matched C8. The exact C8 source compiled in MetaEditor with zero errors, zero warnings and a 3254-ms compile; the EX5 was not executed. See `docs/browser-studio-1.4.1-verification.md` for exact identities and scope.

That live task truthfully stopped at the round limit with required native work unverified, and C8 remained proposed. It demonstrates historical core/file behavior, not the newer animation package, a fresh authenticated run or measured trading profitability.

## Remaining work and limits

The recorded 1.6.1 UI release gates are complete: new layout/bot fixtures, native-page appearance, full suite/source freeze, Windows build, packaged local fixture, runtime parity, exact artifact identities, actual portable startup and decoded motion preview. A fresh authenticated 1.6.1 exchange and fresh installer installation remain unverified. The preview contains simulated visual activity and cannot substitute for a new live run.

No genuine six-month native MT5 baseline/revision or untouched-holdout performance report has been independently verified for the user's trading assignment. Repeated review, successful compilation, file identity and two models agreeing do not establish 100% correctness, guaranteed profit or low drawdown. No live trade or generated EX5 execution is included in these records.
