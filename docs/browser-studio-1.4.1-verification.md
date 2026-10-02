> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.4.1 verification

Date: 2026-10-02, Asia/Dhaka. Windows x64.

## Actual defect and repairs

An authenticated original-algorithm task produced an MQ5 source, a ZIP reproduction package, an MT5 .set preset, Markdown and a text check report. The 1.4.0 bridge rejected ZIP/.set, stopping the task at **zero peer-review rounds**. The later left-side manual continuation claimed four internal passes, which are not four actual independent cross-chat rounds.

1. ZIP packages now retain their canonical filename, exact bytes and SHA-256 identity across capture/export/peer upload/save. Host and page validate bounded ZIP headers, the terminal record, central-directory entry count/bounds and referenced local headers. They reject malformed/truncated, multipart and ZIP64 containers. Members are never unpacked or executed by the app; container checks do not authenticate the members or certify their safety.
2. MT5 .set files are inert readable text. UTF-8 and BOM-marked UTF-16 retain their exact original bytes. ChatGPT upload aliases append .txt without changing the canonical downloadable .set name.
3. The five-file limit applies to the actual uploaded batch. Original sources remain validated even when complete source readback replaces their repeated upload. One original plus five candidate files no longer falsely fails when that original is omitted from the upload. Six actual uploads still fail before submission.
4. Unknown executable companions continue to fail clearly. No unsupported companion is silently discarded while a review claims it inspected every output.

## Verified release gates

| Gate | Result | Evidence |
|---|---|---|
| Full automated suite | 327 passed; zero failures, cancellations or skips | `.live-test/release-1.4.1-final-unit-gate.log` |
| Host/download focused regressions | 30 passed | `.live-test/release-1.4.1-host-zip-set-focused.log` |
| Page capture/upload focused regressions | 110 passed | `.live-test/release-1.4.1-bridge-focused.log` |
| Source/coordinator focused regressions | 41 passed | `chrome-extension/test/source-code-deliverables.test.js` |
| Windows build | Exit 0 | `.live-test/release-1.4.1-final-windows-build.log` |
| Packaged desktop fixture | 24 passed; exit 0; stderr empty | `.live-test/release-1.4.1-desktop-packaged-qa-result.json` |
| Packaged runtime parity | 13 exact matches; package metadata equal | `.live-test/release-1.4.1-asar-parity.json` |
| Frozen production inputs | All 16 unchanged after the gates | `.live-test/release-1.4.1-final-source-unchanged.json` |
| Actual portable startup | Rendered v1.4.1; session field, three mode choices, controls and empty panes visible | `.live-test/release-1.4.1-portable-startup-observation.json` |

Focused tests are subsets of the full suite, not additional independent test totals. The 24-stage desktop fixture uses real packaged Electron modules, an isolated localhost page and **simulated model replies**. It is not a live profitability or model-quality test. A fresh installer installation has not been tested.

## Release identities

| File | Bytes | SHA-256 |
|---|---:|---|
| Converge-Setup-1.4.1-x64.exe | 111632066 | `e98f216ae583bb81c40e4bf01cde586db21d910dbc2afb29b85c56e5b4916455` |
| Converge-Portable-1.4.1-x64.exe | 111335130 | `f84dceb7880822eb2c9c993e045fa65a2341b2522aa2046a0515bbbf9ce9723d` |
| win-unpacked/resources/app.asar | 547279 | `386946c14791cf365b48830ee20617a627e0fc0ce06cc8acf48a8f4e4f0650dc` |

The previous 1.4.0 installer/portable/archive were preserved with their original hashes in `.live-test/pre-zip-set-release-1.4.0/` before rebuilding.

## Authenticated verification history

The repaired packaged archive is running through the excluded `.live-test/launch.js` inspection helper in an isolated temporary profile. It imports the user's supplied cookie file into its own in-memory session. Chrome's session/profile is untouched. The helper's displayed launcher version is Electron 44.5.1; the actual portable release independently displays v1.4.1.

