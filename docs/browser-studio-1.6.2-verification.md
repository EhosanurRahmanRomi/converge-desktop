> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.6.2 verification

Date: 2026-10-02, Asia/Dhaka. Windows x64.

**Status: the recorded 1.6.2 performance, source and package gates are complete.** The new **341-test full suite** and **24 packaged local workflow checks** passed, all **15 runtime files plus metadata matched source**, and all **20 frozen production inputs remained unchanged**. The exact standalone portable started and its visual controls were checked in an empty isolated profile. A fresh authenticated cloud exchange and installer installation were not performed. This is historical 1.6.2 evidence; later versions have their own records.

## Scope

This revision makes the existing galaxy animation less expensive while retaining its appearance and motion. It also suspends decorative rendering when the actual app window is hidden or minimized. The reviewer exchange and page bridges remain available in the background. This revision does not change the review protocol or claim improved model reasoning quality.

The full-width upper stage, tall chat panes, PC typing, cosmetic expressions, stars/comets/meteors and **2.8-second** acknowledged meeting/document handoff are retained. Bot CSS and animation timing are unchanged. Cosmetic moods do not indicate confidence or acceptance. Pause effects and reduced-motion settings retain their existing meaning.

### Galaxy rendering

The original scene recomputed five fractal fields, approximately **100 noise hashes per pixel per frame**. The revised scene bakes those fields with the original kernel into two packed RGBA8 textures, then samples the two maps during each frame. Original color equations, star/comet/meteor paths and time inputs are retained. The **30 fps** cap, **1050 × 720** maximum drawing dimensions and **1.25** pixel-ratio cap are unchanged; the work saving does not come from slowing the animation or reducing its drawing size.

The detail map is 2048 × 2048 RGBA8 (**16,777,216 bytes**). The background map follows the drawing size at 1.5× in each dimension, at most 1575 × 1080 RGBA8 (**6,804,000 bytes**). Detail is baked once per WebGL context; background is rebaked only at initialization or actual size changes. Initialization and resize therefore do bounded one-time work and the caches use additional texture memory per scene. Context recovery rebuilds the maps; disposal releases maps, framebuffer, programs/shaders and buffer. DOM size is measured only when the scene's size is dirty. The Canvas2D fallback remains available.

### Measured performance and visual comparison

The completed fixture compared the frozen 1.6.1 shader with the optimized shader on **Intel UHD Graphics 620 / ANGLE Direct3D11**. Both runs used the same pixels and FPS limits, three galaxy canvases in one offscreen renderer and an 18-second workload. GPU durations come from `EXT_disjoint_timer_query`; no disjoint samples were reported. The source identities are:

- Baseline SHA-256: `6d47447cd60c3386990e66283f55b8251162d8b8a3d5ca2ba3d49e26dba3cc25`.
- Optimized SHA-256: `7efaa8326e49f64082f7adc68d1f1de531c45c8ec56e42aa1981903abf43a648`.

| Scene | Drawing size | Baseline median GPU shader time | Optimized median | Less shader time |
|---|---|---:|---:|---:|
| Shell | 1050 × 567 | 20.073 ms | 8.310 ms | **58.60%** |
| Left embedded-page-sized scene | 650 × 500 | 10.928 ms | 4.565 ms | **58.23%** |
| Right embedded-page-sized scene | 650 × 500 | 10.919 ms | 4.561 ms | **58.23%** |

The shell collected 430 baseline and 539 optimized valid GPU samples. Its observed frame rate increased from 24.44 to 30.00 fps within the unchanged 30 fps limit; the smaller scenes increased from 15.33 to 20.00 fps within their unchanged 24 fps limit. The scheduling/readback fixture does not guarantee the same frame rate in every visible app window.

Fixed-time renders at **0, 11, 37 and 100 seconds**, each 1050 × 567 pixels, had mean absolute RGB channel error **0.0849–0.0867 on a 0–255 scale**, or **0.0333–0.0340%**. The 95th-percentile error was one channel level; the maximum was two. No channel differed by more than eight levels. The root reviewer visually inspected the 11-second comparison and observed the same detail, colors, stars and comet arrangement. Packed texture sampling approximates the original fields; these results do not claim byte-identical pixels or perceptual equality for every time/window size.

The initial two field bakes per scene stayed at two throughout the workload, and texture bytes stayed fixed: 22,138,516 for the shell and 19,702,216 for each smaller scene, approximately **58.7 MiB total** across the three contexts. The fixture also passed pause/resume, hidden/resume, resize, context loss/restoration, disposal and explicitly selected Canvas2D fallback checks. Disposed scenes reported zero owned field texture bytes.

