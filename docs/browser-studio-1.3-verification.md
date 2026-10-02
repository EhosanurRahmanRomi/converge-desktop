> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.3 — verification record

Date: 2026-10-01, Asia/Dhaka. Windows x64.

**The rebuilt Windows application's recorded functional gates passed. Independent answer quality is mixed. This is a tested build for further use and evaluation, not a certification of 100% accuracy.**

## What the recording exposed

The app repeatedly reviewed an unchanged C1 PDF. Reviewers supplied criticism and prose describing a revision without exposing an actual replacement file. A nonempty `revisedAnswer` prevented the creation follow-up from running. The original solution also contained incorrect calculations and omitted subparts. Merely repeating reviews did not improve that file.

## Changes

- Constructive refinement: compare both original draft texts, develop a useful alternative, preserve successful parts, and complete the replacement. Positive refinements have explicit changes, benefits, evidence and checks; they need not invent a factual defect.
- Required outputs: one bounded creation follow-up when an initial draft is missing its actual file, or a review proposes changes without an actual revised PDF/image. A second missing deliverable stops as unfinished.
- File identity: verify exported contents before adoption. Identical bytes under another filename do not count as a file revision. Saving recomputes the exact reviewed file's digest in the host.
- Quantitative and document prompts: use available calculation tools, compare printed values with computed results, reopen the actual generated document, and check source questions/subparts and layout. These instructions remain model instructions, not an independent correctness guarantee.
- Source preservation: original uploads are privately retained for the current task and their exact bytes are attached again to each fresh review with an `ORIGINAL_SOURCE` label, alongside the candidate files. Every phase treats their questions/subparts as the task definition. Generated candidates do not replace the source. Major defects take priority over optional polish. Combined uploads are validated; the app explains a limit instead of silently omitting an original.
- File production is a separate natural-language work step. Strict JSON remains for review decisions; report formatting does not replace creating the actual deliverable. The preceding valid review's issues, checks and proposed changes remain attached to the replacement, which needs fresh dual review.
- Revision history: C1 → C2 changes, model-reported benefits, exact-candidate dual checks, and first-draft comparison. Unchanged answers are labeled as verification with no demonstrated improvement. Export retains the revision record.
- Upload failures: failed/progressing upload widgets block readiness; ordinary mentions of file errors do not. Timestamp aliases with a duplicate suffix, such as `(20261001-070436-1).pdf`, are recognized only for the matching basename and extension with a fresh upload receipt. The existing hideable controls, bottom progress/files bar, mode choices, Reset and same-chat follow-ups remain available.
- Code checks: each ordering/tie priority needs its own adversarial checks; small cases should be compared with an independent reference derived from the specification. Internal indices must not replace external IDs in comparisons. Implementation complexity includes actual tuple copies, sorting and storage.
- Review report recovery: one bounded retry can supply missing required fields inside existing issue objects. Candidate ID, verdict, existing issue fields, issue count/order, answer, checks and uncertainties are locally preserved. A changed or erased objection, a second invalid report, a mismatched candidate or an invalid verdict stops. Serious code correctness allegations need a concrete input, independently derived expected result and actual observed or traced result.

## Automated gates

| Gate | Recorded result | Evidence |
| --- | --- | --- |
| Full test suite | 231 passed; zero failures, skips or cancellations; 37.416 seconds. Source hashes unchanged; generated preload exact. | `.live-test/release-1.3-npm-gate-result.json` |
| Source desktop | 19 stages passed; 295.753 seconds. Source hashes unchanged; generated preload exact. | `.live-test/release-1.3-desktop-qa-result.json` |
| Production archive | 19 desktop stages passed; native and package version 1.3.0; all 13 allowlisted production/assets files and runtime metadata match source. | `.live-test/release-1.3-packaged-desktop-gate-result.json`, `.live-test/release-1.3-asar-parity.json` |
| Portable executable | Actual final 1.3 EXE opened, displayed version 1.3.0 and hid its controls to expose both chat slots. Artifact hash matches the final build inventory. | `.live-test/release-1.3-portable-startup.json` |

