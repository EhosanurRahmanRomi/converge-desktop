> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.4 — verification record

Date: 2026-10-02, Asia/Dhaka. Windows x64.

The final build passed 308 automated tests, all 24 packaged desktop fixture stages, 13 runtime-asset parity checks and actual portable startup. The latest authenticated source task completed four full rounds; a second arithmetic command in the same app and chats completed both verification steps. The app's transport checks and model answer quality are recorded separately. A working exchange does not certify the models' conclusions or trading performance.

## Current fixes

- Rich-editor verification reads real text nodes and paragraph/BR boundaries. This fixes the observed failure where link rendering inserted display spaces inside `(https://...)` while `textContent` fused paragraphs. Full prompt content, punctuation and the request marker still must match; there is still only one Send attempt.
- Review reports accept up to 32 check entries within the existing 100,000-character whole-reply bound. The observed valid 14-check report previously stopped at the 12-entry cap. All its checks are retained. Changed content, malformed lists and candidate mismatches remain rejected.
- Complete readable source records support up to 45,000 decoded characters per file, 60,000 combined and 120,000 JSON characters. The actual refined EA has 39,982 decoded characters, so a small useful change no longer removes its readable source from review. Files are included whole or excluded whole. The 64,000-character code-message preflight remains in force.
- A reviewer receives complete readable current code once per candidate identity. Later rounds reference that exact prior delivery while still attaching a fresh verified copy of the actual file. Changed bytes invalidate reuse. Stop, ownership and candidate checks guard the delivery record.
- Generated MQ5/MQH source is captured and hashed. Browser upload copies use `.mq5.txt` with identical bytes; Save retains `.mq5`. A renamed identical file does not count as a revision. Original input provenance remains distinct from generated candidates.
- General improvement tasks require at least four full rounds; simple arithmetic uses two verification steps. Required native-work findings survive replacements and prevent an unsupported success label.
- The sidebar hides to give both chats room. The bottom drawer shows action, rounds and actual captured outputs; Stop remains accessible. Temporary, Normal and Work choices, reset and next-command behavior remain available.

## Current release gates

| Check | Outcome | Evidence |
| --- | --- | --- |
| Full automated suite | **PASS: 308/308**, zero failures, skips or cancellations; 35.060 seconds | `.live-test/release-1.4-final-unit-gate.log` |
| Targeted bounds/report checks | **PASS: 59/59**. Actual 14-check report, 32/33 boundary, nonstrings, whole-reply bound, existing blank filtering and improvement minimum; whole-source and aggregate bounds | Agent record and checked-in regression cases |
| Submission regressions | **PASS:** actual async paragraph/link/BR hydration; one submission; altered/omitted content rejected; unrelated human turn stops ownership | `chrome-extension/test/content.test.js` |
| Windows build, ASAR parity and packaged desktop fixture | **PASS:** build exit0; 13/13 runtime files and metadata/version1.4.0 match source; 24/24 desktop stages, exit0 and zero stderr, eight exact peer source readbacks over four offline rounds | `.live-test/release-1.4-final-gates.json`; `.live-test/release-1.4-desktop-packaged-qa-result.json` |
| Frozen production inputs | **PASS:** all 15 unchanged through unit/build/package gates. Coordinator SHA `555f9b9f2e47a007e5db4ccbebd8e05457355b2f67ba8a92d71e7269d7100ca5` | `.live-test/final-source-unchanged.json` |
| Exact portable startup | **PASS:** final portable digest `5e68b4f5…afd38b`; actual native version1.4.0, readable first paint, no resizing, isolated profile, no imported session | `.live-test/final-portable-1.4-native-ui.json` |
| Fresh NSIS installation/uninstallation | **NOT TESTED** | Installer generation is not installation |

The packaged desktop fixture uses production modules, shell and sandboxed preloads from the archive through the development Electron launcher, with local simulated provider pages. It checks native uploads/downloads/Save, exact bytes, four rounds, Stop, mode handling and unfinished-work blocking. It does not test real model intelligence. Actual portable startup is checked separately.