Evidence: `.design/performance-1.6.2/baseline-run2-vs-optimized-run1.json`, with raw runs in its `baseline-run2` and `optimized-run1` directories. The earlier `baseline-run1` used hidden requestAnimationFrame scheduling near 1 fps and is excluded from the comparison. API submission timings involving `gl.finish` are not treated as GPU work.

Eight per-second Windows process-group 3D-engine counter samples averaged **96.78% → 59.02%** for the isolated fixture. That counter concerns only its three canvases in one renderer; it is **not whole-app/desktop GPU utilization**, not a live ChatGPT workload and not a promise about Task Manager readings. The runs were sequential and unrelated desktop processes were not controlled. Shader-time savings are the primary reported result.

### Unchanged status polls

The activity deck previously replaced its three text nodes and set/removes unchanged attributes on every page-state poll. Those writes now happen only when the displayed value or classes actually change. The stop-paper cleanup also clears its completed timer reference.

An actual Chromium DOM comparison of **100 unchanged local page-state polls** measured **1,000 deck mutations before** and **zero after**. All three visible labels remained identical. The scene API was stubbed for this isolated comparison, so this result establishes avoided DOM writes, not GPU utilization. Evidence: `.design/performance-1.6.2/deck-poll-mutations.json`.

### Native hidden/minimized suspension

Chromium document visibility does not always follow native window visibility for the two page views, whose background transport stays active. The app now separately publishes native show/hide/minimize/restore state. The shell combines it with document visibility to pause decoration; both embedded pages suspend their cosmetic scene independently of their background bridges. The host event is cosmetic and does not stop the active review or change the user's saved Pause setting.

The native fixture checks:

- An initially hidden app has paused shell decoration and both page scenes.
- Frame counts stay fixed across hidden/minimized observations.
- Both page bridges answer background `INSPECT` requests while decoration is suspended.
- Showing/restoring resumes the two scenes.
- User Pause remains saved and active after a hide/show cycle; explicit Resume restarts the scenes.

Evidence: `test/window-effects-visibility.test.js`. This dedicated native check passed within the final full suite.

## Current gates

| Gate | Status | Evidence |
|---|---|---|
| Unchanged deck status polls | Passed: 1,000 → 0 mutations in 100 identical polls, unchanged text | `.design/performance-1.6.2/deck-poll-mutations.json` |
| Focused layout/motion and next-file-choice regression | Passed: 2/2 actual Chromium tests | `test/renderer-workspace-layout.test.js`, `test/renderer-file-requirement.test.js` |
| Native hidden/minimized decoration with responsive bridges | Passed within the final full suite | `test/window-effects-visibility.test.js` |
| Shader GPU time / fixed-time animation comparison | Passed: ~58% less median GPU shader time; 0.034% maximum mean channel error | `.design/performance-1.6.2/baseline-run2-vs-optimized-run1.json` |
| Scene cache/lifecycle and Canvas2D fallback | Passed for baseline and optimized fixture | Same comparison and raw runs |
| Full automated suite | **341 passed**, zero failures/cancellations/skips/todos; exit 0 | `.live-test/release-1.6.2-final-unit-gate-result.json`, `.live-test/release-1.6.2-final-unit-gate.log` |
| Frozen production source through the full suite | All **20 unchanged**, no drift | `.live-test/release-1.6.2-final-source-before.json`, `.live-test/release-1.6.2-final-source-unchanged.json` |
| Frozen-source Windows installer/portable build | Passed, exit 0; **113.255 s** | `.live-test/release-1.6.2-package-gates-result.json`, `.live-test/release-1.6.2-final-windows-build.log` |
| Exact packaged runtime/source parity and hashes | **15 runtime files byte-equal**, metadata equal; exact artifact hashes recorded | `.live-test/release-1.6.2-asar-parity.json`, `.live-test/release-1.6.2-artifact-hashes.json` |
| Packaged local workflow fixture | **24 checks passed**, exit 0; **375.373 s**; simulated replies | `.live-test/release-1.6.2-desktop-packaged-qa-result.json`, package gate result |
| Frozen inputs throughout package gates | All **20 unchanged**, no drift | `.live-test/release-1.6.2-package-gates-result.json` |
| Actual standalone 1.6.2 portable startup | Observed exact version, panorama/bots, controls close, Pause/Resume in its own empty profile | `.live-test/release-1.6.2-actual-portable-startup.json` |
| Fresh authenticated 1.6.2 cloud exchange | Unverified | Local simulated replies do not establish a cloud run |
| Fresh installer installation | Unverified | Build and portable startup are separate from installation |

