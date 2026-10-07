# Windows 1.9.6 verification

Scope: local Windows x64 portable. Artifact: `Converge-Portable-1.9.6-x64.exe`, 463,998,942 bytes. SHA-256: `3cdb45c4d1f140ca602f7bb480b1856d09ded5d3c756c3c9b8b6f6d9e65550c4`. Production archive: `b4fab806770d77d0ba372c8e81a3bd202e4eb087a739c885401a89e1cd9de57d`. STORE compression.

Passed: **601 source tests**, including **84 actual Chromium submission cases**, **21 packaged boss checks**, **13 packaged studio checks**, **39 production parity files**, and **actual portable native startup/Close**. Zero failed, cancelled or skipped source tests in the final run. Machine-readable evidence: `docs/evidence/windows-1.9.6.json` and delivered `verification.json`.

## Repairs

- Accept generated LaTeX source as inert UTF-8 text. Upload a byte-identical `.tex.txt` alias where needed, preserve the canonical `.tex` filename on capture/export, and validate MIME type, decoding, length and SHA-256. Source transfer never compiles or executes TeX.
- Keep complete historical verification evidence in saved projects and portable project exports. Restoring a project retains that history while invalidating old acceptance, pending requests and current verification authority.
- Retain the long-answer context, PDF production checkpoint, owned-error recovery and healthy-peer preservation repairs from 1.9.5.
- Give the existing 20-second animation-layout check enough startup and teardown time. Its assertions remain unchanged; the initial full run passed 598 of 599 tests with that one harness timeout. The final full run passed all 601 tests.

## Executed scopes

The source suite includes actual Chromium submission fixtures and a complete TeX-source capture/export/project-reload regression. Packaged boss and studio checks exercise the production archive using offline provider/dialog fixtures. Production parity binds those tested runtime files to the built archive. A separate native check launches the delivered portable executable in an isolated empty session, checks the shell, three embedded chat views and controls, then closes it cleanly.

These local gates do not prove authenticated provider completion, source coverage or mathematical correctness.

## Authenticated live work

The earlier 1.9.4 portable completed an authenticated GPT-5.6 High two-file workflow, including exact byte relay, both final reviewers, a fresh audit and boss finish. Its evidence remains version-specific.

The ongoing CED test is running on **1.9.5**, which has been left open. All three chats received the original 121,029,744-byte ZIP plus its recovered audit and manifest; GPT-5.6 High was verified in each model menu. Worker B produced a real PDF/DOCX/TSV partial package. When Worker A's generated `.tex` was rejected, the boss preserved the healthy worker and its files and replanned recovery. Worker B subsequently produced a revised partial package while Worker A continued assembling the complete document. Host feedback was queued at a safe boundary without stopping generation.

The original partial PDF's exact bytes, 30 pages, selectable text, outlines, links and TSV structure were checked locally; six rendered pages were visually inspected. This is a sampled partial-artifact check, not proof of full source coverage.

The first complete working draft subsequently arrived and was automatically handed to the boss. Its captured 461,352-byte PDF was independently checked: 66 pages, selectable text on all pages, 43 outline entries and 42 annotations. Its eight-column TSV lists all 74 physical source-page addresses; that proves address completeness, not content coverage. Eight sampled rendered pages revealed genuine missing mathematical glyphs on physical pages 40, 50, 57 and 65, contradicting the worker's visual-QA claim. The exact findings were queued without interrupting the second useful work pair. The accepted final Lectures 1–20 PDF, four useful work pairs and exact final acceptance remain pending. No authenticated 1.9.6 model workflow has been run yet.

## Bounds and delivery

File staging permits 512 MiB per file and 1 GiB per batch; provider limits may be lower. Healthy requests have a two-hour allowance within a 24-hour workflow bound. Normal supervision checks every five minutes; a known interrupted or reconnecting owned request is checked every 30 seconds. Three unsuccessful interruption repairs block with retained evidence.

Only the local Windows portable is included. Installer, macOS and GitHub publication are deferred. Private source notes, browser credentials and live transcripts are excluded from public evidence. See [model error recovery](MODEL_ERROR_RECOVERY.md) for the observed error categories and official guidance.
