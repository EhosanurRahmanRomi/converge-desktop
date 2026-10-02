# Converge 1.7.0 macOS verification

[← Project](../README.md) · [Mac guide](MACOS_GUIDE.md) · [Windows 1.6.5 record](VERIFICATION.md)

**Recorded on 2 October 2026 · Native Apple Silicon ARM64 · Converge 1.7.0**

This record covers the macOS port of the existing Converge desktop application. The shared two-chat review engine, generated-file handoff and visual assets are retained. Mac-specific changes cover shortcuts, native app/Edit menus, native dialogs, window lifecycle and packaging.

The Windows 1.6.5 [verification record](VERIFICATION.md) remains evidence for that Windows release. Its test counts, authenticated review and visible Windows observations are not counted as native Mac results.

## Release gates

| Check | Recorded result | Scope |
|---|---|---|
| Full automated suite on the native Mac runner | **377 / 377 passed** | No failures, cancellations, skips or todos |
| Native macOS ARM64 build | **Passed** | DMG and ZIP produced on an ARM64 Mac runner |
| Native package architecture | **13 ARM64 binaries verified** | Main executable, helpers and bundled Mach-O libraries |
| Package/source parity | **20 runtime files plus metadata matched** | Packaged runtime compared with the source used for the build |
| Ad-hoc code signature | **Passed** | Bundle signature verification; no Developer ID or notarization |
| Actual packaged app startup | **Passed** | Converge.app's own executable and bundled runtime; focused native window |
| Controlled workflows from the packaged archive | **24 / 24 passed** | Local fixture replies under a development Electron launcher with matching metadata |
| Native Copy/Paste in all three surfaces | **Passed** | Native first-responder editing in the shell and both embedded views |
| Command shortcut and menu checks | **Passed** | Command hint in the actual app; shortcuts and menu roles covered by the source suite |
| Close and activate/reopen | **Passed** | Real shell Close, view disposal, automated Electron activate event and a fresh session |
| Source unchanged by build and QA | **Passed** | Clean tracked-source check after the release gates |
| Live authenticated Mac review | Not performed | No native Mac provider-use claim |
| Physical MacBook Air M4 observation | Not performed | No device-specific visual, speed or thermal claim |
| Fresh Finder DMG installation | Not performed | No end-user installation claim |
| Quarantined first launch/Gatekeeper exception | Not performed | No notarization or first-launch acceptance claim |

The native GitHub Actions release run completed successfully. These results establish the recorded runner checks; they do not establish physical MacBook Air M4 behavior or live authenticated ChatGPT behavior.

## Build environment and provenance

The release pipeline runs on a native GitHub Actions `macos-15` ARM64 host and requires both `uname -m` and the Node runtime architecture to identify ARM64. It installs the exact locked dependencies, runs the source suite serially, builds the application, verifies both release archives, launches the actual packaged app, and runs the controlled packaged workflows. A clean source-tree check follows these gates.

The release tag adds the final documentation, showcase banner and inspected native screenshot to the tested code commit. The packaged runtime and build inputs remain unchanged from that passing run.