## Authenticated live results

The user's Chrome profile was not changed or logged out. Cookies were imported into isolated in-memory Converge test sessions. The original uploaded `abcccdalgo.txt` remains 26,061 bytes, SHA-256 `a727d26a09fad4bcfff1464a8f74434f90f6c8d3496ff26add54117cd57175a8`.

| Run | Actual outcome |
| --- | --- |
| Earlier `d36c9ab9-72f2-4d48-a4ee-92ea92667f31` | Four full rounds and seven byte-changing revisions, C1→C8. Ended at the round limit with native work unfinished. Historical evidence is retained. |
| `5dd02b55-7f02-4041-9b56-512f6e7983bb` | Seven peer reviews, then round-4 preflight failure as repeated source and findings exceeded the message budget. Motivated verified per-reviewer source reuse. |
| `16871c03-905f-4259-8b8f-1a5bcafd6b84` | Actual file added negative-slippage startup rejection and EMPTY_VALUE/nonfinite indicator-buffer rejection. A later peer refused source-file creation; not counted as a passed four-round workflow. |
| `fa6136c3-4500-41d8-b2cd-ffd040f1b282` | Failed before Send with three files and intact prompt. Read-only comparison proved paragraph-joined text matched exactly; visible link spacing did not. Motivated the editor fix. |
| `efb84361-1857-4581-b895-f2c0d486be03` | Submission and actual source relay worked. Complete source readbacks were 54,804/56,486 characters with matching SHA; later references retained identity and fresh files. After two full rounds, the next right report had 14 checks and failed the old 12-entry cap. Models also disagreed with/misread actual trailing arithmetic. Zero source revisions; not a quality pass. |
| `dd840770-df08-4f08-966d-5307219824a4`, same two chats | **Four full rounds, eight peer reviews, ten transcript turns; no transport error.** The independent draft actually changed eligible-level trailing selection; C1 remained unchanged across peer rounds, so in-run revisionCount is0. All three original inputs were attached. Both complete readable copies of the new 40,553-byte source matched its SHA; later references retained fresh exact files. Ended `limit_reached` with required native work unverified in the models' reports. The source was saved through the app and separately compiled afterward. |
| `What is 4 + 6?`, next command in the same app/pair | **PASS:** answer10; both verification steps completed and the run reached `agreed`. Earlier source/native-test requirements cleared. This small deterministic check does not evaluate complex-task quality. |

Evidence includes `.live-test/live14-send-prompt-comparison.json`, `.live-test/live14-sendfix-r1-readable-proof.json`, `.live-test/live14-sendfix-r2-reference-proof.json`, `.live-test/live14-sendfix-r3-report-failure.json`, `.live-test/live14-capfix-next-command-submitted.json` / `...right-submitted.json`, `.live-test/live14-capfix-targeted-final-check.json`, the final left/right readback probes and `.live-test/live14-final-next-arithmetic-finished.json`. A source-reference digest proves identity, not correct analysis.

## Actual native compiler checks

These checks were performed separately by the supervising agent, using the installed MetaEditor64 build 6182, exact copied source bytes and a local native include tree. Generated executables were never run. No MT5 terminal or trading account was used.

| Exact source | Bytes / SHA-256 | Genuine native result |
| --- | --- | --- |
| R16 | Historical candidate | **FAIL:** one error, MqlTick object passed by value |
| R17 | 39,595 / `462b9ae76912894baf0e6728822bd1ee7b5376de253a2ca2e66cf117a8d1c316` | **PASS:** 0 errors, 0 warnings, 2707 ms |
| R17 Improved | 39,988 / `a96bd1037bce41aa3449e176cff3ad603bef225d5ff8a107e32d1d1a02be81c4` | **PASS:** 0 errors, 0 warnings, 2059 ms |
| Latest eligible-level trailing refinement | 40,553 / `402ea55f9ccc8ecf3b6486a530da9061a79e8b089eb2c9e6125c8b1c268e9632` | **PASS:** 0 errors, 0 warnings, 2269 ms |