Both existing cloud conversations were restored and **GPT-5.6 High, 3 of 5** was read in each native model menu before submission. The fresh original `abcccdalgo.txt` was uploaded to both. Its SHA-256 is `a727d26a09fad4bcfff1464a8f74434f90f6c8d3496ff26add54117cd57175a8`.

The original assignment remains intact with the Exness/MT5 real-tick acquisition requirement for 2026-04-01 through 2026-10-01 UTC, plus warmup, genuine provenance/coverage, baseline comparison, holdout separation and actual native evidence. The resume asks for three actual outputs: complete MQ5, exact .set and the companion ZIP. The app is configured for four full independent peer rounds. Full submitted instructions and acknowledgement are saved in `.live-test/tick-history-resumed-request-1.4.1.md` and `.live-test/tick-history-resume-ack-1.4.1.json`.

At the initial draft snapshot, the right draft and its three outputs had been captured while the left draft was still running. The run subsequently progressed into the peer review described below. Actual initial captured metadata is in `.live-test/live14-repaired-drafts-fifth-check.json`:

| Right draft output | Bytes | Actual captured SHA-256 |
|---|---:|---|
| NovaTrail_MTF_Scalper_Safe.mq5 | 41650 | `a7d88e79f2007d041e95207ec409ffc89a1fb6bca07f6ed3d17e08284a449a38` |
| NovaTrail_safe_defaults.set | 631 | `2c6fca50201875262c1bb030f28355ad16357699c174eed2e04dd2d510ecb6df` |
| NovaTrail_MTF_Safe_Package.zip | 32659 | `97ba8d428dd2eb55f09272d4705724f345a1b20d6e3e1db299e497c976a19631` |

This establishes actual capture/export of ZIP/.set and the source in the authenticated app. The first peer review subsequently received the left-side C1 source, preset and ZIP; it reported matching MQ5/preset hashes and two concrete indicator/filling-policy corrections. Source `CopyLatest()` accepted finite `EMPTY_VALUE`/DBL_MAX and `OnInit()` continued after automatic filling-policy selection failed. The generated replacement's reported hash is `198465d9085942ae1cfc4013baa7e1516088f48f2dffdbae612e0b2cf64a1f45`. At that interrupted first-run snapshot, the reported revision had not been recaptured or compiled. Cloud response evidence is in `.live-test/live14-reopened-server-review.json`; the recovered candidate chain below is a separate, independently captured run.

The captured C1 `NovaTrail_MTF_Scalper_risk20_final.mq5` is 49669 bytes, SHA-256 `2cb3b9d9c26f2d5a7868f0962bff2a1ef362afab49e960abad7510aafe0257c4`. Genuine local MetaEditor compilation of an identical copy completed with **0 errors, 0 warnings, 3062 ms**. No EX5 was executed. Exact source/copy hashes and native log are saved under `.live-test/native-compile/tick-history-141-C1/`. The helper initially encountered an empty log while polling; the same operation was recovered and inspected without another compilation. Compilation is not performance validation.

The live development window closed during that first peer review, losing its in-memory coordinator state. Both cloud chats and actual captured files were preserved. The same packaged build and cookie session were reopened, with the original source and genuine compiler log for the interrupted run's exact C1 uploaded to both. A fresh four-round run was started using their retained source work and actual peer findings. Instructions and acknowledgement are saved in `.live-test/tick-history-resumed-request-1.4.1-recovered.md` and `.live-test/tick-history-resume-ack-1.4.1-recovered.json`. The recovered run's completed verification is recorded next; its candidate IDs are scoped to its own run and must not be confused with the interrupted run's C1.

The source-readback helper includes only text files within its complete-small-source limits; the 49669-byte C1 MQ5 exceeded the 45000-character threshold and was supplied as its exact .mq5.txt attachment. The reviewer actually opened it and reported its matching SHA-256. The preset additionally had matching complete readable JSON in `.live-test/live14-repaired-round1-peer-proof.json`. No truncated source text was represented as complete.

## Completed recovered run