| Detail | Final recorded value |
|---|---|
| Passing workflow/run | [Native macOS ARM64 release checks — 36991843016](https://github.com/EhosanurRahmanRomi/converge-desktop/actions/runs/36991843016) |
| Tested source commit | [`010c8d12a0ed345c9adde208dd05c1ebcdbfb435`](https://github.com/EhosanurRahmanRomi/converge-desktop/commit/010c8d12a0ed345c9adde208dd05c1ebcdbfb435) |
| Runner image | **macos-15, native ARM64** |
| Host macOS version | **15.7.9** |
| Final full-suite count | **377 passed** in 97.251 seconds |
| Controlled packaged-workflow count | **24 passed**, all local fixtures |
| Inspected ARM64 binaries / framework links | **13 binaries / 14 symlinks** |
| Packaged runtime files compared | **20 plus package metadata** |

The packaged native startup check uses **Converge.app's own executable and bundled runtime**, with an empty isolated session. It waits for the rendered version badge, the observed native show state and an actual focused native key window. It checks the Command shortcut hint and presence of the app menu, then performs native Select All, Copy and Paste in the shell and both embedded views using local text inputs. The check restores the previous clipboard text afterward.

The close check presses the real shell Close button through its normal bridge. It awaits workspace cleanup, checks that the embedded renderers were destroyed, emits Electron's activate event, and checks a newly created setup window with no imported session. **This is automated activation, not a physical Dock click.** The smoke app then closes and exits normally. It does not exercise a physical Command + Q keypress or an authenticated ChatGPT task.

## Packaged workflow and archive scope

The controlled desktop fixture loads the actual application archive under a **development Electron launcher carrying the archive's package metadata** and uses local replies. All **24 workflows passed**; package, launcher and bootstrap versions were each **1.7.0**. Its workflows cover setup, uploads, four-round review progression, required candidates and files, cancellation/reset, bounded errors, session recovery and desktop geometry.

Attach and Save selections use fixture hooks, followed by the real application IPC, filesystem reads/writes, captured candidate bytes and byte-identity checks. This covers PDF and source-file handoff and saved output identity, but **does not exercise physical native file-picker selection**. The fixture performs no live authentication or provider task. Its archive launcher is separate from the actual Converge.app startup check above.

The full source suite's animation fixtures explicitly emulate normal motion, while retaining reduced-motion cases. The actual packaged startup preserves the host's system motion setting. These checks do not measure M4 GPU, battery or thermal performance.

The bundle verifier checks the app ID and version, the macOS 13.0 minimum, the native icon and bundled notices. It inspects the main executable and helpers for ARM64, executable permissions, embedded signatures and permitted library paths. Framework symlinks must resolve within the bundle.

The same verifier passed the extracted ZIP and the read-only mounted DMG. Both retained verified ad-hoc bundle signatures and the same packaged runtime bytes. The ZIP retained executable permissions and framework links; the DMG passed image verification and included its Applications shortcut. Each bundle passed the checks for **13 ARM64 binaries**, **14 symlinks**, and byte parity for **20 runtime files plus package metadata**.

The packaged `app.asar` SHA-256 was **`e3984b62bc56970afb3c1fd52ad91d752f46833e99d1c7a010ad0fabf10f5985`**.

## Actual Mac startup screenshot

![Actual packaged Converge 1.7.0 Mac startup](images/macos-native-startup.png)

The inspected screenshot shows the actual packaged app's fresh setup shell on the Mac runner, with an empty session and visible **v1.7.0**. The **Reduced motion** badge reflects the host's system setting. This is not a live account screenshot or a physical MacBook Air M4 observation. The native startup report was recorded at **09:51:09.589 UTC**.

## Artifact identities

These identities were recorded by the successful native build's release verifier:

The downloaded release files were independently rehashed on the publication host; both byte counts and SHA-256 values matched this record before upload. The final source commit's 20 packaged runtime blobs also matched the native report.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Converge-1.7.0-macOS-arm64.dmg` | 132,956,645 | `6a519dcba2f35dac4849a61502fa667526e5ab0bc23c68b71012a70014f4877a` |
| `Converge-1.7.0-macOS-arm64.zip` | 132,205,666 | `63d2a76963ec530bf0ab2309157dcaf373b48848e6c100c219bf6d2c63e6c30a` |

Compare downloads with the checksums above and on the [1.7.0 release](https://github.com/EhosanurRahmanRomi/converge-desktop/releases/tag/v1.7.0). In Terminal, `shasum -a 256` followed by the downloaded file path calculates its SHA-256. Hash identity detects a changed download; it does not establish an Apple Developer ID signature or notarization.

## Scope and limits

- Converge retains the same application design and shared review behavior across the two platforms. OS fonts, file dialogs, menus, display scaling and window management can differ.
- Controlled fixture results establish the workflows exercised by those fixtures. They do not establish account authentication or today's live provider page behavior.
- This release is ad-hoc signed and has no Developer ID signature or Apple notarization. [Apple explains the first-launch checks and available exceptions](https://support.apple.com/en-us/102445).
- No measured performance, battery-life or thermal result is available for the MacBook Air M4.
- Two reviewers can agree on a mistake. An accepted candidate still needs the independent checks appropriate to its task.
