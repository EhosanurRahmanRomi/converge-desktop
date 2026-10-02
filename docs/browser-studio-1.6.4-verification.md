> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.6.4 verification

Date: 2026-10-02, Asia/Dhaka. Windows x64.

**Status: completed local release gates.** This revision replaces the rejected comet mode with **Glowing stars**, brightens the Ghost theme with a new original transparent image, removes the dark reviewer-label plates, and enlarges the bots' emoji bubbles. Final checks passed **342/342 automated tests**, **16/16 local appearance checks**, **24/24 packaged offline workflows**, Windows installer/portable build, and parity of **18 runtime files plus metadata**. All **23 frozen production inputs** remained unchanged through the unit/build/parity/workflow sequence, with no drift. Scoped performance/motion observations are recorded below and do not demonstrate a GPU reduction versus 1.6.3.

There are no native computer-use actions, fresh authenticated exchanges, installer executions or standalone portable-startup checks in this revision's work. The verification work uses source inspection and local fixtures. Earlier live/account evidence is historical and is not substituted for a fresh 1.6.4 test.

## Requested visual changes

### Glowing stars replaces comets

The default menu item is **Glowing stars**, with saved ID `stars`. The other choices are **Ghost** and **Flowers**. The former `galaxy` preference migrates to `stars`; unknown values also fall back to the default. Comet artwork is excluded from the new menu and package. The large still galaxy backdrop is separate from the removed comet theme.

The star design follows the user's local video reference: filled five-point stars with bright cores and soft gold, pink, cyan and lilac halos. The upper/lower bands contain **88/58** foreground stars and **190/130** distant pinpoints. Different depths move downward at different speeds, with lateral sway, slow rotation and asynchronous scale/brightness pulses. The renderer uses cached sprites rather than playing the video. The reference watermark and suggestion overlay are not reproduced.

Reference evidence is reference-findings.md (local evidence or build output; excluded from this source repository) and `reference-metadata.json`. The local clip decoded to **8.4 seconds**, **926 × 520**, with eight extracted frames. Its source is `[private local path]`. These observations describe the reference; they do not establish the app's final appearance, frame rate or seamless looping.

### Ghost artwork and label readability

The new [ghost-v2.png](../renderer/ghost-v2.png) is a compact, pearl-white character with bright violet/cyan eyes, lavender/cyan rim light, raised arms and a curled translucent lower body. It is **1272 × 1236**, **715,076 bytes**, RGBA. Each Ghost band uses five actors moving along curved paths with cached glowing wisps. Flowers retains its existing blossom artwork and movement.

Reviewer labels have no dark plate behind them. Static text glow supports readability without an animated filter or backdrop blur. Emoji bubbles increase from 23 to **30 px** on desktop, and 20 to **25 px** in compact windows; their backdrop blur is removed. The two robots retain their PC workstations, typing/expression loops and acknowledged **2.8-second** document handoff. Cosmetic expressions do not indicate confidence or answer quality.

The upper and lower activity bands remain the animated areas. Tall chat panes stay between them; the large center and both native chat backdrops stay still. Their dimensions and interactive controls are retained. Themes remain decorative and do not change the review protocol, account state or task files.

## Controls and resource limits

**Settings → App appearance** provides the saved theme selector and global **Animations** On/Off switch. Top-bar Pause/Resume uses the same setting. Theme changes remain available while a review is running or animation is Off. Switching a paused theme redraws it once without resuming motion.

Off, hidden/minimized windows and system reduced motion suspend decoration; background chat work is separate. The renderer uses **30 fps caps for Stars/Flowers**, an effective **24 fps cap for Ghost**, a **1.25 DPR cap**, **1680 × 144 maximum drawing size per band**, and cached image/sprite surfaces. Ghost's lower draw cadence retains its elapsed-time speed, paths, artwork and actor sizes. Diagnostics report its effective and configured caps separately. Current-version local regression/lifecycle checks passed. No GPU reduction versus 1.6.3 is claimed. Ribbon engine version is **3.0.0**; current SHA-256 after the Ghost cadence adjustment is `c9724874cb9f58975eff08ac4af2bc75c9ea42b9ed38d630850e3c06888cde7d`.

