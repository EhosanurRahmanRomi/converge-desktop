> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.5.0 verification

Date: 2026-10-02, Asia/Dhaka. Windows x64.

This record distinguishes the authenticated 1.4.1 file/core test, the new 1.5.0 galaxy renderer and transfer acknowledgments, and the final 1.5.0 package gates. The trading assignment is not complete: no genuine six-month native performance result has been verified, and a further source-level price-read correction remains under supervision.

## Changes in 1.5.0

### Galaxy workspace

- Deep navy galaxy chrome with cyan/violet reviewer accents, a bounded glowing star field, nebula gradients, a constellation and orbital details.
- A compact **68 px shared bot deck** above the two chats. Vector bots show actual owned draft/review activity, with thought dots, subtle working motion and hands that pass a document during a confirmed exchange.
- A paper moves only once per real peer submission acknowledgment. Mere page activity, an unsent draft or a pending request is not proof that an answer/file exchange succeeded.
- Generic coordinator `lastTransfer` records identify the actual run, request, candidate, source side, receiving side and whether files were submitted. They are committed only after a successful owned submission for the unchanged candidate. Same-page rechecks do not pretend to hand something to the opposite bot. Existing successful readable-source acknowledgments remain a compatibility fallback.
- Paused, hidden, reduced-motion, stopped and restored historical exchanges do not replay paper movement. The user can pause decorative effects; only that UI preference is persisted.
- Errors, round limits, stalled runs and agreement requiring independent native verification use an attention state. The UI does not celebrate model agreement as proof that a trading strategy is correct or profitable.
- Both chat panes retain more than 85% combined window width. The overlay controls, current-progress/files bar, result tabs and native Save controls remain available. The selected ChatGPT models are not hardcoded into the bot labels.

The galaxy is visible in the app header, bot deck, gutters, controls and result drawer. Embedded ChatGPT pages retain their own opaque backgrounds and readable content; the app does not inject galaxy artwork over the actual chat text.

The star field uses one canvas, at most 160 stars, device scale capped at 1.5 and a maximum of about 18 frames per second. Timers and paper movement stop when hidden or paused. System reduced-motion preferences apply to both CSS and the document animation. No image-generation service, remote font or heavy animation dependency is required.

Production visual files: `renderer/browser.html`, `renderer/browser.css`, `renderer/browser-app.js`. Generic transport acknowledgments are in `chrome-extension/background.js`; the new metadata contains no cookie values or file contents.

### File/core behavior retained from 1.4.1

MQ5 source, MT5 .set presets and ZIP companion packages retain exact bytes, canonical download names and SHA-256 identity through capture, export, peer submission and Save. Source/preset uploads can use inert readable `.txt` aliases without changing the canonical downloadable name. Bounded ZIP checks reject malformed, truncated, multipart and ZIP64 containers; the app never executes or unpacks archive members. Unknown executable companions still fail clearly instead of silently disappearing.

The actual uploaded batch determines the five-file limit; complete retained original-source readback can replace redundant original uploads without falsely counting an omitted file. Twelve-MB per-file and twenty-four-MB total limits remain enforced. Full repair details and the older release identities are preserved in `browser-studio-1.4.1-verification.md`.

## 1.5.0 gates recorded so far

| Gate | Result | Evidence |
|---|---|---|
| Full automated suite | **339 passed**, zero failures, cancellations or skips; exit 0 | `.live-test/release-1.5.0-final-unit-gate.log`, `.live-test/release-1.5.0-final-unit-gate-result.json` |
| Frozen production inputs during unit gate | All **16 unchanged**, no drift | `.live-test/release-1.5.0-final-source-before.json`, `.live-test/release-1.5.0-final-source-unchanged.json` |
| Real renderer layout/activity fixture | Passed within the full suite | `test/renderer-workspace-layout.test.js` |
| PDF output requirement regression | Passed within the full suite | `test/renderer-file-requirement.test.js` |
| Windows installer/portable build | Pending final completion evidence when this record was written | `.live-test/release-1.5.0-final-windows-build.log` |
| Packaged desktop fixture | Pending | Await packaged result |
| Packaged archive/source parity | Pending | Await parity record |
| Final executable bytes and SHA-256 | Pending | Await artifact identity record |
| Actual 1.5.0 portable startup inspection | Pending | Await startup observation |
| Authenticated 1.5.0 follow-up review | Pending | Root will record the newer live run separately |