Desktop gates use the actual Electron shell, isolated preloads and embedded views with offline simulated model responses. They test transport and controls, not provider answer quality. Two source and two packaged child-page compositor captures returned `UnknownVizError`; native bounds and workflows passed. These captures are not counted as successful screenshots.

## Live tests and independent review

### Original worksheet, Normal, GPT-5.6 Medium

The run used the user's original two-page `Exercises_2.pdf` and requested complete detailed solutions for all 15 exercises. No expected numerical answers were supplied to the models. The app recovered a missing initial file and a text-only critique, then relayed six actual file replacements, C1 → C7. At round 4 a reviewer still did not complete the requested correction; the app stopped with an error and no acceptance.

The native Save operation wrote the exact C7 bytes, confirmed by SHA-256 and byte count. Independent inspection of both pages found wrong radiometric dating, omitted alpha recoil, and missing answers to 9(c), 10(b), 10(c), 15(b) and 15(d). It also found insufficient theoretical explanations. Different export hashes and model descriptions of improvements did **not** establish semantic improvement. This failed case led to the stronger numerical execution and document readback instructions in the final source.

Evidence: `.live-test/worksheet-medium-13b-failed.json`, `.live-test/worksheet-medium-13b-audit.json`, `.live-test/worksheet-medium-13b-C7.pdf`.

### Original worksheet, Normal, GPT-5.6 High, structured production (13c)

Failed. Both reasoning menus were observed as “5.6 High, 3 of 3” before Start. Actual PDFs progressed from C1 to C7 and the dating answer improved from 1640 to 1716 years. Later replacements restored atomic numbers and the curie conversion, but retained or introduced wrong Na-24 cooling and beta recoil answers, omitted alpha recoil, and lost numerical parent/daughter results and requested derivations. The run ended at round 4 with an error and no acceptance. Independent all-page inspection did not establish successful whole-task quality improvement. This test prompted original-source anchoring and separate natural file production in the final source.

Evidence: `.live-test/worksheet-high-13c-model-observation.json`, `.live-test/worksheet-high-13c-C1-audit.json`, `.live-test/worksheet-high-13c-C4-audit.json`, `.live-test/worksheet-high-13c-C7-audit.json`, `.live-test/worksheet-high-13c-failed.json`.

### Original worksheet, Normal, GPT-5.6 High, natural production (13d)

Failed. The original two-page source was attached to both pages, with both native menus observed as “5.6 High, 3 of 3” before Start. Eight actual replacements reached C9; the run stopped at round 5 because the right reviewer did not provide the next real PDF. No oracle answers were provided to either model. A later reviewer reported that the original source was unavailable in its review context. This triggered a further source-retention/reattachment fix. The final automated gates above apply to the rebuilt source after that fix.

The independent comparison used the same 17 numerical checks for each actual file:

| Candidate | Correct | Wrong | Incomplete/missing |
| --- | ---: | ---: | ---: |
| C1 | 10 | 6 | 1 |
| C4 | 11 | 5 | 1 |
| C9 | 10 | 3 | 4 |

C4 corrected the Na-24 irradiation time and restored atomic numbers; C9 corrected the parent/daughter activity ratio at the peak and rendered equations legibly. But several other required answers disappeared. A lower wrong-answer count caused by deleting answers is **not** whole-task improvement. C9 retained three physics errors and dropped two nuclear-equation subparts. All final pages were visually checked; no clipping was observed.

Evidence: `.live-test/worksheet-high-13d-model-observation.json`, `.live-test/worksheet-high-13d-C1-audit.json`, `.live-test/worksheet-high-13d-C4-audit.json`, `.live-test/worksheet-high-13d-C9-audit.json`, `.live-test/worksheet-high-13d-failed.json`, `.live-test/worksheet-expectations.json`.

### Original worksheet, Normal, GPT-5.6 High, retained original bytes (13e)

The mechanism completed four full rounds and six actual file replacements. Both reviewers accepted C7. The originals were attached to every fresh review; no oracle answers were supplied to the models. **Independent whole-task result: FAIL, despite model agreement.**

