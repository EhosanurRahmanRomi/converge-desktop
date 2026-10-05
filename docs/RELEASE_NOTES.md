# Release notes

[← Project](../README.md) · [Verification](VERIFICATION.md)

## 1.8.1 — Boss workspace for Windows and Apple Silicon Mac

- Added Cyberpunk and Anime backgrounds to all three native chat pages and empty panes, retaining Night sky, Black horror and Alien.
- Rechecked boss planning, worker dispatch, requested artifacts, actual file relay and final acceptance. Corrected the argument order in native MT5 evidence checks and inferred required outputs from the initial task.
- Added bounded sequential attachment staging for combined source and worker results, with a complete receipt check before sending a prompt.
- Tightened upload and download validation so malformed text, noncanonical base64 and incorrect archive MIME types fail visibly.
- Retained exact candidate identities, queued instruction revisions, finite round limits and immediate Stop.
- Fixed the attachment-test program's broken-output-pipe dialog, and kept its evidence write alive until completion. This is verification-tool cleanup; it does not mask app errors.
- Built the full boss-and-two-workers application natively for Apple Silicon, including MacBook Air M4, with the same themes, character styles, file handoff and controls.
- Verified native Mac editing on the shell, both worker pages, the boss page and its instruction box; checked Close cleanup and fresh activation. Corrected the drawer-layout test's timing without loosening its geometry checks.

See the [Windows verification](WINDOWS_1_8_1_VERIFICATION.md) and [Mac verification](MACOS_1_8_1_VERIFICATION.md) for the recorded checks and remaining limits. Historical release evidence remains separate.

## 1.8.0 — Windows boss workspace

- Added a third ChatGPT conversation that plans assignments for two workers and reviews their answers and generated files.
- Added a sliding boss panel, opened from the middle animated character, with an instruction box for starting work and adding ideas during a run.
- Preserved same-chat follow-ups, queued instructions, Stop, Reset, Normal/Temporary/Work choices and exact candidate/file checks.
- Added Night sky, Black horror and Alien backgrounds to the actual chat pages.
- Added Robot, Explorer and Spirit character styles, including a distinct boss character.
- Kept the tall worker panes and paused decorative effects in hidden or minimized windows.

This is a locally built Windows update. The published macOS 1.7.0 release retains its existing two-reviewer interface. See the [boss user guide](BOSS_WORKSPACE.md), [architecture](BOSS_ARCHITECTURE.md) and [Windows verification record](WINDOWS_1_8_VERIFICATION.md).

## 1.7.0 — macOS Apple Silicon

The existing Converge workspace is now packaged for native ARM64 Macs, including the MacBook Air M4. The Windows 1.6.5 downloads remain available separately.

### Same workspace and review system

- Retained the two embedded chats, slide-out controls, compact progress/results band, bot animation and Stars, Ghost and Flowers effects.
- Retained the shared review engine, four-round improvement, two-step fixed-answer verification, same-chat follow-ups, Reset, Stop and generated-file handoff.
- Converted the existing application icon to native Mac icon sizes without changing its artwork.

### Mac integration

- Added native application, File, Edit and Window menus with focused copy/paste in the shell and embedded chats.
- Show **Command + Enter** in the task field; prevent repeated or composing-key events from starting a review.
- Close disposes the current workspace and its in-memory session. The app stays in the Dock and opens a fresh workspace on activation; **Command + Q** quits.
- Added native ARM64 DMG and ZIP build and verification workflows. macOS 13 or newer is required by Electron 44.
- Await the asynchronous clipboard write before reporting a successful copy.
- Track native Mac show/hide and minimize/restore transitions so the window's animation visibility stays correct with the bundled runtime.

### Verification and installation

The native ARM64 release passed **377/377 source tests**, **24/24 controlled packaged workflows**, and the actual packaged app startup, native Copy/Paste, Close cleanup and fresh activation checks. Both release archives passed architecture, signature, source parity, executable permission and framework-link verification after ZIP extraction and read-only DMG mounting.

The [Mac verification record](MACOS_VERIFICATION.md) records the completed gates and exact artifact identities; the [Mac guide](MACOS_GUIDE.md) explains installation and shortcuts.

This release uses an ad-hoc signature. It has no Apple Developer ID signature or notarization. Native runner checks do not establish a physical M4 test or live authenticated provider behavior.

## 1.6.5 — 2 October 2026

### Window and workspace

- Removed the blue native Windows caption and introduced custom Minimize, Maximize/Restore and Close controls.
- Added a transparent header over the existing artwork, with a clear noninteractive drag region.
- Reduced the upper stage to **94 px desktop / 82 px compact**, and the closed progress band to **44 / 42 px**, leaving more height for both chats.
- Fit startup dimensions to the primary display's available work area.

### Controls and session import

- Redesigned the slide-out drawer with local Segoe UI Variable typography, clearer field/title sizes and consistent spacing.
- Made the drawer fully opaque so chat content cannot bleed through it.
- Added prominent **Import JSON file** with immediate import after selection; retained pasting in a collapsed alternative.
- Added safe filename/status feedback, size/shape validation, clear import inputs and cancellation/reselection behavior.
- Kept an accepted current session when a replacement import fails validation.

### Python file transfer

- Fixed the live-discovered native `.py` MIME mismatch.
- Accept `text/x-python` only for a selected Python output represented canonically as `text/plain`.
- Retained download ownership, identity, filename, size, Unicode readability, HTML rejection and cancellation checks.
- Added three regression cases and passed all 18 targeted download tests.

### Verification

- **351/351** final automated tests.
- **24/24** controlled workflows against the packaged archive.
- Runtime/source parity for **18 files plus metadata**; **23 frozen inputs unchanged**.
- Actual unpacked Windows built application visibly started as v1.6.5 and closed using its own control.
- Fresh live GPT 5.6 High review completed **four full rounds**, two candidate revisions and exact generated Python file transfers.
- Native Save wrote the accepted C3 bytes; independent audit passed **1,244/1,244** checks.

### Retained behavior and limits

Temporary/Normal/conditional Work modes, same-chat follow-ups, Reset, four-round improvement, two-step fixed-answer verification, files/results and Stop remain in the desktop flow. Glowing stars, Ghost and Flowers retain their existing bounded animation engine and On/Off controls.

The Windows wrappers are unsigned. Fresh installer installation and portable-wrapper startup were not exercised. Live review used the frozen source launcher, while built native startup was checked separately. Agreement does not guarantee correctness for every task. See the [verification record](VERIFICATION.md) for exact scopes and artifact hashes.

## Earlier development

Earlier desktop and extension records are preserved under [history](history/README.md). They document their respective implementations and may include superseded UI or connection behavior. Read the current user/developer guides and the platform-specific verification records.
