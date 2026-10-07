# Windows installer 1.9.9 verification

[Release verification](VERIFICATION.md) · [User guide](USER_GUIDE.md) · [Approved portable](WINDOWS_1_9_9_VERIFICATION.md)

The official **Converge-Setup-1.9.9-x64.exe** passed installation and uninstallation on a fresh GitHub-hosted Windows x64 runner.

| Identity | Value |
|---|---|
| Source commit | `c8d7d88c09e6cacbc7b1b3176cc037eab8a3a300` |
| Native run | [37602397106](https://github.com/EhosanurRahmanRomi/converge-desktop/actions/runs/37602397106) |
| Installer length | 131,227,707 bytes |
| SHA-256 | `fb2959977846a464a7a82082f96a06461a35b0adcf70c0795d5da7fd0593e300` |
| Signing | Unsigned |

## Passed gates

- Official NSIS silent installation into a unique runner temporary directory.
- Runtime metadata and all **41 production source files** match the workflow checkout.
- Packaged PDF.js version **6.4.299**, parser and worker are present.
- Actual installed Converge executable startup: visible shell, first paint, all three embedded views, sidebar, boss drawer, progress section, Close and disposal.
- Empty isolated startup profile; no provider navigation, account import or clipboard access.
- Silent uninstall removes program files, retains app-data intent and preserves the ownership marker outside the install directory.
- Installer bytes are unchanged throughout verification; the source tree remains clean.

The approved portable is retained unchanged as a separate download. Installer and portable contain the same production files; wrapper compression and packaging metadata can produce different executable hashes.

## Scope

The runner verified the installed executable and native lifecycle. It did not test interactive wizard choices, SmartScreen reputation, signing, an existing user's installation or a live model task. The local user session and Chrome profile were not used.

The release includes `windows-installer-verification.json` and `SHA256SUMS-Windows-Installer.txt` with exact artifact identity and provenance.