The renderer fixture checks real production HTML/JS/CSS in Chromium, including native-view bounds with the controls drawer and bottom result panel open. It checks both paper directions, acknowledgment deduplication, rejection of busy-only and same-page handoffs, historical run restoration, paused/hidden behavior and real browser reduced-motion CSS/JS handling. Agreement requiring native work retains an attention state. These focused fixtures are part of the 339 total, not extra independent test totals.

The 16-input freeze covers production code/assets and package metadata. It establishes no drift during the recorded gate; it does not imply that a later executable or a later changed source is automatically verified.

## Visual inspection

The standalone design prototype is `.design/galaxy-ui-preview.html`, with implementation notes in `.design/galaxy-ui-notes.md`. It is offline and explicitly labels simulated activity; it does not connect to ChatGPT or manufacture model replies.

The actual staged renderer was captured and visually inspected at 1366×768:

- `.design/galaxy-renderer-working.png`: controls hidden and an owned peer handoff.
- `.design/galaxy-renderer-controls.png`: controls drawer open.
- `.design/galaxy-renderer-outputs.png`: expanded result drawer and revision view.
- `.design/galaxy-renderer-files.png`: output-card layout and final Save button.

These screenshots use isolated host fixtures. Their blank native slots do not represent a live ChatGPT result. The opaque live pages and final packaged portable still require their own runtime inspection.

## Authenticated file/core evidence from 1.4.1

The earlier authenticated test used the real repaired **1.4.1 packaged archive**, the user's supplied session in an isolated in-memory profile, the original `abcccdalgo.txt` and the original trading prompt plus genuine Exness/MT5 data requirements. Chrome's profile/session was untouched. Both native menus were read as **GPT-5.6 High, 3 of 5** before submission. This is the user-requested High run; it is not a GPT-6 Pro run.

Original source SHA-256: `a727d26a09fad4bcfff1464a8f74434f90f6c8d3496ff26add54117cd57175a8`.

Recovered run ID: `cb63f6f6-5960-40ff-ba82-20278c9b3f45`.

| Observable | Verified result |
|---|---|
| Independent initial drafts | 2 |
| Completed full peer rounds | 4, each containing both reviewers |
| Actual peer-review turns | 8 |
| Actual candidate revisions | 7; C1 → C8 |
| Archived candidate output records | 24; three actual files for each of eight candidates |
| Capture/hash identity | All 24 records match captured bytes |
| File-relay failure at stop | None; stop reason was missing required native evidence |
| Final status | `limit_reached`, phase `done` |
| Final stage | `Round limit reached with required work unverified` |
| Final candidate state | C8 remains `proposed`, not accepted by both |

Evidence: `.live-test/live14-recovered-review-verification-summary.json`, `.live-test/live14-recovered-final-state.json`, and the actual source/preset/packages under `.live-test/candidate-audit-1.4/cb63f6f6-5960-40ff-ba82-20278c9b3f45/`.

The app correctly retained the current files and declared the trading assignment unfinished. A newly revised candidate in the last review turn is not automatically accepted by both reviewers. The frozen ledger includes historical unresolved uncertainty entries; four-round completion is established by the eight independently recorded peer turns, rather than by an older model sentence saying the rounds were still in progress.

### Exact final C8 files

| Output | Bytes | SHA-256 |
|---|---:|---|
| NovaTrail_MTF_Scalper_risk20_final.mq5 | 64074 | `d1dece3f106c28cfa3d9c0967972ed1a4c12b381d426e88576d7aef67e344aca` |
| NovaTrail_Risk20.set | 1316 | `d02c84b5b6a380687f7270496cd8d464eded57dfbb8d0a8447718b8cc2241028` |
| NovaTrail_risk20_review_bundle.zip | 187586 | `f033fc5539507c0ed248a657f97a9d31f86e68b3fa00daff940bcfe0c356232d` |

