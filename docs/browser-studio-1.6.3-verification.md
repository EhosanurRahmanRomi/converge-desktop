> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.6.3 verification

Date: 2026-10-02, Asia/Dhaka. Windows x64.

**Status: completed local release gates.** Galaxy & Comets, Ghost and Flowers are integrated with their original transparent PNG artwork. The final suite passed **342/342** tests; the Windows installer/portable build, **19 runtime files plus package metadata** parity, and **24/24 packaged offline workflows** passed. All **24** frozen production inputs remained unchanged through the unit, build, parity and packaged checks; artifact hashes are recorded below. A previous 1.6.3 attempt passed 340 of 341 tests but did not finish its gate because a native fixture timed out after its PASS output; its cleanup was adjusted. Theme/artwork changes followed that attempt; the final passing suite covers the current source. Historical 1.6.2 results remain in their own record.

An authenticated GPT-5.6 Sol High arithmetic exchange completed two drafts and two reviews under version 1.6.3 **before the final artwork/theme changes**. The review/file core remained unchanged, but the exact final theme build was not freshly authenticated. A complex file task was prepared, but its attachment operation was canceled and the exchange was not started. Native computer use stopped after the user pressed physical Escape. The arithmetic test does not establish complex task quality or completion of this release. A new visible portable-startup check is not claimed.

## Animation where the user requested it

The full-width upper bot stage and lower progress/files band have their own animated scenes, with long chat panes between them. The upper stage is **108 px**, or **92 px** in compact windows. The lower band has a **56 px minimum**, or **46 px** in compact-height windows; its actual height may grow to fit the controls. The sliding command panel starts beneath the upper stage.

Three themes are selectable in **Settings → App appearance → Animation theme**:

| Theme | Subject artwork and movement | Interface palette |
|---|---|---|
| Galaxy & Comets | Diffuse realistic comet heads and textured dust/ion-like tails travel across drifting stars | Deep blue/violet with cyan, violet and warm-gold highlights |
| Ghost | Friendly luminous ghosts drift across the bands | Mist teal, blue and lavender |
| Flowers | Pink blossoms and separate petals float across the bands | Deep green, blush pink and warm gold |

All themes retain layered band backgrounds and bounded star fields. The subject images are original transparent PNGs generated with the built-in image tool, rather than redistributed NASA/ESO photographs. Full paths, source identities, reusable reconstructed prompts and look references are in [the artwork record](animation-artwork.md).

The existing robots keep their PC screens, typing hands, gaze and expression loops. Cosmetic moods remain decorative; status text follows actual draft/review state. A matching successful peer submission acknowledgment starts the existing **2.8-second** bot approach, document meeting/handoff and return to the two workstations. Busy-only, failed or historical events must not animate a fake transfer.

Each band canvas has `pointer-events: none`, remains below bots and interactive labels/buttons, and is clipped to its own band. Stop, Pause, progress/file controls and Save stay above the decoration. Static dark backings beneath reviewer labels and the compact Save control preserve contrast as bright artwork passes behind them. Final captures for all three themes were inspected; the local production-UI fixture passed **13/13** checks with no console errors. Old flat-comet captures are superseded.

### Static chat backdrop and bounded work

The large central galaxy and both embedded-page galaxy backgrounds render a **still backdrop**. They do not resume continuous galaxy shaders when animations are enabled. Resizes or context recovery may draw an updated still frame. Continuous theme animation is limited to the two narrow bands.

The upper scene has 104 stars and the lower scene has 68. Galaxy uses four upper comet paths and three lower paths; Ghost uses five upper actors and four lower actors; Flowers combines blossoms and petals. Both bands retain a **30 fps cap**, bounded drawing dimensions and owned lifecycle cleanup. Nebula/glow caches are built at initialization or actual size changes. The selected PNG is downsampled once to at most 512 px on its longest side, shared between both bands and released when its last user changes theme or disposes. Original PNG files remain unchanged on disk.

The browser still composites animated bands, bot SVG and ordinary page content. This architecture does not imply zero GPU use.

### Settings and global motion controls

**Settings → App appearance → Animations** is an actual On/Off switch, synchronized with top-bar **Pause effects / Resume effects**. Both remain available during a review and preserve the saved pause preference.

- **On:** the selected band theme and existing bot movement run; central/chat backdrops stay still.
- **Off:** bands and bots retain still frames, mood timers stop and any current document handoff is canceled.
- **Hidden/minimized:** decoration suspends while background review/page transport remains available; restoring obeys the saved setting.
- **System reduced motion:** decoration stops and the switch/quick toggle are disabled until that system setting changes. A static theme can still be selected.

Theme changes preserve the current animation clock and pause state, redraw the selected theme once when paused, and save `converge.effects.theme`. They do not reset chats, change the imported account session, restart the exchange or modify task files. The existing saved pause key remains `converge.galaxy.effectsPaused`. Pagehide disposes both ribbon controllers and the static galaxy controller; host-visibility subscription cleanup is retained.