## Current gates

| Gate | Status | Required evidence |
|---|---|---|
| Local reference decoding and visual findings | Completed: 8.4 s, 926 × 520, eight frames | `.design/reference-1.6.4` |
| New original transparent ghost asset | Present, inspected, dimensions/hash recorded | `docs/animation-artwork.md` |
| Glowing stars/Ghost/Flowers appearance and continuous motion | Final capped captures inspected; 16/16 local checks passed; Stars clip decoded | `.design/performance-1.6.4/final-capped-captures/results.json` |
| Transparent reviewer labels and enlarged emojis | Passed desktop/compact local fixture; final captures inspected | `final-capped-captures` |
| Theme migration, selection persistence and On/Off synchronization | Passed local fixture and final full suite | Current renderer/theme tests |
| Native backdrops, host visibility callback and disposal | Passed local fixture and final full suite | Current scene/native-window tests |
| Current-version performance comparison | Recorded for default Stars and final capped Ghost; no proven GPU reduction | Paired local fixtures listed below |
| Full automated suite and frozen source | **342/342 passed**, **23 inputs unchanged**, exit 0 | `.live-test/release-1.6.4-final-unit-gate-result.json` |
| Windows installer/portable build | Passed, **114.536 seconds** | Exact artifacts listed below |
| Runtime parity and artifact hashes | Passed: **18 runtime files plus metadata**, **9.949 seconds** | `.live-test/release-1.6.4-asar-parity.json`, `release-1.6.4-artifact-hashes.json` |
| Windows executable version resources | Read-only check passed: FileVersion **1.6.4** on Setup, Portable and unpacked executable | `.live-test/release-1.6.4-windows-version-resources.json` |
| Packaged local workflow fixture | **24/24 passed**, version **1.6.4**, **373.481 seconds**, local only | `.live-test/release-1.6.4-desktop-packaged-qa-result.json` |
| Fresh authenticated 1.6.4 complex file review | Not performed | No account actions this revision |
| Visible standalone portable startup | Not performed | Separate native observation would be required |
| Fresh installer installation | Not performed | Separate installation check would be required |

The final full suite ran **2026-10-02 03:12:09.780–03:13:04.723 UTC**, elapsed **54.939 seconds**, with zero failures, cancellations, skips or todos. Its source audit reported **23 unchanged inputs**, no drift. Result and full log are `.live-test/release-1.6.4-final-unit-gate-result.json` and `release-1.6.4-final-unit-gate.log`.

The initial current-version run passed **341/342** tests: one UI fixture exceeded its layout-settlement timeout. Its result/log are preserved as `release-1.6.4-initial-unit-gate-result.json` and `.log`. The same layout fixture passed in isolation in **11.878 seconds**. Diagnostic text was added to the timeout only; assertions and timeout were not loosened and production source was unchanged. The subsequent full suite passed all 342 tests. The initial failure is not hidden or counted as a passing gate.

The generation/build/parity/packaged-workflow sequence ran **2026-10-02 03:13:27.560–03:21:45.764 UTC**, elapsed **498.203 seconds**. Every process exited 0, all **24 packaged local workflows** passed, package version was **1.6.4**, and the final audit found **23 unchanged production inputs** with no drift. Summary evidence is `.live-test/release-1.6.4-package-gates-result.json`; detailed workflow evidence is `release-1.6.4-desktop-packaged-qa-result.json`.

The packaged fixture loaded the actual built `app.asar` modules, shell and sandboxed preloads through the development Electron launcher. Its launcher/bootstrap and screenshot top badge reported **44.5.1**, while packaged app metadata and Windows resources independently identify **1.6.4**. A standalone 1.6.4 UI badge was not observed. This fixture is separate from a visible standalone executable startup or installation.

