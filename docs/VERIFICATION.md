# Converge 1.6.5 verification

[← Project](../README.md) · [Release notes](RELEASE_NOTES.md)

**Recorded on 2 October 2026 · Asia/Dhaka · Windows x64**

This public record summarizes completed checks without publishing authentication material, account screenshots, private provider traces or machine-specific paths. Controlled fixtures, actual native observations, authenticated provider behavior and independent artifact checks have separate scopes.

The numbers below describe the recorded release gates. For public source, a historical live parser excerpt was replaced by a synthetic fixture, and its test title/comment was updated without changing assertions. Runtime/build files are unchanged. Private live-session logs remain excluded; source-publication checks are recorded separately from these release checks.

## Summary

| Check | Result | Scope |
|---|---|---|
| Final automated suite | **351 / 351 passed** | App/shared-engine tests; no failures, cancellations, skips or todos |
| Frozen input audit | **23 inputs unchanged** | No source drift during the final gates |
| Windows build | **Passed** | Installer and portable artifacts produced; no automatic publishing |
| Archive/source parity | **18 runtime files plus metadata matched** | Built runtime matches frozen source |
| Packaged workflows | **24 / 24 passed** | Actual archive with controlled local replies |
| Windows version resources | **1.6.5** | Read-only executable metadata check |
| Actual unpacked executable | **Visible v1.6.5 startup and Close passed** | Built native shell, not development launcher |
| Live GPT 5.6 High file task | **Agreed at round 4 on C3** | Fresh authenticated Normal chats; exact files relayed |
| Native Save | **Byte-identical to accepted C3** | Actual Windows Save dialog and output comparison |
| Independent final Python audit | **1,244 / 1,244 passed** | Exact accepted/saved file, recorded cases |
| Fresh installer installation | **Not performed** | No installation claim |
| Portable wrapper startup | **Not performed** | No wrapper-startup claim |

## Automated and packaged checks

The final suite ran **10:29:19.289–10:30:20.042 Asia/Dhaka**, taking **60.752 seconds**, with exit code 0. All 351 tests passed and all 23 frozen production inputs remained unchanged.

The final preload/build/parity/packaged sequence ran **10:30:39.215–10:39:19.237 Asia/Dhaka**, taking **520.021 seconds**. Each process exited 0:

| Stage | Elapsed |
|---|---:|
| Generate production page preload | 0.178 s |
| Build Windows installer and portable | 131.774 s |
| Compare archive source and artifact identities | 10.625 s |
| Packaged controlled desktop fixture | 377.363 s |

The package identified version 1.6.5. All 24 workflow checks passed with no frozen-input drift. Covered workflows include mode setup, bounded errors, uploads, review progression, candidate/file requirements, cancellation/reset, session recovery and desktop geometry.

The fixture generated shell screenshots. Two requests to capture embedded native pages returned `UnknownVizError`; those missing images are **not** counted as passed native-page visual evidence. Separate physical observation establishes the actual built shell's visible startup.

The public screenshots under `docs/images` are sanitized layout fixtures with sample activity. They do not demonstrate an authenticated review by themselves.

## Live discovery and the Python fix

An initial authenticated arithmetic check answered **4 + 6 = 10**, with two independent drafts followed by two verification steps. Both reviewers accepted unchanged C1, with no issues or error. This check occurred **before** the final Python-download fix and is retained as separate evidence, not a post-fix file-flow test.

The initial live Python task exposed an actual defect: a native `.py` download used MIME type `text/x-python`, while the capture broker expected the app's canonical `text/plain` representation. That initial run was not counted as a successful file review.

The fix in `src/browser/downloads.js` accepts `text/x-python` **only** for a selected `.py` file whose declared app representation is `text/plain`. Owner/request identity, filename, size, readable Unicode, HTML rejection, cancellation and cleanup checks remain. Three regression tests reproduced the defect before the fix; all **18 targeted download tests** passed after it. The final full suite then passed 351 tests.

## Fresh authenticated file review

After the fix, the approved session export was imported through the actual Windows JSON picker into a new app-owned session. Two fresh **Normal** chats opened. Their visible model menus both selected **GPT 5.6 High**; Pro was not used.

The synthetic task repaired a Python interval-merging function. It required sorted merged outputs, correct containment and touching behavior, empty and single-pass input support, invalid-input rejection, no input mutation, a complete downloadable `.py` file and at least four full improvement rounds.

The run started at **10:36:27.241** and reached agreement at **10:55:45.690 Asia/Dhaka**: **19 minutes 18.449 seconds**.