## Performance evidence and its scope

The final current-artwork comparison used the production shell and embedded-page appearance code in **three separate offscreen Electron renderer processes**, with harmless sample chat DOM and host APIs. It had no account, cookies, Chrome-profile changes or cloud responses. Both runs used a 1366 × 768 shell, 669-px-wide page windows, Intel UHD Graphics 620 and a 60 Hz offscreen setup. Native page height intentionally changed from **547 to 532 px** for the larger lower band. The optimized workload lasted **18.047 seconds** with the default Galaxy & Comets theme.

| Measured fixture quantity | 1.6.2 baseline | Current 1.6.3 |
|---|---:|---:|
| Isolated Windows process-group 3D-engine counter, eight-sample mean | 97.1169% | **54.8749%** |
| Steady shell WebGL galaxy draws | 503 | **0** |
| Steady left/right page WebGL galaxy draws | 361 / 361 | **0 / 0** |
| Steady left/right page paint events | 371 / 373 | **0 / 0** |
| Top/bottom animated ribbon frames | Not present | **518 each**, approximately **28.703 fps** |

The counter was **43.4961% lower relative to baseline for this isolated Galaxy & Comets fixture workload**. Ghost and Flowers passed motion/cache checks but did not receive separate GPU benchmarks. The visual workload changed: full-area moving galaxies became still, and two narrow bands animate the new subjects. This is not an identical-animation shader benchmark, a whole-desktop GPU percentage or a measurement of visible live ChatGPT. Offscreen compositor/readback overhead differs from visible native views; unrelated desktop processes and GPU clock changes were not controlled. Zero optimized WebGL samples means no steady galaxy shader drawing, not zero total GPU use.

All three wide galaxy controllers stayed at **2 → 2 frames**, zero scene elapsed time, and **2 → 2 field bakes**. Each band stayed at one cache build throughout the steady measurement. Default galaxy private ribbon caches were **799,776 bytes top** and **523,024 bytes bottom**, plus one **419,840-byte shared comet bitmap**, totaling **1,742,640 bytes**. This counts the bitmap once; it is additional decoration cache rather than total process memory. Theme checks found one ready shared bitmap with two ribbon users after each selection: Ghost **958,464 bytes**, Flowers **1,009,664 bytes**. No steady cache growth or console errors was recorded.

Final comparison: `.design/performance-1.6.3/whole-ui-comparison-final.json`; raw current measurement: `.design/performance-1.6.3/optimized-readability-final/results.json`. The old `optimized-ui/results.json`, flat-art preview and earlier 41.7% candidate result are superseded. An attempted native On observation returned ambiguous zero counter samples and does not establish an actual app On/Off GPU conclusion. The earlier 1.6.2 shader-only approximately 58% result belongs to its own workload.

### Current visual and motion checks

`.design/performance-1.6.3/themed-readability-final/results.json` passed **13/13** local production-UI checks: Pause/switch synchronization, persistence, host visibility, desktop/compact layout, clickable Stop, Canvas2D pause/resume/resize/disposal, still native backdrops, paused theme changes, and loading/motion/cache reuse of all three real PNGs. Sample chat activity and transfer acknowledgments were simulated; these checks are separate from cloud exchange quality.

Final inspected captures are `themed-readability-final/{galaxy,ghost,flowers}-motion-frame-2.png`, `settings-theme-selector.png` and `compact-running.png` beneath `.design/performance-1.6.3`.

Three theme previews were decoded and played end to end, with no corrupted frames. Their duration was approximately **11–11.6 seconds**; the preview camera captured around **14–14.6 fps**, which is separate from the measured 28.703 fps production animation. Playback reported zero dropped frames for Galaxy, five for Ghost and two for Flowers. These clips show the actual production engine and UI with simulated chats; they precede the final static dark label/Save backing. The final PNGs show that readability correction. Decoder evidence is `.design/performance-1.6.3/theme-video-inspection/results.json`.

## Current gates