| Candidate | Correct numeric checks | Wrong | Incomplete/missing |
| --- | ---: | ---: | ---: |
| C1 | 12 | 3 | 2 |
| Accepted C7 | 12 | 4 | 1 |

The beta recoil estimate genuinely improved to about 21.9 eV, but the Na-24 atom count became about 3,377 times too small, the peak parent/daughter ratio disappeared, and required atomic numbers disappeared. Other numerical errors remained. All final pages were inspected and were legible; the third page held only one trailing result line. Actual saved bytes matched the accepted candidate. Model claims of recomputation and full coverage were false positives; file identity and agreement are separate from subject correctness.

Evidence: `.live-test/worksheet-high-13e-final.json`, `.live-test/worksheet-high-13e-C1-audit.json`, `.live-test/worksheet-high-13e-C7-audit.json`, `.live-test/worksheet-expectations.json`.

### Scheduling code benchmark, same High chat pair (13d)

This task has overlapping intervals, a cost budget, four tie rules, zero-cost/negative-value jobs, invalid-input handling, non-mutation and a polynomial-time requirement. An independent oracle was created before submission and was never sent to the models. Initial C1 passed 238/340 valid cases and 28/28 invalid cases; the accepted C5 passed 337/340 valid cases and 28/28 invalid cases. This is measured correctness improvement, but three explicit tie-rule cases still fail. The code compares internal indices instead of external job IDs. Its stated complexity omits tuple operations and storage. All supplied model assertions pass but miss this defect. **Whole-task result: FAIL despite dual acceptance at round 4.**

Evidence: `.live-test/text-quality-task.txt`, `.live-test/text-quality-oracle.json`, `.live-test/text-quality-13d-final.json`, `.live-test/text-quality-13d-C1-audit.json`, `.live-test/text-quality-13d-final-audit.json`, `.live-test/text-quality-13d-manual-audit.json`.

### Scheduling code benchmark, new verification instructions (13e)

The first C1 passed only 41/340 valid cases because a referenced variable was undefined. C3 passed all 340 valid cases, all 28 invalid cases, all supplied model assertions and the non-mutation checks. This is an actual measured correction in the automatically exchanged answer; no oracle or expected outputs were sent to the models. Manual complexity/explanation review remains separately recorded.

The run stopped at round 2 because the next reviewer omitted the `correction` field from its issue objects. The app kept the completed C3 and did not claim agreement. This concrete formatting failure prompted a narrow, bounded schema-recovery patch. The final 13f run below verifies four-round completion after that patch.

Evidence: `.live-test/text-quality-13e-failed.json`, `.live-test/text-quality-13e-invalid-review-probe.json`, `.live-test/text-quality-13e-C1-audit.json`, `.live-test/text-quality-13e-current-audit.json`, `.live-test/text-quality-13e-manual-audit.json`.

### Scheduling code benchmark, final production source (13f)

Fresh Normal pages were set to High through both observed reasoning menus. The final production source completed four full rounds, made one actual answer replacement C1 → C2, and both reviewers accepted C2. Independent tests passed all 340 valid and 28 invalid cases for both the first and final implementations, with no input mutation. This run verifies completion and regression preservation; it does **not** show a gain in scheduling correctness, since C1 was already passing those cases.

There was a real answer repair: the complete initial code block failed a wrong example assertion, while the final complete code and supplied tests ran. The final suite replaced rather than corrected that particular test, reducing its included coverage. Both answers still understated tuple-handling complexity, although their algorithms are polynomial and practical at the specified limits. The revision trail's allegation that C1 wrongly selected a negative-value job was contradicted by independent source inspection and four offline replays. That benefit is model-reported and is **not** confirmed improvement.

Evidence: `.live-test/text-quality-13f-model-observation.json`, `.live-test/text-quality-13f-final.json`, `.live-test/text-quality-13f-C1-audit.json`, `.live-test/text-quality-13f-final-audit.json`, `.live-test/text-quality-13f-manual-audit.json`.

### Real PNG creation, refinement, exchange and native Save (13f)