| Measure | Observed |
|---|---:|
| Independent drafts | 2 |
| Ordinary peer checks | 8 |
| Full review rounds | 4 |
| Extra revised-file production turn | 1 |
| Total transcript turns | 11 |
| Actual candidate revisions | 2 |
| Accepted final candidate | C3, accepted by both reviewers |
| Unresolved findings / pending requests / final errors | 0 / 0 / 0 |

Nine post-draft transcript entries use the review role. One is the bounded revised-file production turn, so it is not counted as a ninth ordinary peer check. A missing-replacement finding was resolved. Both pages finished authenticated, ready and idle.

### Candidate changes

| Candidate | File bytes | Recorded change |
|---|---:|---|
| C1 | 1,585 | First complete corrected Python candidate |
| C2 | 1,530 | Removes an unnecessary slice allocation |
| C3 | 1,643 | Clarifies documentation and exported-file metadata; behavior remains the same as C2 |

The C3 documentation revision is not described as a new algorithmic improvement. Four native Python downloads completed, including the two drafts and the replacements. Captured candidate files were verified and sent to the peer reviews.

### Exact Save and independent audit

The actual bottom Save control opened **Save final reviewed file**. The app saved `merge_busy_windows.py` and displayed success. A direct byte comparison confirmed the native-saved output equaled archived C3 and the final candidate metadata:

```text
File: merge_busy_windows.py
Bytes: 1643
SHA-256: eccd79bfb3efba84ce9685b77d56a66e61153817300f899e682153a078bf3a2b
```

An independent audit of those exact bytes passed **1,244 required checks** under **Python 3.14.2**. It included **1,200 seeded randomized cases** against a separate **O(n²) overlap/touch graph connected-components oracle**, plus fixed/invalid-input cases covering containment, touching, duplicate and zero-length intervals, extreme numbers, immutable inputs and single-pass iterables. The randomized seed was `16520261002`.

Source inspection supports **O(n log n)** time and **O(n)** auxiliary space. These bounds were reviewed structurally; they were not proven by a timing benchmark. Passing the recorded cases does not prove every possible input.

The authenticated run used the final frozen source through the development launcher. Package parity establishes the built runtime uses that same source. It does not mean the authenticated run occurred inside the separate built-app startup smoke test.

## Native window observations

The source app showed no blue native caption, a transparent custom header and the redesigned opaque drawer. Maximize/Restore changed their accessible labels, Minimize was confirmed and the live run continued after restoration. Closing the owned earlier test window removed that window without touching Chrome.

The actual final **unpacked built executable** was separately launched in an isolated test profile. Its visible badge read **v1.6.5**. The transparent header, taller chat regions, opaque drawer and direct Import JSON file control were observed. Its custom Close removed only that built window; the source live window and Chrome remained.

This confirms visible unpacked built-app startup and Close. It does not confirm a fresh installer installation, portable-wrapper startup or authenticated provider use inside that built-window smoke check.

## Release artifact identities

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Converge-Setup-1.6.5-x64.exe` | 114,325,118 | `495965b9d78cd717947a5b1ad9e2fb1c3e27bf1b47192c187367618a674ddc05` |
| `Converge-Portable-1.6.5-x64.exe` | 114,028,112 | `c5e371d596311f1f7f7534bf36b26a87d3e64960433505974ad8efbc93cf0994` |
| `resources/app.asar` | 3,416,571 | `71080e5c7d6a349c15577b16d891b531f5b448366e6217b6d0fe8c8ebaefb55e` |

Windows FileVersion is 1.6.5 on the Setup, Portable and unpacked executables. ProductVersion is 1.6.5 on the two wrappers and 1.6.5.0 on the unpacked executable. The wrappers are unsigned.

To check a downloaded wrapper on Windows:

```powershell
Get-FileHash -Algorithm SHA256 .\Converge-Setup-1.6.5-x64.exe
Get-FileHash -Algorithm SHA256 .\Converge-Portable-1.6.5-x64.exe
```

## Practical limits

- Controlled replies establish app behavior within the fixture's scope; they are separate from live provider checks.
- Two reviewers agreeing is not a proof of 100% correctness or profitability.
- The provider can change its page structure, authentication, upload rules and model availability.
- Both pages share the account's service limits.
- Native trading compilation/backtests and six-month profitability are not established by this Python verification. The earlier trading-performance target remains unfinished.
- The animation engine was retained in 1.6.5. No new GPU saving was measured or claimed.
- Historical release records describe their own builds and should not be pooled into the current result.