| Gate | Status | Evidence or required check |
|---|---|---|
| Three theme selectors and palettes | Passed local production-UI fixture | `themed-readability-final/results.json` |
| Original transparent artwork | Files present and inspected; hashes recorded | `docs/animation-artwork.md` |
| Current upper/lower visuals and continuous motion | Final PNGs inspected; three clips decoded; 13/13 local checks passed | `themed-readability-final`, `theme-video-inspection/results.json` |
| Settings On/Off, quick-toggle sync and availability while running | Passed local production-UI fixture | `themed-readability-final/results.json` |
| Theme switching, saved selection, paused switching and shared-asset cleanup | Passed local fixture and final full suite | Local theme checks; `test/renderer-animation-themes.test.js` |
| Static central/native backdrops and host visibility suspension | Passed local fixture and final full suite | Local controls/native-scene checks and native window test |
| Current-artwork performance comparison | Galaxy & Comets: 43.4961% lower isolated offscreen 3D-engine counter; zero steady wide-scene WebGL draws | `whole-ui-comparison-final.json` |
| Full automated suite and frozen source | **342/342 passed**, 24 unchanged production inputs, exit 0 | `.live-test/release-1.6.3-final-unit-gate-result.json` |
| Windows installer/portable build | Passed, **116.453 seconds** | New 1.6.3 artifacts listed below |
| Exact runtime parity and artifact hashes | Passed, **19 runtime files plus package metadata**, **11.425 seconds** | `.live-test/release-1.6.3-asar-parity.json`, `release-1.6.3-artifact-hashes.json` |
| Windows EXE version resources | Read-only check: **FileVersion 1.6.3** on unpacked, Setup and Portable | `.live-test/release-1.6.3-windows-version-resources.json` |
| Packaged local workflow fixture | **24/24 passed**, exact version **1.6.3**, **378.750 seconds**, local only | `.live-test/release-1.6.3-desktop-packaged-qa-result.json` |
| Actual standalone 1.6.3 portable startup | Not performed after user stopped computer use | Exact new executable would need a visible startup check |
| Fresh authenticated arithmetic exchange | Completed: **4 + 6 = 10**, two drafts and two reviews, GPT-5.6 Sol High | Root-observed live check; separate from visual fixtures |
| Fresh authenticated complex file review | Prepared; attachment canceled; exchange not started | User stopped computer use with physical Escape |
| Fresh installer installation | Unverified | Packaging and portable startup are separate |

The final full suite ran **2026-10-02 02:02:54.450–02:03:45.155 UTC**, elapsed **50.704 seconds**, with zero failures, cancellations, skipped tests or todos. Its frozen-input audit reported no drift. Full output is `.live-test/release-1.6.3-final-unit-gate.log`; the result and source audit remain alongside it.

The complete generation/build/parity/packaged-workflow sequence ran **2026-10-02 02:03:55.390–02:12:22.352 UTC**, elapsed **506.961 seconds**. Every process exited 0; the packaged fixture confirmed version **1.6.3**, all **24** local gates passed, and the final audit found no drift among the **24** production inputs. Summary evidence is `.live-test/release-1.6.3-package-gates-result.json` and detailed packaged workflow evidence is `.live-test/release-1.6.3-desktop-packaged-qa-result.json`.

The packaged fixture loaded production modules, shell and sandboxed preloads from the built `app.asar` using the development Electron launcher. Its launcher/bootstrap reported **44.5.1**, while the packaged app metadata was **1.6.3**; this is not a standalone executable UI observation. Shell screenshots were available, but separate left/right native-page screenshot requests each returned **UnknownVizError**. Native bounds, IPC and workflows passed; full native screenshot capture did not. These capture warnings are preserved in the packaged result rather than reported as a successful visual capture of both views.

A separate read-only Windows resource check confirmed **FileVersion 1.6.3** for `Converge.exe`, Setup and Portable, with ProductVersion **1.6.3.0** on the unpacked executable and **1.6.3** on the wrappers. No executable was launched and no installer was run for that resource check.

## Built artifacts

These files are built and hashed, with source parity and the packaged offline workflow gate passed. Those local checks are separate from a fresh installer installation or visible standalone portable-startup check.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Converge-Setup-1.6.3-x64.exe (local evidence or build output; excluded from this source repository) | 116,339,671 | `47442dac461649c875e0804443793a6fe02a64b7174dc2f45b380e8e35927dfc` |
| Converge-Portable-1.6.3-x64.exe (local evidence or build output; excluded from this source repository) | 116,042,741 | `44ecf945cf76c4d2323f032be7b0e2b71e3c3d7dd92dd4978b4bd570f124f6c7` |
| `dist/win-unpacked/resources/app.asar` | 5,420,264 | `41a46c5d139642fd37d949146ca4d83176f88c8b79476b73073bddc960253ae6` |

## Limits and prior results

Local workflow checks use real app/native-view/IPC/attachment/Save handling with simulated provider replies. They do not certify live reasoning, every future ChatGPT page version or universal answer quality. Two reviewers agreeing does not prove 100% correctness.

Historical **1.6.2** performance/unit/package/portable results are complete in `docs/browser-studio-1.6.2-verification.md`; **1.6.1** layout and motion results remain in its own record. The earlier **1.4.1** authenticated review completed four full rounds/eight peer reviews, seven revisions C1–C8 and exact source/preset/ZIP Save checks. Exact C8 compiled in MetaEditor with zero errors and warnings, as recorded in `docs/browser-studio-1.4.1-verification.md`. That result does not establish the requested six-month native trading performance, which remains unfinished.

Windows artifacts are unsigned. The automated, visual, build, source-parity and packaged offline gates passed. Fresh installer installation, visible new standalone portable startup and a completed complex live review are not claimed here.