Six screenshot paths were produced—`desktop-cookie-initial.png`, `desktop-cookie-pdf-result.png`, `desktop-cookie-page-left.png`, `desktop-cookie-page-right.png`, `desktop-cookie-studio.png`, `desktop-cookie-result.png`—and **captureWarnings was empty**. Root inspected studio/result shell captures and the separate left native-page capture: Stars/glow, enlarged emoji and tall layout were present; the page was visibly labeled **OFFLINE QA SIMULATION**. Shell screenshots show the fixture's deliberate malformed-reply attention state, which is a tested error path rather than an overall gate failure. The current packaged capture did not repeat the historical 1.6.3 native-view capture warnings.

### Built artifact identities

These files are built, source-parity checked and passed the packaged offline workflow gate. Their local verification is separate from installer execution, visible standalone startup or fresh authenticated review.

A read-only resource check found FileVersion **1.6.4** on Setup, Portable and the unpacked executable. ProductVersion is **1.6.4** on both wrappers and **1.6.4.0** on the unpacked executable. No installer or executable was launched for this check; it does not substitute for a standalone UI or installation test.

| File | Bytes | SHA-256 |
|---|---:|---|
| Converge-Setup-1.6.4-x64.exe (local evidence or build output; excluded from this source repository) | 114,321,484 | `38c1dda25019eee181cbe8a5463923bd24678f4773607fb8d87112c3bbb6e7d3` |
| Converge-Portable-1.6.4-x64.exe (local evidence or build output; excluded from this source repository) | 114,024,477 | `b9749f9ef6d7fac9caccfb34f09a2f4497debabc38a515e991a6f9ce48005a45` |
| `dist/win-unpacked/resources/app.asar` | 3,396,129 | `d78060f0f4d96726cacf1aff0d22b292f6232a241b426489db3dfb1313518523` |

## Performance and evidence scope

The **final capped** appearance fixture passed **16/16 checks** with zero console errors and unchanged source. It exercised transparent labels/static glow and enlarged desktop/compact emojis, all three themes, saved selection, legacy comet migration, On/Off synchronization, local host visibility callbacks, stopped/resumed frames, cache reuse/disposal, still native backdrops and clickable Stop. Its actual production renderer code ran with sample chat content and simulated transfer acknowledgments; it is not a live cloud exchange or physical OS-minimization observation. The earlier `final-motion` fixture also passed before the targeted Ghost cap.

Inspected final captures are `.design/performance-1.6.4/final-capped-captures/stars-motion-frame-2.png`, `ghost-motion-frame-2.png`, `flowers-motion-frame-2.png`, `settings-theme-selector.png` and `narrow-running.png`. Reviewer-label plates are absent; ghost faces are larger/brighter, reference-style stars are visible, and compact chat panes retain their long layout. Evidence is `final-capped-captures/results.json`.

### Motion recording and diagnostics

The Stars preview (local evidence or build output; excluded from this source repository) decoded, sought and played to completion in Chromium. Encoded duration is **10.2524 seconds**, with zero corrupted frames and **one dropped playback frame**. The inspection camera requested 118 frames over **12.400 seconds**, approximately **9.516 fps**; this camera rate does not measure production animation FPS. The movie was recorded before the Ghost-only cap; Stars artwork, paths and cadence did not change afterward. Clip evidence is `.design/performance-1.6.4/theme-video-inspection/results.json`.

`diagnostic-motion-checks.json` tracked twelve star IDs per band across ten samples spanning **10.75 animation seconds**. All 24 tracked stars moved downward after full-sprite wrap, rotated and pulsed. There were 35 wrap events; maximum predicted-flow difference was **0.0156 pixels** from rounded diagnostics. `theme-motion-pixel-checks.json` independently found motion in both bands for all three final themes, while lossless center sample-chat regions stayed pixel-identical. These are actual local renderer observations with simulated chat activity, not cloud-review evidence.

### Measured local workloads

The baseline is the exact released 1.6.3 `app.asar`, SHA-256 `41a46c5d139642fd37d949146ca4d83176f88c8b79476b73073bddc960253ae6`. It was extracted and hashed before measurement. An initial snapshot overlapping a live CSS edit was invalidated and excluded. Matched workloads ran sequentially with no regression suite or other fixture running concurrently, on **Intel UHD Graphics 620 / ANGLE D3D11**, using the same **1366 × 768** viewport and sample chats. The current art, moving populations and label treatment differ from the baseline.

