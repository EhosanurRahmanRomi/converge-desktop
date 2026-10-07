# Windows 1.8.2 verification report

[← Project](../README.md) · [Boss guide](BOSS_WORKSPACE.md) · [Release notes](RELEASE_NOTES.md)

## Candidate scope

The 1.8.2 update is ready as a **Windows x64 portable verification candidate**. Its installer and Mac artifacts are deferred until the user verifies the Windows update. Published 1.8.1 builds and their [Windows](WINDOWS_1_8_1_VERIFICATION.md) / [Mac](MACOS_1_8_1_VERIFICATION.md) evidence keep their original scope. Checks below were completed on **6 October 2026**.

## Current checks

| Check | Recorded status |
|---|---|
| Current source suite | **460 / 460 passed**, zero failures, cancelled tests or skipped tests; final source run on 6 October 2026 |
| Actual Chromium bridge regressions | Included in source suite: upload attribute completion/readiness, response budgets, owned progress inspection, provider interruption, virtualized turns and cancellation/Continue |
| Production large-upload fixture | Included in source suite: **100 MiB PDF**, native picker IPC, three sandboxed views, exact bytes/hashes and completed receipts; local provider fixture only |
| Source boss-workspace integration | **20 checks passed** in the real Windows shell with three real Chromium views and offline provider responses |
| Final packaged boss-workspace integration | **20 checks passed** against the exact final production archive, including interruption recovery, final files, boss summary, remaining issues and Markdown export |
| Packaged large-upload fixture | **Six checks passed**: a **104,857,600-byte PDF** reached all three real Chromium file inputs once, with identical SHA-256; sidebar returned to ready and bridges remained responsive |
| Archive/source parity | **22 runtime files matched** the final source byte for byte; runtime package metadata matched after the builder removed development-only fields |
| Actual 1.8.2 Windows portable startup/Close | **Passed** using the delivered portable wrapper: visible first paint, sidebar and boss drawer, monitoring section, all three embedded views and clean disposal on Close |
| New authenticated provider task | **Not performed or claimed for 1.8.2** |
| 1.8.2 installer and Mac builds | **Deferred** |

Private local logs stay outside Git history. The [sanitized evidence summary](evidence/windows-1.8.2.json) records the checks without account data or private local paths. The packaged workflow and upload fixtures loaded the actual production archive using a metadata-matched Electron launcher. A separate startup gate launched the actual portable executable in an empty, isolated session and checked its Windows shell and Close lifecycle.

## Portable artifact

| Item | Value |
|---|---|
| Filename | `Converge-Portable-1.8.2-x64.exe` |
| Platform | Windows x64 |
| File size | **137,441,344 bytes** |
| SHA-256 | `9df9906ad8b226bf22a1c1d0c434ce51bafc375250e2148b6557e72d61b12f8a` |
| Production `app.asar` SHA-256 | `e474016694785be4575c61a5e97a7864857e2dab308c7410426bb6dc927af4b2` |

The boss-workspace integration, large-upload integration and archive parity results all identify this same production archive. The native startup result identifies this exact portable executable.

## What the new checks establish

- Application caps are **128 MiB per file / 256 MiB per batch**, with five source files and bounded internal attachment staging.
- Large uploads traverse the production app transport with exact file bytes. Local fixtures establish app behavior, not the provider's acceptance limits.
- Model response timers allow the **two-hour default** and a requested **70-minute** budget. Controlled timer tests check scheduling; they are not a real two-hour remote response.
- Upload completion caused only by page attributes updates readiness. Pending-source receipt rechecks avoid repeating the same upload.
- Five-minute supervision distinguishes active work, explicit owned interruption and newer human work. Recovery preserves completed results and waits for safe boss planning; it does not blindly replay the stopped prompt.
- The bottom drawer and Markdown export retain current/final status, remaining issues/limitations and monitoring context.

## Integration coverage

The boss-workspace fixture exercised Normal, Temporary and Work chat modes; text, PDF and image sources; four improvement cycles; distinct boss assignments; generated file transfers and exact saved bytes; extra instructions during generation; follow-up work in the same chats; user Stop for boss and workers; sliding boss panel; five chat backgrounds and three character choices; Reset; and safe handling of invalid boss control output.

For supervision, the fixture deliberately accelerated the interval to **one second for localhost test pages only**. It observed healthy workers without stopping or resending their requests, injected a genuine provider-style stopped-thinking header without a completed answer, retained the healthy peer's actual completed result, and verified a fresh boss plan. The abandoned pair did not count as a completed cycle. The recovered workflow finished four new cycles and recorded its final candidate, boss summary, limitation and monitoring incident in the bottom drawer and Markdown export. Production still uses **five minutes**.

The 100 MiB upload fixture used one sidebar picker selection. Each page received one staged upload with **134 ordered chunks** and one commit. All three file inputs independently calculated the same SHA-256 as the original: `16b1ec921c7e34a55590faaa9f5d3e68cb4a77e2bc6d9868a90eb361c2c4a151`. This check establishes exact application transport; it does not establish remote provider acceptance or 100 MiB generated-file download behavior.

## Verification limits

Provider responses and upload previews in the integration fixtures were controlled offline data. No live ChatGPT task or account limit was tested for 1.8.2. Long-response budgets were checked with controlled clocks, including requests beyond 60 minutes; they were not a real one-hour remote analysis. The portable startup test used an isolated empty session and did not access an existing login or clipboard.

The workflow has a **24-hour safety cap** and a chosen work-cycle cap. Stop and explicit Continue are covered separately. No test claim here establishes guaranteed correctness, improved profitability, access to unavailable tools/data, or continuous live-service availability.
