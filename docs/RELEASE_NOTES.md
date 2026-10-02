# Release notes

[← Project](../README.md) · [Verification](VERIFICATION.md)

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

Native release validation is in progress. The [Mac verification record](MACOS_VERIFICATION.md) records the completed gates and exact artifact identities; the [Mac guide](MACOS_GUIDE.md) explains installation and shortcuts.

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