| Measured local fixture | 1.6.3 baseline | 1.6.4 | Relative counter change |
|---|---:|---:|---:|
| Default theme 3D-engine counter: old Galaxy & Comets → Glowing stars | 42.1473% | 42.2342% | **+0.21%**, essentially unchanged |
| Ghost 3D-engine counter: original → current 24-fps-cap theme | 48.5633% | 51.2009% | **+5.43%**, higher |
| Default observed ribbon FPS per band | 24.768 | 24.352 | Stars cap 30 fps |
| Ghost observed ribbon FPS per band | 25.244 | 19.618 | Current effective cap 24 fps |
| Default owned ribbon cache bytes, shared image counted once | 1,742,640 | 1,494,832 | Procedural Stars has no image entry |
| Ghost owned ribbon cache bytes, shared image counted once | 2,281,264 | 2,350,896 | New shared Ghost bitmap 1,019,904 bytes |

Default observations lasted **18.088/18.068 seconds**; old/final Ghost observations lasted **18.103/18.045 seconds**. All runs had zero console errors, stable band caches, static center/native WebGL clocks and unchanged field-bake counts. The new Ghost bitmap is decoded/downsampled once to at most 512 px and shared by two band users. Cache totals exclude canvas/compositor/readback/video buffers.

The uncapped new Ghost observation was **51.4127%**, so the final cadence cap's counter was only **0.41% lower** than that run. **These observations do not prove a GPU saving versus 1.6.3 or a meaningful counter reduction from the cap.** The cap reduces how often Ghost is drawn while preserving elapsed-time movement; richer art, bots and the offscreen compositor still require work. GPU clocks, other desktop activity and sampling noise were uncontrolled, so the runs do not establish the cause of counter differences. Flowers passed motion/cache checks without a separate GPU benchmark.

Paired summaries are `.design/performance-1.6.4/baseline-default-vs-final-default.json`, `baseline-ghost-vs-final-ghost-capped.json` and `final-ghost-vs-final-ghost-capped.json`. Raw records are in their corresponding baseline/default/Ghost folders. The default measurement and Stars movie used the prior engine hash `7af92eff115f822c11894b76362f864362bbeb672f0ec9a2b77f0ccc9d054bde`; only Ghost cadence changed afterward. Final Ghost/capture evidence uses `c9724874cb9f58975eff08ac4af2bc75c9ea42b9ed38d630850e3c06888cde7d`.

Old 1.6.3 **43.4961%** isolated counter reduction was measured against 1.6.2 with the removed Galaxy & Comets theme. It is a historical result from a different workload and is not reused as a 1.6.4 performance result.

Local production-UI fixtures use sample chats and simulated transfer acknowledgments. Their offscreen renderers and compositor/readback work differ from visible native views or live ChatGPT. Resource counters must be identified by their actual fixture scope; no whole-desktop or live-account percentage is promised. Zero continuous wide-scene galaxy drawing does not mean zero total GPU use.

## Historical results and limits

[The 1.6.3 record](browser-studio-1.6.3-verification.md) preserves its completed 342-test suite, 24 packaged offline checks, 19-file/metadata parity, 24 unchanged inputs and exact artifacts. Its authenticated arithmetic exchange occurred before its final artwork/theme changes. Its final theme build had no fresh authenticated complex review or visible standalone startup; packaged native screenshot requests returned `UnknownVizError`, disclosed in that record. Those outcomes do not pass the new 1.6.4 gates.

Two reviewers agreeing does not prove 100% correctness. Repeated review cannot guarantee profitability or replace candidate-specific native compilation/backtesting. The earlier trading algorithm's requested six-month native performance remains unfinished. Windows executables are unsigned. Automated, local appearance, build, source-parity and packaged offline gates passed. Fresh live/account review, installer execution and visible standalone portable startup are not claimed.
