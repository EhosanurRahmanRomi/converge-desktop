# Windows 1.9.2 verification

Date: 2026-10-06. Scope: local Windows x64 portable repair. No installer, macOS build or GitHub publication is included.

## Delivered artifact

`Converge-Portable-1.9.2-x64.exe`

- Size: 463,970,155 bytes. This repair uses an uncompressed portable package to reduce build and extraction work; runtime behavior is unchanged by packaging compression.
- SHA-256: `70320db11c2e91ba53fea62c512f06281efebc17eae85faa675a9e26e5b76112`
- Production `app.asar` SHA-256: `0c2c0da6bb9b18c361ceb587f4e3a61dc721e21f5194b6beb4d1400b12cbf3ae`

## Passed checks

| Gate | Evidence |
| --- | --- |
| Complete source suite | 574 passed, zero failures, cancellations or skips |
| Browser submission and stream scenarios | 50 actual Chromium DOM cases, included in the source suite |
| Packaged boss workflow | 20 checks, including exact owned interruption, healthy-peer preservation, fresh recovery requests and final acceptance |
| Packaged project studio | 13 checks, including actual PDF parsing/rendering, revision bytes, project recovery and export |
| Production source parity | 39 runtime files compared byte-for-byte with the packaged archive |
| Actual Windows portable | Native startup, visible first paint, three views, sidebar, boss drawer, progress section and clean Close passed in an isolated session |

The new combined PDF regression uses actual disk-backed original and corrected PDFs. It confirms that a partial stream cannot become a completed answer, a healthy completed worker survives, consumed original attachments are refreshed after both initial workers interrupt, text-only responses cannot finish a PDF task, and the exact corrected bytes reach the boss and both final reviewers. The production PDF parser and bounded rasterizer run before acceptance.

An explicit stream failure with a stale native Stop control remains visibly interrupted. Its owned observer is retained, the failure receipt survives removal of the alert, and progress is inspected every 30 seconds until the provider is idle. Healthy requests keep the normal five-minute interval. The app does not blindly click Stop or Retry.

## Live observations and limits

The old running **1.9.1** window showed **Resume stream unavailable** with partial worker output while the app continued to report Generating. Worker A had completed. A manual provider Retry restarted worker B, but the old request retained its original deadline and later reached its 120-minute allowance. These observations motivated the repair; they are not evidence of successful 1.9.2 recovery on a live provider.

The repaired 1.9.2 portable was opened and the user imported the previously authorized session export. An authenticated short file task used GPT-5.6 High. Both workers created an actual 11-byte UTF-8 text file, the boss received both outputs, and the exact selected bytes were uploaded to both final reviewers. The captured file SHA-256 was `e73b383b35bf33458f23af80b58f0c4143964558149196efe956c8ee5d2fd49d`.

The live workflow **did not complete**: the right final control reply could not be parsed. The final prompts also contained a pending local-check receipt because they were built before local verification finished. These findings triggered the 1.9.3 repair. No successful 1.9.2 live final acceptance or completed large-document deliverable is claimed.

Provider and dialog fixtures are labeled offline in the packaged reports. Passing these tests does not guarantee provider availability, uninterrupted hour-long reasoning, file creation tools, complete visual inspection of every document page, or answer correctness. Three unsuccessful interruption recoveries pause with retained evidence. Each fresh response retains a two-hour allowance; the total workflow remains bounded at 24 hours. Required downloadable outputs cannot be waived by model agreement.

Private session data, live chat URLs, user prompts and source documents are excluded from public evidence. The current local project was backed up before the update; saved projects require reconnecting chats and obtaining fresh acceptance.

## Local evidence

The source and packaged logs are under `.live-test/repair-192-*`. Packaged reports are in `boss-workspace-qa-packaged/packaged-result.json` and `studio-workspace-qa-packaged/packaged-result.json`; actual portable evidence is in `windows-native-startup-b936ecc9-e4c4-450d-ba57-4dcfd60ef993/verified.json`.