In the same High Normal pair, the app requested a 1200×900 educational rainfall infographic from original data in the question. Both chats produced real PNG files. Four full review rounds completed, one actual byte-verified replacement C1 → C2 was transferred, and both reviewers accepted C2. Independent full-size and 600×450 inspections and pixel measurements verified dimensions, all seven chronological days and numerical labels, both zero days, the zero-based scale, relative bar heights, total/wettest summary, exact requested title/subtitle/footer, and readable unclipped layout.

This was a modest genuine visual refinement: subtitle and caption ink height increased by 3 pixels, the Wednesday numeric label's contrast increased from about 5.52 to 12.17 against the actual background, and top padding increased by 13 pixels. The plot became about 5.4% shorter, but retained correct relative heights and readability. C1 already had correct data; no numerical correctness gain is claimed.

The app's real native Save dialog wrote `Rain_Week_Final_13f.png`, **69,968 bytes**, SHA-256 `fdc37533a4d5f7913cefd0ffe75078ee3cea86e1217a1c06e9693becd688b078`. It exactly matches the independently inspected C2 and terminal candidate metadata. This test checks actual creation, file transfer, refinement, fresh dual review, next-command reuse and saved bytes, rather than a simulated PNG response.

Evidence: `.live-test/image-quality-task.txt`, `.live-test/image-quality-13f-final.json`, `.live-test/image-quality-13f-C1-audit.json`, `.live-test/image-quality-13f-C2-audit.json`, `.live-test/image-quality-13f-final-audit.json`, `.live-test/image-quality-13f-native-save.json`.

### Simple arithmetic after the image task (13f)

The same two chats received `What is 4 + 6?` as the next command. Auto switched to Verify, cleared the image/file requirements and completed exactly two review steps in one round, returning `4 + 6 = 10.` with no revision. Chat IDs stayed the same across the code, image and arithmetic tasks. This is verification of an unchanged answer, not a quality gain. Evidence: `.live-test/arithmetic-13f-final.json`.

## Limits

Agreement and changed file bytes do not prove correctness or a useful improvement. Benefits are model-reported unless independently checked. The underlying model and selected reasoning setting remain important. The app cannot force ChatGPT to create an output or fix a problem it fails to solve.

The first right reviewer receives the left draft's files and already has its own right draft files. Both original draft texts are shared. The original right files are separately sent to the left if proposed as a replacement; otherwise they are not independently attached to the left chat.

Combined original-source/generated review attachments remain limited to five, 12 MB each, 24 MB total. Retained original bytes are cleared on completion, Stop, failure, Reset and the next task. Account limits, tool failures, expired cookies/downloads and future page changes can stop a run. Closing the app loses its private session/run state. Tests use the app's own imported session; the user's Chrome profile is not changed or logged out.

Windows binaries are unsigned. Installer execution and authenticated testing of the final EXE must be distinguished from source/production-archive tests.

## Final build inventory

The 13 allowlisted runtime and asset files and runtime package metadata match the tested source. The archive, source gate and unit gate all contain background digest `206c165e56b66440f6de9d268a66113b4a6b8e6ccab66ebd5aa3170ed98d4565`. The live 13f tests use that same source.

| Artifact under `dist/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `Converge-Setup-1.3.0-x64.exe` | 111,618,429 | `ce2472fafed6a32ad343cd8b7a49b81bddaedd6a1c4ca54d2978461866f0b355` |
| `Converge-Portable-1.3.0-x64.exe` | 111,321,484 | `006a411434c397e37740c376f26a01a0d24ce01edc0055fdd22ab4f5b961f01f` |
| `win-unpacked/resources/app.asar` | 484,323 | `708a0309c21700046e532ad0f7fb2f11db8ee82f91b44e4c353fdf28b7658630` |

Evidence: `.live-test/release-1.3-artifact-hashes.json`, `.live-test/release-1.3-asar-parity.json`, `.live-test/release-1.3-functional-summary.json`. Live authenticated runs used a private development launcher loading these production modules. The actual final portable EXE received a separate startup/UI check without importing cookies. NSIS installation and uninstallation were not run.