All three were saved through the real native Save dialog to `.live-test/saved-current-1.4.1-C8/`. Saved sizes/hashes equal the captured C8 files; see `.live-test/live14-recovered-C8-native-save-verification.json`. This proves actual Save behavior for those exact outputs in 1.4.1, not a simulated file-save callback in a renderer test.

### Independent native compile after the run

The exact final C8 source was compiled locally by native MetaEditor after the run stopped: **0 errors, 0 warnings, 3254 ms**. Input and compiler copy remained byte-identical at the C8 hash. The generated EX5 was not executed.

Evidence folder: `.live-test/native-compile/tick-history-141-C8/`, including `compile-result.json`, the exact MQ5 copy and genuine native compiler log. Native log SHA-256: `71e5d6b2aa2ba42de5136227786134f51858e4a55b84841d185c2bf98a0cdc2b`.

This post-run native check establishes compilation of C8. It does not retroactively edit the frozen coordinator's missing-test ledger, authenticate model-reported checks, validate a later revision, or establish performance. The earlier 3062-ms C1 compiler log belongs to a different exact source from the interrupted first run; candidate IDs are local to each run.

## Further algorithm supervision

The final C8 still has a demonstrated conditional price-read failure. `CHoCH_Bear()` and `CHoCH_Bull()` read closes without validating whether `iClose` succeeded or whether the values are positive and finite. The [official iClose documentation](https://www.mql5.com/en/docs/series/iclose) specifies zero on an error.

For example, valid positive swings (`lastHigh=110`, `lastLow=100`) and two failed close reads returning zero make the bearish comparison `0 < 100 && 0 < 100` true. From the exact source, this can allow an unintended BUY close when the other flip gates pass, even if the later SELL entry fails its own checks. This is a conditional source/API inference, not an observed trading event or a claim that a history read failed in the authenticated app test.

The supervisor challenge requests validated close/rates reads in both functions, checks that failed/zero/non-finite reads produce no CHoCH signal, and checks that valid closes preserve intended behavior. It is preserved in `.live-test/candidate-audit-1.4/cb63f6f6-5960-40ff-ba82-20278c9b3f45/supervisor-C8-challenge.md`. The newer authenticated 1.5.0 supervision and any exact revised native compile results will be recorded separately by the root agent.

The actual revision ledger contains concrete corrections to reserve calculations, unresolved partial-entry handling, cancellation before safety closes and recovery of missing/stale tracked order tickets. That demonstrates useful source review; none of those improvements proves measured profitability or that every remaining source issue has been found.

## Data and performance still unfinished

The task asks for six complete months, 2026-04-01 through 2026-10-01 UTC plus warmup, with genuine provenance/coverage, unchanged baseline comparison, separated calibration and holdout, costs and native reports. The model environments reported genuine network/DNS acquisition failures and no usable native tester. Reproduction scripts do not substitute for an acquired six-month dataset or an executed native Strategy Tester report.

The exact trading symbol/server, account currency, starting balance, leverage, commission, swap and execution assumptions remain unspecified for this task. A provisional public XAUUSD archive is not the user's exact MT5 feed. No verified six-month native baseline/revision comparison, frozen-holdout report, profit factor, return, win rate, equity/balance drawdown, expectancy, losing streak or measured trade frequency has been delivered for C8.

Model agreement, four rounds of review, file hash equality, app tests and successful compilation each establish a limited result. They do not establish 100% accuracy, guaranteed profitability or low drawdown. ZIP container checks also do not authenticate every archive member or the performance claims in a reproduction bundle.

## Pending final release work

The remaining 1.5.0 package gates above must be filled from completed evidence. An actual 1.5.0 authenticated peer run must be distinguished from both the older successful file/core run and the isolated visual fixtures. Fresh installer installation has not been verified in this record. No live trade or generated EX5 execution was performed in the checks recorded here.
