# Windows 1.9.7 recovery verification

Scope: local Windows x64 portable. Artifact: `Converge-Portable-1.9.7-x64.exe`, 464,027,100 bytes. SHA-256: `df494f3eb4c36808e706f8b73714af057784c383e9661663792627c2c66d7cab`. Production archive SHA-256: `f2259e10c4e57f1b7672e947d26fa8cc1972c93d7e544ae5ec9d802cbc74e87a`. STORE compression.

Passed: **614 source tests**, including **103 real Chromium cases**, **22 packaged boss workflows**, **13 packaged studio checks**, **40 runtime file parity checks**, and **actual delivered portable startup/Close**. No source tests failed, were cancelled or skipped. Exact machine-readable evidence is recorded in `evidence/windows-1.9.7.json` and delivered `verification.json`.

## Changes

- Detect fresh owned timeout, delivery, server and too-long failures as supervised interruption receipts. Wait for native generation to become idle before submitting a continuation. Never relay partial text as a completed result.
- Immediately ask the boss to repair only the failed worker. Preserve the healthy peer's request, deadline, completed response and retrieved files. Serialize separate repair jobs when both workers fail.
- Recover interrupted boss repair planning itself. Reject wrong-side recovery plans and keep bounded retry attempts. Authentication, unknown request ownership and exhausted repairs require specific attention rather than repeated submissions.
- Reconnect observation after a main-frame reload or ambiguous Send acknowledgement to the exact original full tracked user turn. No duplicate Send, Stop or attachments. Reject wrong conversations, newer human turns, marker-only matches, duplicate historical turns and cancelled requests.
- Check an expired observation allowance without globally cancelling healthy generation. Continue in bounded intervals within the 24-hour workflow cap. Explicit Stop remains immediate.
- Quarantine invalid output identity and repeated unreadable final reviews without cancelling a healthy peer. Untrusted file bytes never become a candidate or model evidence.
- Save recovery events as historical evidence. Restoring a project still invalidates pending request authority and old acceptance.

## Verification scopes

Source tests exercise the production coordinator, bridge, immutable file store, upload/download paths and verification gates. Real Chromium cases reproduce the observed provider UI failures and reloads. Native boss and studio workflows run the production shell and archive with offline provider/dialog fixtures; the provider replies are deterministic. Production file hashes bind that tested archive to the built source. A separate isolated native startup check launches the delivered portable itself, checks its controls and three embedded views, then verifies Close cleanup.

These checks demonstrate transport, ownership, recovery and file identity behavior. They do not prove every future provider error can be repaired or that a model's answer is mathematically correct.

## Current authenticated workspace

The user's open 1.9.5 workspace was read on October 7, 2026. Its status was Needs attention, round 1/6, with `left chat: The chat navigated before the reply completed` and one queued boss instruction. Both workers were ready; the left showed `Message delivery timed out. Please try again.` and the right showed Stopped thinking in its history. The exact delivery-timeout wording is covered by both idle and still-generating real Chromium recovery cases. A later manually continued right-worker replacement PDF was visible in its native viewer. This old process is not updated by building 1.9.7 and was left open with its conversations intact.

The complete CED lecture deliverable has not passed final acceptance. Earlier captured draft bytes and sampled visual findings remain private. No authenticated 1.9.7 provider workflow or complete long CED run is claimed by these offline gates.

## Switching builds

Save current downloadable files and the project before closing the older window. Launch the 1.9.7 portable for new work; reconnect the chats and load the saved project to continue from its retained task and revisions. Saved project history cannot adopt an old running request as current authority. The new build preserves the 512 MiB local per-file capacity; provider format, token and account limits still apply.

Installer, macOS and GitHub publication are outside this local portable repair.