Logs: `.live-test/native-compile/R16/MetaEditor-native-R16.log`, `.live-test/native-compile/R17/MetaEditor-native-R17.log`, `.live-test/native-compile/R17-improved/MetaEditor-native-R17-improved.log`, `.live-test/native-compile/Eligible-Trailing/MetaEditor-native-Eligible-Trailing.log`. The latest genuine source is saved in `deliverables/NovaTrail_Reviewed.mq5` with the identical captured digest; `deliverables/MetaEditor-compile.log` is the matching native log.

The latest diff changes only the two trailing selection blocks and comments. For LONG, positive levels must be below bid before entering MathMax; for SHORT, above ask before entering MathMin. This fixes the concrete skipped-alternative case in both directions. Existing buffer, tick rounding, improvement, stop/freeze and ticket/retcode checks remain intact. Entry signals and existing risk controls were not changed in that diff. This is a source behavior correction, not measured trading performance.

R17 restored reachable risk-sized entries and corrected the by-reference compiler error. R17 Improved genuinely added the two guards above. A peer's requested extra deviation clamp was redundant: input variables are immutable during execution and the existing OnInit guard rejects negative values. These source facts were checked independently. [MQL5 input variables](https://www.mql5.com/en/docs/basis/variables/inputvariables), [OnInit behavior](https://www.mql5.com/en/docs/event_handlers/oninit), [EMPTY_VALUE](https://www.mql5.com/en/docs/constants/namedconstants/otherconstants).

A real compiler log still certifies identical bytes after a rename. It does not certify a byte-changing revision, live execution or profitability. The app itself checks candidate/report identity and structured **model-reported evidence**; it does not launch native compilers or authenticate a claimed backtest.

## Limits and remaining work

The requested six-month native MT5 backtest, profitability, drawdown, accuracy and retained trade frequency are **unverified**. The exact broker/symbol/data/settings needed for that task were not supplied here. Source changes and agreement cannot replace those measurements. Models have produced incorrect manual traces during these checks, so consensus alone is insufficient.

The EA is a reviewed source candidate, not a certified trading deployment. The latest diff does not address RAM-only daily trade/cooldown state resetting on reinitialization. Mixed manual/other-EA same-symbol usage on netting accounts also needs an ownership test. These remain separate source/runtime review items; a clean compiler result does not resolve them.

Original and candidate attachments together remain limited to five files, 12 MB per file and 24 MB total. Complete text and prompt bounds apply separately. Provider limits, unavailable tools, expired downloads/cookies or changed page markup can stop a run. A required missing output gets one bounded creation follow-up; unsupported or missing evidence stays unfinished. Stop/reset/failure clear private retained original bytes. Captured candidate files remain available for explicit Save on bounded unfinished endings.

Windows executables are unsigned. The installed user app was not replaced during testing. Earlier gate snapshots and actual binaries are preserved under `.live-test/pre-next-send-fix-release/` and `.live-test/pre-checks-cap-fix-release/`; the full earlier narrative remains in `docs/browser-studio-1.4-history-20261001.md`.

## Final artifact inventory

| Artifact under `dist/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `Converge-Setup-1.4.0-x64.exe` | 111,631,155 | `914f33809a6282a8abcd681ba52def10e5997e9cf77a3ba6fbadf2b6bbbfd32e` |
| `Converge-Portable-1.4.0-x64.exe` | 111,334,215 | `5e68b4f5f7e7ac51ab1958c68cb7f6c31ce91a2e33dd93e527a09abd37afd38b` |
| `win-unpacked/resources/app.asar` | 541,169 | `2a1a8d75c38c27a1ab7bcdc0e8ffbecd6983aed1f3b4ec55e1387beb5203e1bb` |

Recorded in `.live-test/release-1.4-artifact-hashes.json` and `.live-test/release-1.4-final-gates.json`. These exact artifacts match the final frozen source snapshot. No fresh installation/uninstallation is claimed.