Authenticated run `cb63f6f6-5960-40ff-ba82-20278c9b3f45` completed **four actual independent cross-chat rounds**: eight peer-review turns, with both right and left reviewers contributing in each round. Two independent drafts and seven actual file revisions produced C1 → C8. All eight candidates' three output records were archived: 24 actual MQ5/.set/ZIP records, each matching its captured bytes and SHA-256. The run reached its configured round limit without a file-relay error.

The terminal status was correctly **`limit_reached`**, phase `done`, with stage `Round limit reached with required work unverified`. The app retained the exact files and did not mark the trading assignment complete. The final C8 remains `proposed`; a revision produced in the last turn is not automatically accepted by both reviewers. The ledger contains historical unresolved uncertainty entries as well as still-missing native test evidence; its older “rounds not yet complete” text does not override the independently counted four completed rounds.

Evidence: `.live-test/live14-recovered-review-verification-summary.json` and `.live-test/live14-recovered-final-state.json`.

### Final captured C8 and native Save

| Output | Bytes | SHA-256 |
|---|---:|---|
| NovaTrail_MTF_Scalper_risk20_final.mq5 | 64074 | `d1dece3f106c28cfa3d9c0967972ed1a4c12b381d426e88576d7aef67e344aca` |
| NovaTrail_Risk20.set | 1316 | `d02c84b5b6a380687f7270496cd8d464eded57dfbb8d0a8447718b8cc2241028` |
| NovaTrail_risk20_review_bundle.zip | 187586 | `f033fc5539507c0ed248a657f97a9d31f86e68b3fa00daff940bcfe0c356232d` |

All three were saved through the real app's native Save dialog into `.live-test/saved-current-1.4.1-C8/`. Their saved sizes and hashes equal the captured C8 outputs; see `.live-test/live14-recovered-C8-native-save-verification.json`. ZIP container validity and byte preservation do not authenticate every archive member or establish performance.

After the run stopped, genuine local MetaEditor compilation of an identical copy of the final C8 completed with **0 errors, 0 warnings, 3254 ms**. Both the captured input and compiler copy remained at C8's exact hash. The genuine native log has SHA-256 `71e5d6b2aa2ba42de5136227786134f51858e4a55b84841d185c2bf98a0cdc2b`; evidence is under `.live-test/native-compile/tick-history-141-C8/`. The generated EX5 was not executed. This post-run independent compile result does not retroactively edit the frozen coordinator ledger or prove the other model has accepted C8.

### Continued source supervision

Supervision found another conditional failure in the exact C8 source: `CHoCH_Bear()` and `CHoCH_Bull()` do not validate their `iClose` reads. A failed read returns zero according to the [official iClose reference](https://www.mql5.com/en/docs/series/iclose). With valid positive swings and both failed closes returning zero, the bearish condition can evaluate true and allow an unintended BUY close when the remaining flip gates pass. This is an inference from the actual source and documented API behavior, not an observed live-history failure or executed trade.

The detailed counterexample and requested validated-read checks are in `.live-test/candidate-audit-1.4/cb63f6f6-5960-40ff-ba82-20278c9b3f45/supervisor-C8-challenge.md`. That correction remains under supervision; the C8 compile result does not establish that the logic is correct.

The later galaxy UI and transfer-acknowledgement changes belong to 1.5.0. This authenticated 1.4.1 file/core run cannot alone verify the newer UI or newer packaged archive. See `browser-studio-1.5.0-verification.md` for those separate gates.

## Data and performance limitations

The earlier model drafts reported real network/DNS acquisition failures, no acquired six-month tick dataset and no native compiler/tester available in their environment. They provided reproduction scripts instead of fabricated reports. The trading symbol/server, account currency, starting balance, leverage and costs remain unspecified for this task. A provisional XAUUSD archive choice is not the user's exact account feed.

Official references: [Exness public tick archive](https://www.exness.com/tick-history/), [Exness archive server distinctions](https://get.exness.help/hc/en-us/articles/360021547851-Tick-history), [MT5 Python tick retrieval](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py).

No six-month native backtest or profitability result has been verified for the new candidate. Agreement and compilation alone do not establish win rate, low drawdown, trade frequency or guaranteed profitability. Prior 1.4.0 native compilation belongs to its exact previous source and is not evidence for this run's files.
