> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge 1.2.0 — Windows verification

Date: 2026-10-01, Asia/Dhaka. Windows x64; Electron 44.5.1.

**The recorded functional checks passed and the installer and portable EXE were built.** Live code, PDF and PNG exchanges were tested using the private development app with the authorized imported account. The final archive was checked against the same production source. The actual final portable EXE passed startup and sliding-panel checks. Installer installation/uninstallation and an authenticated exchange launched from the final EXE were not performed.

## Changes in this release

- Auto uses at least four complete improvement rounds for general, creative and file tasks. Improve always uses at least four. A round contains a new review from both sides; two initial drafts plus four rounds means ten responses. A recognized simple numeric expression without source attachments, or explicit Verify, uses two verification responses after the drafts.
- Acceptance is cleared for every round and every changed candidate. Completion requires both reviewers to accept the same current candidate with all tracked issues resolved. Stop, errors and configured limits can end an unfinished run; those outcomes are not presented as agreement.
- Review prompts ask for concrete checks and useful corrections, including small visual refinements. They preserve good parts and prohibit invented objections or unsupported certainty. A revised image or document must expose an actual output; text claiming a file exists is insufficient.
- The command panel slides over the workspace and can be hidden. It closes on Start. With controls closed, the chat slots occupy more than 85% of the workspace width at the tested 1366- and 900-pixel widths. The compact bottom bar displays the action, round and output files, with Save and expandable activity/results.
- Source uploads select the current general attachment picker, recognize actual new image previews and supported filename aliases, and confirm the files before submitting. Completed PDF/image candidates are transferred as actual bytes.
- Current collapsed user messages, React replacements, local-to-server conversation routes and modern assistant/code containers remain correlated to the exact submitted request. Native downloads revalidate their source before the click and retain an acknowledged download when the original control is consumed.
- Verified generated-file bytes are retained for later review and Save, including after history remounts. Exact request identity, size limits and cancellation still apply.
- A failed image-generation widget now reports the provider error promptly instead of waiting or claiming an image exists. Bounded formatting recovery preserves code escapes and only repairs the specific injected file-reference token observed in live JSON.
- Temporary mode remains recognized after its heading disappears when the official current conversation URL has one explicit `temporary-chat=true` flag. A visible off control takes priority; ambiguous/foreign/home routes do not qualify. This does not infer an Unpersonalized setting.
- Normal, Temporary and Work choices return after Reset. The imported private session is retained. Another command reuses the current pair. PDF-specific output requirements clear for unrelated follow-up commands unless the user explicitly keeps that requirement.

## Completed live checks

These were actual ChatGPT page exchanges, separate from the local simulated model fixtures below. Model settings were observed in the native page controls; coordinator records do not encode the selected model.

| Task | Observed result | Evidence |
| --- | --- | --- |
| Python interval repair, Normal, observed GPT-5.6 High | Four full rounds: two drafts and eight fresh reviews; both accepted C1. Three requested examples, 1,009 fixed/randomized function cases, six invalid inputs and all three model assertions passed independent checks. The draft was already correct; this run does not prove a quality gain. | `.live-test/four-round-code-high-completed.json`; `.live-test/four-round-code-high-independent-audit.json` |
| Source PDF plus 7 MB PNG, Normal, observed GPT-5.6 Medium | Both pages received and interpreted the source files. Both produced corrected PDFs. Candidate PDF bytes reached peer reviews; agreement after four full rounds/eight reviews. Save wrote the accepted one-page PDF. Independent text checks and a visual render confirmed 2 + 2 = 4, preserved 3 × 3 = 9, worksheet ID and red-square/blue-circle order. No old 2 + 2 = 5 remained. | `.live-test/pdf-four-round-completed.json`; `.live-test/pdf-final-save-pass.json`; `.live-test/pdf-four-round-saved-verification.json`; `.live-test/pdf-four-round-saved-render.png` |
| NIGHT GARDEN PNG, Work, observed GPT-6.1 Sol Max | Actual downloadable PNG drafts; actual PNG candidate transfer; a reviewer found a broken fox-tail edge and produced a refined PNG. Five rounds/ten reviews ended with both accepting C3 and the issue resolved. Saved final PNG is 1536 × 1024. Independent pixel comparison found exactly 140 changed pixels in [170, 801, 178, 846], with every outside pixel unchanged. Full image and tail crops were visually checked. One demonstrated refinement; no second distinct improvement is claimed. | `.live-test/work-poster-five-round-completed.json`; `.live-test/work-poster-final-save-pass.json`; `.live-test/work-poster-final-independent-audit.json` |
| Next command in the same Normal pair after the PDF | Exact “What is 4 + 6?” completed with two drafts and two verification responses in one round, answer 10, without requiring another file. Stop during the earlier longer-worded follow-up ended that run and prevented resubmission. | `.live-test/normal-post-pdf-two-step-pass.json`; `.live-test/post-pdf-stop-observed.json` |
| Next command in the same Work pair after the PNG | Exact “What is 4 + 6?” completed with two drafts and two verification responses, answer 10. | `.live-test/work-post-poster-two-step-pass.json` |
| Temporary opening, exchange, reload and next command | Both actual pages showed Temporary chat and retained Personalized. First 4 + 6 exchange completed. After the mode-detection fix and both page reloads, the same pair accepted a fresh 8 + 7 command with two drafts/two reviews, answer 15. Both pages remained Temporary and ready at completion. | `.live-test/temporary-final-ready-state.json`; `.live-test/temporary-final-two-step-pass.json`; `.live-test/temporary-fixed-ready-after-reload.json`; `.live-test/temporary-fixed-next-command-two-step-pass.json` |

