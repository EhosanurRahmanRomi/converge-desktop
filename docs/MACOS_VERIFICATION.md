# Converge 1.7.0 macOS verification

[← Project](../README.md) · [Mac guide](MACOS_GUIDE.md) · [Windows 1.6.5 record](VERIFICATION.md)

**Target: native Apple Silicon ARM64 · MacBook Air M4 · Release validation pending**

This record covers the macOS port of the existing Converge desktop application. The shared two-chat review engine, generated-file handoff and visual assets are retained. Mac-specific changes cover shortcuts, native app/Edit menus, native dialogs, window lifecycle and packaging.

The Windows 1.6.5 [verification record](VERIFICATION.md) remains evidence for that Windows release. Its test counts, authenticated review and visible Windows observations are not counted as native Mac results.

## Release gates

| Check | Recorded result | Scope |
|---|---|---|
| Full automated suite | Pending | Shared engine and platform-specific regressions |
| Native macOS ARM64 build | Pending | DMG and ZIP produced on an ARM64 Mac runner |
| Native package architecture | Pending | Main executable and bundled helpers checked for ARM64 |
| Package/source parity | Pending | Packaged runtime compared with the source used for the build |
| Ad-hoc code signature | Pending | Bundle signature verification; no Developer ID or notarization |
| Actual packaged app startup | Pending | Packaged Mac app launches using its bundled runtime |
| Packaged controlled workflows | Pending | Local fixture replies through the packaged runtime |
| Command shortcuts and menus | Pending | Native Mac behavior and renderer shortcut coverage |
| Close, Dock reopen and Quit | Pending | Workspace disposal and a fresh session on reopen |
| Live authenticated Mac review | Not performed | No native Mac provider-use claim |
| Physical MacBook Air M4 observation | Not performed | No device-specific visual, speed or thermal claim |
| Fresh Finder DMG installation | Not performed | No end-user installation claim |
| Quarantined first launch/Gatekeeper exception | Not performed | No notarization or first-launch acceptance claim |

The pending rows will be replaced by the completed native build and test results before the release is described as verified. A successful GitHub Actions ARM64 runner does not by itself establish physical MacBook Air M4 behavior or live authenticated ChatGPT behavior.

## Artifact identities

Release files and checksums are pending:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Converge-1.7.0-macOS-arm64.dmg` | Pending | Pending |
| `Converge-1.7.0-macOS-arm64.zip` | Pending | Pending |

Once published, compare downloads with the checksums on the [1.7.0 release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.7.0). In Terminal, `shasum -a 256` followed by the downloaded file path calculates its SHA-256. Hash identity detects a changed download; it does not establish an Apple Developer ID signature or notarization.

## Scope and limits

- Converge retains the same application design and shared review behavior across the two platforms. OS fonts, file dialogs, menus, display scaling and window management can differ.
- Controlled fixture results establish the workflows exercised by those fixtures. They do not establish account authentication or today's live provider page behavior.
- This release is ad-hoc signed and has no Developer ID signature or Apple notarization. [Apple explains the first-launch checks and available exceptions](https://support.apple.com/en-us/102445).
- No measured performance, battery-life or thermal result is available for the MacBook Air M4.
- Two reviewers can agree on a mistake. An accepted candidate still needs the independent checks appropriate to its task.
