# Windows 1.8.1 verification

This audit and final Windows rebuild were completed on 5 October 2026. These results belong to 1.8.1; the [earlier 1.8.0 record](WINDOWS_1_8_VERIFICATION.md) remains historical evidence. The final rebuild incorporates the separate Mac startup verification function; Windows coordination, transport and UI logic remain the same as the live-tested source.

## Results

| Check | Observed result |
|---|---|
| Final complete source suite | **425 / 425 passed**, zero failed or skipped; existing deadlines, sequential execution |
| Packaged production workflows with local model replies | **16 / 16 passed**, no uncaught errors or screenshot warnings |
| Chromium attachment regressions | **18 / 18 passed**, including three batches totaling 15 attachments and missing-receipt rejection |
| Detached test output pipe | Deliberately closed stdout; the 18-stage Chromium test wrote complete evidence and exited **0**, with no error dialog |
| Source/package identity | **21 runtime files** matched source bytes; package metadata reported **1.8.1** |
| Portable release wrapper | Actual portable executable extracted and opened **v1.8.1**; its own Close control ended the window and wrapper |
| Live team | Boss and both workers observed as **GPT-5.6 Sol High**, four improvement cycles and exact C4 final verification |
| Live queued addition | A scalability/testing instruction during boss generation was applied at user revision **1** before subsequent assignments and finish |
| Real generated files | Eight worker file bundles were received across four cycles; the exact selected implementation and tests were delivered for final review and saved through native Windows dialogs |
| Independent saved-file check | Both saved hashes matched C4; **28 / 28 tests passed**, and Python compilation succeeded |
| Five chat backgrounds | Night, Horror, Alien, Cyberpunk and Anime applied to all three native pages; captures and actual CSS backgrounds were distinct |

The packaged fixture checked mixed text, valid PDF and PNG uploads to all three views, same-chat follow-ups, queued instructions, Stop during boss/worker generation, Reset, Normal/Temporary/Work selection, malformed boss output, actual Save bytes, characters, native drawer clipping and focus restoration. It uses isolated local pages and dialog hooks; account-specific Work availability is not proven by those replies.

## Concrete fixes from this audit

- Corrected the native MT5 evidence-check argument order. A controlled positive regression now accepts valid candidate-bound evidence; negative cases still reject absent or stale evidence.
- Infer requested PDF, file and image deliverables from the initial task. A PDF analysis of source code no longer wrongly requires an additional revised program.
- Stage combined source and worker results in bounded upload batches, then check every expected receipt. Missing first or last attachments prevent submission.
- Refresh complete large text originals that do not fit readable snapshots.
- Retain verified changed-file evidence during a final-check JSON formatting retry.
- Prepare both worker prompts atomically, and remove duplicated candidate text from control messages.
- Reject malformed base64, unreadable source bytes and mismatched file types. A ZIP response cannot masquerade as a PDF, image or source file.
- Cancel standalone uploads and result exports on page navigation.
- Fix hidden-panel focus, keyboard access and worker-output visibility. Clarify which boss input controls the team.
- Handle detached QA stdout/stderr without an uncaught Electron dialog, and complete evidence writes before quitting. The screenshot's `EPIPE` came from `scripts/qa-attachment-dom.js`; the live team continued working. The failed exploratory test run was replaced by a complete deliberate broken-pipe regression.

## Live task and answer improvements

The task requested a standard-library Python topological sort, complete downloadable source/tests, lexicographic minimality, malformed-input handling, cycles, one-shot generators and independent randomized verification. An added instruction requested a 10,000-node chain, wide-frontier preemption and insertion-order invariance.

The boss selected successive actual candidates. Workers strengthened single-pass iterator behavior and tests, built an independent permutation/direct-precedence oracle, expanded coverage to all **65,536** four-node directed relations, **150** fixed-seed randomized DAGs, **100** randomized container/order variants and a **200-node** ready frontier. The final tests exercise the 10,000-node chain with recursion limit 100. Final verification required the exact same C4 hashes from both workers; malformed final JSON was repaired before acceptance.

After saving, the files' imports and code were inspected independently on this Windows host. The shipped 28-test suite completed locally in **7.319 seconds**, including the exhaustive and scalability cases. Compilation succeeded. This verifies this finite generated program, not every future model answer.

| Saved file | SHA-256 |
|---|---|
| `topological_sort.py` | `a584638811919aae234e14689af2d9a7636c4ec6726bcb8572be4f54f248f005` |
| `test_topological_sort.py` | `1084b66ae1d3045b1053e84c3e2c89219ab77dbd6b60668037a529b9bcd886c0` |

## Build identity

| Artifact | SHA-256 |
|---|---|
| Windows installer | `bf57f4a82c0178902a77522def99799e40e366fbd9382d773085d7a05aea9d57` |
| Windows portable | `1075eee5a08b17bf9b61f6099db06a550fbd4e0f27d060f91b0e92eb21d26f28` |
| Tested packaged archive | `b5db09b9307d21a7ce891583914d0f65328fe69687d2356dcf0a9b7a109354ee` |

## Limits

- The live team used production source under the matching development Electron runtime. Packaged transport was tested separately, and the real portable wrapper was opened and closed. Installer installation and upgrade were not exercised.
- Mac verification is documented separately. No actual MT5 backtest or quantitative GPU benchmark was performed. The MT5 regression uses controlled evidence fixtures and makes no profitability claim.
- The app stages up to 15 attachments, but a provider may impose a lower cumulative limit. That live 15-file provider limit was not exercised; rejection stops visibly.
- All five chat backgrounds remain still; decorative motion can be disabled and pauses when hidden/minimized. No remote theme assets are fetched.
- Agreement is a finite review result. Missing data, unavailable tools, account limits and provider page changes can still prevent completion.

See the [guide](BOSS_WORKSPACE.md), [architecture](BOSS_ARCHITECTURE.md) and [machine-readable evidence](evidence/windows-1.8.1.json).
