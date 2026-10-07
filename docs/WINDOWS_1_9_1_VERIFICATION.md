# Windows 1.9.1 verification record

[← Converge](../README.md) · [Project studio](STUDIO_GUIDE.md) · [Release notes](RELEASE_NOTES.md)

## Delivery scope

The local Windows x64 portable is built and checked. These results identify the exact delivered build. Installer, Mac artifacts and GitHub publication remain deferred for this update. Earlier [1.9.0 evidence](WINDOWS_1_9_0_VERIFICATION.md) retains its original scope.

## Checks completed

| Gate | Result |
|---|---|
| Full source suite | **566 / 566 passed**, zero failed, cancelled or skipped |
| Production archive parity | **39 / 39 files match**, runtime metadata matches |
| Packaged boss workflows | **20 checks passed**, controlled offline replies |
| Packaged studio | **13 checks passed**, real PDF parsing/rasterization, project recovery and delivery |
| Packaged 100 MiB upload | **6 checks passed**, native picker and exact bytes in all three file inputs, offline provider previews |
| Packaged 512 MiB upload | **9 checks passed**, real native picker, three file inputs, byte hashes, cancellation and streamed project recovery/export |
| Actual portable startup and Close | **Passed**, visible first paint, controls and three-view disposal |
| Authenticated GPT-5.6 Sol High file task | **Passed**, text/PDF/PNG sources, 4 work cycles, final worker checks and fresh audit |
| Independent final-file check | **Passed**, actual downloaded JSON bytes and retained project bytes match; all six arithmetic fields are correct |
| Second command in the same workspace | **Passed, 1 work cycle(s), 1 final worker verification and answer 10; earlier file requirements cleared** |
| Production dependency audit | **Zero reported vulnerabilities** at verification time |
| Generated program execution | **Unverified**, Docker unavailable on this host |

## Bugs corrected

- Keep unsubmitted studio edits and project names through refreshes. Cancel stale file previews after navigation or Close.
- Export current saved project bytes; failed autosaves and Save as cannot silently substitute older state or change the project identity.
- Guard conflicting workspace, file-dialog and project operations while keeping Stop available. In-flight attachments are cancelled when Stop is pressed.
- Handle queued user instructions during final verification, invalidate failed required checks, and continue an explicitly restored revision with its original source files.
- Wait for fresh-chat readiness. Unrelated model/loading indicators do not masquerade as uploads; both marked and legacy filename/thumbnail uploads still block sending until complete.
- Distinguish requested output formats from attached input formats. A PDF source cannot force an unwanted PDF deliverable when the task explicitly asks for JSON, CSV or another supported format.
- Align the top status and Project studio controls without overlap while preserving the header and chat heights.
- Stream large original files, captured outputs, project recovery and exports from a private disk-backed store in bounded chunks, preserving exact byte hashes. Application limits are 512 MiB per file, 1 GiB per upload batch and 3 GiB of distinct saved project blobs.
- Show real read/transfer progress and provider processing separately. Cancel before commitment releases upload controls; interrupted or ambiguous page commitment requires receipt-only recovery without duplicate submission.
- Keep lower provider type limits visible: images 20 MB, spreadsheets approximately 50 MB and documents 2 million tokens. See the [OpenAI file-upload FAQ](https://help.openai.com/en/articles/8555545-file-uploads-faq).

Live tests exposed a false upload status on a fresh audit page and a PDF-input/JSON-output requirement mismatch that caused redundant cycles. Review also reproduced a legacy upload detection edge case, a native attach-after-Stop race and top-control overlap. Regressions were added, and the final build below was rebuilt after those repairs.

## Authenticated task scope

Matching **text, PDF and chart image inputs** contained five integers and an incorrect recorded sum. All three were attached to all three chats. Their sizes were verification-input.txt: 39 bytes; verification-record.pdf: 759 bytes; verification-chart.png: 29677 bytes. The boss and workers produced a downloadable **105-byte summary.json**, completed 4 improvement cycles, and ran independent final reviews plus a fresh right-worker audit. A separate local calculation checked the actual output: count 5, sum 86, mean 17.2, minimum -5, maximum 42, and recorded_sum_correct false. Hash checks compared the selected candidate, exact transferred bytes and retained local project bytes.

The local static JSON parser passed. Its informational unexecuted-program coverage remained explicitly unverified; no generated program was executed on the host. Fresh audit is model evidence, and agreement does not establish universal accuracy.

All authenticated tests used the app's isolated session. Chrome's profile was not accessed or logged out. Cookie values are excluded from public reports. A second simple command completed in the same three tabs with a new task identity and cleared file requirements.

The initial boss and both workers explicitly selected **GPT-5.6 Sol High**. The provider's fresh conversation displayed **Latest** with **5.6 High**; Pro was not selected. This records the visible controls and does not infer an undocumented backend model identifier.

## Full-size native file check

A valid **536,870,912-byte PDF** passed through the actual native chooser and production page preload into all three sandboxed Chromium file inputs. Independent streamed SHA-256 reads matched the source on every page. The gate rejected 512 MiB plus one byte, canceled an earlier transfer after three actual chunks without committing or submitting it, kept Stop responsive, then verified saved-project reload and ZIP export after deleting the original fixture. Main-process peak RSS was 0.84 GiB including browser-managed native storage; measured JS ArrayBuffers were 0.0 MiB and peak JS heap 41.8 MiB. The shell's longest heartbeat gap was 94.3 ms. This measures local transport and recovery with offline provider previews, not remote ChatGPT acceptance or total renderer/GPU memory. Full transfer and independent receipt checks took 202.5 seconds; project recovery/export plus cleanup are additional work.

## Artifact identity

| Item | Value |
|---|---|
| Filename | `Converge-Portable-1.9.1-x64.exe` |
| Platform | Windows x64 |
| Size | **116,352,505 bytes** |
| Executable SHA-256 | `bef12e946662014ed0f2e3d451f637b903c60f18b453905820a97e0f3ec5c468` |
| Production app.asar SHA-256 | `1e27ca7ce9633647f047081d62cda3a1b18a401f932b1ac0161152809353b7bd` |

Every packaged check binds this archive hash; native startup binds the actual portable executable hash. [Machine-readable evidence](evidence/windows-1.9.1.json) records the checks and limits.

## Practical limits

The authenticated task was small. Actual remote acceptance of 512 MiB or 100 MiB files, full-size generated-file downloads and a real one-hour provider run were not exercised; large-upload previews and long-task scheduling used controlled fixtures. Provider limits, interrupted remote generations, complex output quality and GPU performance on other computers remain outside this evidence. Larger than 16 MiB text/image content or 64 MiB PDFs receive exact byte/hash verification but bounded local content checks remain unverified. The portable is unsigned. Model agreement cannot guarantee correctness or trading profitability.