### Saved live output checks

- Corrected PDF: **26,566 bytes**, SHA-256 `18ab78655c6701b9cec0077499750856c70bd39bec98402ea21137ace748d8c1`. Saved as `.live-test/corrected_arithmetic_CONVERGE-LIVE-731.pdf`. Poppler emitted Symbol/ArialUnicode fallback warnings; the final rendered worksheet was readable without observed clipping or overlap.
- Refined PNG: **284,933 bytes**, SHA-256 `8f563b436bd8b16c20232b1118dc7d65920783f62f0ecde41aa9473ed6ecba93`. Saved as `.live-test/night-garden-final.png`. Visual inspection confirmed one lower-left orange fox, one upper-right orange full moon, three central glowing fireflies, exact title/subtitle/date, ivory background and teal foliage. Pixel baseline was a lossless rendering of the original public image preview, rather than original download bytes.

### Failed cases retained as evidence

Normal mode's image-generation tool returned **“Image generation failed”** in two runs on this account. The revised app stopped clearly on the fresh run with no image relayed. A separate Normal Python/Pillow request claimed a PNG without exposing a file; the app rejected the missing output. Work subsequently produced, exchanged, refined and saved the real PNG above. These observations do not establish a general provider outage or guarantee every account has Work/file-generation access.

Evidence: `.live-test/night-garden-provider-failure-stopped.json`; `.live-test/night-garden-fresh-provider-error-detected.json`; `.live-test/night-garden-rendered-png-draft-failure.json`.

An earlier code run reached dual acceptance but contained a false boundary assertion; the independent audit caught it. A later attempted repair remained unresolved. The new four-round code benchmark passes its independent checks. The earlier failures remain evidence that agreement alone does not prove correctness: `.live-test/complex-code-independent-audit.json`; `.live-test/complex-code-refined-high-provisional-audit.json`.

## Final automated and executable checks

| Gate | Result | Evidence |
| --- | --- | --- |
| Full unit/adapter/actual Chromium suite | **183 passed**, zero failures/skips/cancellations; reported 37.294 seconds. All recorded production source hashes unchanged; generated preload exactly matched its source. | `.live-test/post-reference-npm-gate-result.json`; `.live-test/final-npm-post-reference.log` |
| Source Electron desktop | **19 stages passed**, 299.579 seconds. Source unchanged and preload exact. | `.live-test/post-reference-desktop-gate-result.json`; `.live-test/final-desktop-post-reference.log` |
| Packaged Electron desktop | **19 stages passed** using actual modules/preloads from the final archive. All 11 production files matched current source; package and native version 1.2.0. | `desktop-cookie-packaged-qa-result.json` |
| Final portable EXE | Actual final EXE opened, displayed v1.2.0, and hid controls to expose both full-width chat slots. Only that test window was closed. No cookies imported into this smoke run. | `.live-test/final-portable-1.2-launch.json`; `.live-test/final-portable-1.2-native-smoke.json` |

Desktop gates use offline pages with simulated model responses. They exercise the actual shell, isolated embedded views, IPC, uploads, PDF/image transfer, saved-file bytes, mode choices, follow-up commands, cancellation, Reset, reload, partial-upload failures, malformed replies and app-session clearing. They do not establish authenticated provider behavior or installer execution.

Native embedded-page compositor capture warnings in the source gate: **left native page screenshot: UnknownVizError; right native page screenshot: UnknownVizError**. In the packaged gate: **left native page screenshot: UnknownVizError; right native page screenshot: UnknownVizError**. Shell capture and native page bounds were checked; unsupported compositor captures are not claimed as successful screenshots. The live workflows and actual portable startup were separately observed through native windows.

The packaged QA launcher carries the archive metadata and imports its actual production code; it is not an NSIS installation. Build succeeded with `npm run build:win -- --publish never`. The EXEs are unsigned.

## Final artifact inventory

Paths below are under `dist/`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Converge-Setup-1.2.0-x64.exe` | 111,609,169 | `012e62077d90ce43694bbbdb4625c728d071e894d133d7741ba05998badc856a` |
| `Converge-Portable-1.2.0-x64.exe` | 111,312,243 | `45f89a5b471c7cda81562065b097dc99ee80fe2c7c0dc1beef7c174c3f9aa74f` |
| `win-unpacked/resources/app.asar` | 440,236 | `9df66994feae6ad5226c83b6e304848eb9ba2d940e6ce39b4be692e22e2fb2eb` |

## Practical limits

- Passing these checks establishes the recorded cases, not universal absence of bugs or 100% factual accuracy. More rounds and model agreement do not change the underlying model or ensure a stronger reasoning setting.
- Source/generated files: up to five, 12 MB each, 24 MB total. PDF and PNG were tested live. Other supported extensions have adapter coverage; all document/image generation capabilities still depend on ChatGPT.
- Auto's arithmetic recognition is conservative. Longer explanations or attached files use four rounds; choose Verify explicitly when appropriate. Image-output inference is also conservative; an explicit file requirement is available.
- Account limits, expired cookies/downloads, verification challenges, provider failures and future page changes can stop a task. The app gives an error and preserves completed results where available; it does not bypass authentication or force a provider to generate a file.
- The app uses its own in-memory imported session. No Chrome profile or Chrome logout operation was used. Reset retained the session in live tests; closing the app loses local session/run state. Clear session was exercised only with fake cookies in offline fixtures.
- Work access differed between the earlier and authorized paid-account tests. The current paid-account Work exchange passed; other accounts may be restricted. Unsupported Work selection remains an explicit setup error.
