# Windows 1.9.4 verification

Date: 2026-10-07 (Asia/Dhaka). Scope: local Windows x64 portable.

## Artifact

- `Converge-Portable-1.9.4-x64.exe`: 463,988,087 bytes.
- SHA-256: `c13c78be8f6d0bb5e95d81eea7b88d70e66705dc322cad31e7a44a1e16a53c41`.
- Production `app.asar` SHA-256: `0d68265aa16f465bca38de02d0a04bce927ccf8d494eefe77eff31652cb1c1b7`.
- STORE compression. The delivered copy is hashed against the actual portable used for the native startup gate.

## Repairs

An owned “Connection interrupted. Waiting for the complete answer” message is a nonterminal reconnect state. It is shown truthfully, retains the original request, and is checked every 30 seconds. Healthy generation is not stopped or resent. Terminal interruption detection remains separate; unrelated, quoted and stale warnings are excluded.

TSV tables now have canonical `text/tab-separated-values` metadata across uploads, native and fetched downloads, previews, stored files, exports and local verification. The exact `.tsv` name and Unicode bytes are retained. A provider's `text/plain` native alias is accepted only for the validated TSV filename. Binary data, incorrect identity and hash mismatches remain rejected.

An unsupported output or failed export retires only its failed request without clicking Stop. The healthy peer is preserved. After the peer completes, the boss receives the failure and actual completed evidence, then can request a supported re-export of existing work. Three unsuccessful repairs block with retained evidence. Output metadata or hash corruption still fails closed. A resumed-generation race retains the same owned observer instead of reporting a premature failure.

## Passed local gates

| Gate | Result |
| --- | --- |
| Complete source suite | 596 passed; zero failures, cancellations or skips |
| Actual Chromium submission scenarios | 61 cases, included in the source gate |
| Packaged boss workflow | 21 checks; offline provider and dialog fixtures |
| Packaged project studio | 13 checks; real PDF parsing/rasterization, file bytes, saved-project recovery and export |
| Production archive parity | 39 runtime files compared with source |
| Actual portable startup | Visible first paint, three embedded views, sidebar, boss drawer, progress and clean Close in an isolated empty session |

The added packaged transport case reproduces a generic “Download file” card for `ced_scope_manifest.tsv`, uses its native `text/plain` alias, and verifies actual Unicode bytes and SHA-256 through the boss and both final reviewers. It is a transport test, not proof of CED content quality.

## Authenticated live status

The earlier 1.9.3 short file test completed automatically on GPT-5.6 High. Its actual 11-byte file, exact final candidate, both acceptance checks, fresh right-worker audit and boss finish were verified. This result belongs to 1.9.3.

The subsequent CED run failed. Its 121,029,744-byte archive reached all three chats. The source inventory contains 17 PDFs and 74 pages for Lectures 1–20. Worker B completed a source audit after 38m25s, but its unsupported TSV attachment caused global cancellation of the other worker. A nonterminal connection warning also remained labelled Generating. No complete lecture PDF or coordinator-captured audit was delivered.

The 1.9.4 authenticated two-file task completed automatically on GPT-5.6 High. Both workers produced real UTF-8 TSV and Markdown files. The boss received their actual bytes, selected C1, and both workers accepted that exact candidate after local byte and TSV structure checks. A fresh right-worker audit then accepted it and the boss finished. The TSV contains 45 bytes with real TABs and Unicode; the Markdown contains 11 bytes. Exact file and candidate identities are recorded in `docs/evidence/windows-1.9.4.json` and the delivered `verification.json`. Generic program execution coverage remains unverified; this task generated a table and a short note.

This proves the tested automatic file-transfer and final-review path. It does not establish successful long-document completion or a final lecture PDF.

After the failed run, the two completed worker audit attachments were recovered manually through their visible download controls. The source manifest's 17 filenames, byte lengths, page counts and SHA-256 values were independently checked against the original archive and local inventory. This preserves prior work; it is not an automated coordinator success or a final PDF.

## Bounds and limitations

File staging permits 512 MiB per file and 1 GiB total. Provider limits may be smaller for particular formats or account conditions. Each new response retains a two-hour allowance, with a 24-hour workflow bound. Normal supervision is five minutes; a known reconnecting or interrupted owned stream is inspected every 30 seconds. Healthy generation is left alone.

Saved projects preserve source and revision bytes. Restarting requires session import, fresh conversations and fresh acceptance; previous ownership and approvals are not resumed. Private cookies, class notes, prompts and transcripts are excluded from public evidence. Model agreement and hashes establish neither mathematical correctness nor complete source coverage. A final CED PDF still requires source comparison and rendered visual QA.

Evidence: `.live-test/repair-194-source-tests.log`, `repair-194-packaged-boss.log`, `repair-194-packaged-studio.log`, `repair-194-native-startup.log`, packaged result JSON files, and `windows-native-startup-7b8c9d44-4ff2-417e-ad2e-beb76dce2ab6/verified.json`. No installer, macOS build or GitHub publication is included in this repair.