The final suite ran from **2026-10-02 00:51:13.839 to 00:51:48.017 UTC**, elapsed **34.177 seconds**. Focused layout/file and visibility reruns are included in the 341-test total, not added to it. This is a new 1.6.2 gate using the exact frozen optimized source and regenerated native-page preload.

### Exact release artifacts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Converge-Setup-1.6.2-x64.exe (local evidence or build output; excluded from this source repository) | 111652014 | `8998ef7a1a18af969163c4aed4cd65bd2211d1c401483e6210d3e6988ae882b5` |
| Converge-Portable-1.6.2-x64.exe (local evidence or build output; excluded from this source repository) | 111355077 | `a16ed537af269ca6adcefa86f39d29bd5b9ac8b8b7ce844ea42f77eeb84c714e` |
| win-unpacked/resources/app.asar (local evidence or build output; excluded from this source repository) | 668131 | `cafac3652697defd76e4e0175eac00513c06d8f833f0c5879d3eb817180854d1` |

The completed package gates ran from **2026-10-02 00:52:08.319 to 01:00:26.706 UTC**, elapsed **498.387 seconds**. Production preload generation, installer/portable build, runtime parity/hash checks and the packaged local fixture all exited 0. The parity/hash gate took 9.546 seconds; all 20 frozen inputs remained unchanged. Build success is not evidence of a fresh installer installation.

The 24-check fixture covers Normal/Temporary/Work selection, rich-editor reload, expand/split, two consecutive four-round improvement tasks in the same chats, two-step arithmetic, image/PDF/source transfer, exact-byte PDF/MQ5 Save, next-command requirement cleanup, missing native MT5 evidence staying unfinished, Stop/cancellation, Reset retaining the imported local test session, partial-upload failure, Work selection proof and Clear session. It uses real app views/IPC/file handling with local simulated provider pages and replies. No live account or trading execution is used.

### Actual standalone portable startup

The exact portable SHA above was opened in a fresh empty isolated profile and inspected using its visible screenshot/accessibility state. The observation record is dated **2026-10-02 00:58:25.916 UTC**. It showed **v1.6.2**, both robot workstations in the full-width stage, changing galaxy/expressions, and long chat panes after an actual controls-close click. The toggle then read **Show controls**. Actual Pause changed the button to **Resume effects**, with matching still-scene snapshots; actual Resume changed it back to **Pause effects**.

The importer was empty, Chrome's profile was unchanged, and no live account was tested. Startup, portable controls, GPU benchmark, local workflows and installer installation are separate scopes. The installer was not executed.

### Initial test-fixture adjustments

The first full attempt passed **339 of 341** tests. The two failures were media-IPC timeout fixtures whose fake `BrowserWindow` lacked the native `isVisible()` / `isMinimized()` methods used by the new visibility publisher. Those mock methods were added with `false` values matching the fixture's hidden, non-minimized window; production code was unchanged. The focused two-test rerun passed. Initial failed evidence is preserved as `.live-test/release-1.6.2-first-unit-attempt-result.json` and its log. The native-page, layout/motion and actual window-visibility checks passed in that initial attempt.

The second attempt passed **340 of 341** tests. The new native visibility fixture sampled its paused frame baseline before Windows delivered its final minimized viewport/ResizeObserver change; the legitimate static resize redraw advanced the count. The fixture now waits at most three seconds for 250 ms of stable frame counters before asserting that another 300 ms produces no frames. Continuous rendering still fails the bounded assertion. The focused visibility check then passed; production rendering was unchanged. That second failed attempt is retained separately. The third full-suite run passed **341 of 341**, and the 20 frozen production inputs remained unchanged through every attempt.

## Verification limits and historical results

The local packaged fixture exercises real app controls, native views, IPC, attachment handling, output identities and file saving against simulated provider pages/replies. It does not establish live model reasoning, current account behavior or a new authenticated exchange.

The earlier 1.6.1 UI/package/startup results remain in `docs/browser-studio-1.6.1-verification.md`. The earlier 1.4.1 authenticated review remains in `docs/browser-studio-1.4.1-verification.md`: two original drafts, four full rounds/eight peer reviews, seven actual revisions C1–C8, exact source/preset/ZIP transfers and Save hashes. Exact C8 compiled in MetaEditor with zero errors and warnings. That historical result does not certify a fresh 1.6.2 exchange or the algorithm's required six-month native trading performance, which remains unfinished.

Two models agreeing does not prove an answer is 100% correct. GPU/frame timings concern the galaxy rendering workload; browser pages, bot SVG, glass/backdrop filters, model content and other applications also contribute to desktop GPU usage. Hardware acceleration remains enabled.
