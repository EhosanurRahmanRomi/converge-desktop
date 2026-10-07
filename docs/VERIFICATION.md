# Release verification

[Project](../README.md) · [Developer guide](DEVELOPER_GUIDE.md) · [Release notes](RELEASE_NOTES.md)

## Current release: 1.9.9

Verification records bind checks to specific source revisions and download hashes. They distinguish controlled model fixtures, native application checks and authenticated provider use.

| Artifact | Record |
|---|---|
| Approved Windows portable | [Windows 1.9.9](WINDOWS_1_9_9_VERIFICATION.md) · [Public evidence](evidence/windows-1.9.9.json) |
| Windows installer | The release's Windows installer report records clean-runner install, source parity, actual installed startup and uninstall |
| Apple Silicon macOS DMG and ZIP | The release's Mac report records native ARM64 source tests, archive verification, packaged workflows and startup |
| All downloads | [Artifact lengths and SHA-256](release-artifacts.json) · release `SHA256SUMS.txt` |

The native installer and Mac gates are being run for publication. Their final reports identify the workflow run and source commit. Historical counts below belong only to their original artifacts.

## What the checks establish

- **Source tests:** exercised behavior and regression cases.
- **Runtime/source parity:** packaged production bytes and dependency metadata match the identified source.
- **Controlled workflow checks:** the current production shell and bridge exchange synthetic replies/files correctly.
- **Native startup:** the actual packaged executable renders and its native controls/lifecycle work in an isolated test session.
- **Installer roundtrip:** the exact tested setup installs and removes its program files on a clean Windows runner.
- **Mac archive checks:** the shipped ZIP and DMG contain verified ARM64 bundles with intact ad-hoc signatures.

These checks do not guarantee model accuracy, provider availability, aesthetic quality or uninterrupted long remote tasks. Local PDF parsing/rasterization is separate from visual review. A model's reported review is labelled model evidence.

The current release does not claim a physical MacBook Air M4 test or a fresh authenticated Mac conversation. Platform reports explain their specific remaining limits.

## Historical evidence

- [Windows 1.9.8](WINDOWS_1_9_8_VERIFICATION.md)
- [Windows 1.9.7](WINDOWS_1_9_7_VERIFICATION.md)
- [Windows 1.9.6](WINDOWS_1_9_6_VERIFICATION.md)
- [Windows 1.9.5](WINDOWS_1_9_5_VERIFICATION.md)
- [Windows 1.9.4](WINDOWS_1_9_4_VERIFICATION.md)
- [Windows 1.9.3](WINDOWS_1_9_3_VERIFICATION.md)
- [Windows 1.9.2](WINDOWS_1_9_2_VERIFICATION.md)
- [Windows 1.9.1](WINDOWS_1_9_1_VERIFICATION.md)
- [Windows 1.9.0](WINDOWS_1_9_0_VERIFICATION.md)
- [Windows 1.8.2](WINDOWS_1_8_2_VERIFICATION.md)
- [Windows 1.8.1](WINDOWS_1_8_1_VERIFICATION.md)
- [Mac 1.8.1](MACOS_1_8_1_VERIFICATION.md)
- [Mac 1.7.0](MACOS_VERIFICATION.md)
- [Windows 1.6.5](WINDOWS_1_6_5_VERIFICATION.md)

Raw cookie exports, account traces and private project inputs are excluded from the public repository. Public evidence substitutes neutral user-directory prefixes while retaining artifact hashes and the original scope.
