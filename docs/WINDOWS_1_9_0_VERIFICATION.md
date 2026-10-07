# Windows 1.9.0 verification record

[← Converge](../README.md) · [Project studio guide](STUDIO_GUIDE.md) · [Release notes](RELEASE_NOTES.md)

## Delivery scope

**The Windows x64 portable candidate is built and verified.** The final source suite, production archive, packaged integration and actual portable startup checks below identify the same delivered 1.9.0 build. No published 1.9.0 release, installer or Mac artifact is claimed here.

The [1.8.2 report](WINDOWS_1_8_2_VERIFICATION.md) is preserved as a separate historical record. Its passed checks and artifact hashes do not establish 1.9.0 verification.

## Recorded source evidence

Checks completed on **6 October 2026**:

| Gate | Current status |
|---|---|
| Studio services targeted tests | **14 / 14 passed**, zero failed or skipped tests |
| Full 1.9.0 source suite | **498 / 498 passed**, zero failed, cancelled or skipped tests |
| Source three-chat/studio integration | **20 workflow / 13 studio checks passed** using offline provider fixtures |
| Final portable production build | **Built: Converge-Portable-1.9.0-x64.exe** |
| Archive/source parity and font/service packaging | **38 / 38 production files match**, runtime package metadata matches |
| Final packaged integration | **20 workflow + 13 studio + 6 large-upload checks passed** against the same archive |
| Actual portable executable startup and clean Close | **Passed**, visible first paint, controls, three isolated views and teardown |
| Production PDF worker under packaged Electron | **Passed**, real one-page PDF parsing and raster rendering with packaged dependencies |
| Native chat and shell typography | **Passed**, actual Manrope glyphs under font-src 'none', zero font requests and monospace code preserved |
| Production dependency audit | **Zero reported production dependency vulnerabilities** at verification time |
| New authenticated provider task | Not performed or claimed for this update |
| Docker generated-program tests | **Unverified: Docker unavailable on the current host** |

The targeted service suite exercised actual Node syntax checks and Python AST checks while proving candidate side effects were not run. It parsed and rasterized a real one-page PDF through PDF.js **6.4.299** and the native canvas dependency. It rejected malformed PDFs, malformed CSV, oversized image headers, changed candidate identities and stale delivery reports.

Persistence tests saved, loaded, exported and imported a complete coordinator envelope with source bytes, two distinct revisions of the same filename and the selected revision identity. They checked atomic checkpoint metadata, SHA-256 blob corruption detection, browser credential/request-state exclusion, ZIP CRC rejection and archive member validation. Delivery tests checked the actual ZIP contents, file identities, manifest hashes and recorded partial status.

Container command tests checked network and filesystem restrictions, fixed installed-image identity, resource limits and timeout cleanup using an injected process runner. **Those tests do not establish actual Docker execution.** Actual generated-program tests remain unverified on this host.

## Artifact identity

| Item | Recorded value |
|---|---|
| Filename | `Converge-Portable-1.9.0-x64.exe` |
| Platform | Windows x64 |
| Final file size | **156,129,370 bytes** |
| Final executable SHA-256 | `ad2e51a7ef148efd256cfff42ea3412e9d030e6b94f2736ec22cadd6ffdc7dcf` |
| Production `app.asar` SHA-256 | `004243cb81350a30384328ca204aa12773fdff8e31cca3864e59f3b2d9808353` |
| Source/package parity | **38 matching production files** |

The native startup report binds the actual portable wrapper to this executable hash. Every packaged gate binds the same archive hash. The [machine-readable summary](evidence/windows-1.9.0.json) records the observed checks and their scope.

The final native upload check sent one **104,857,600-byte PDF** through the sidebar picker to the boss and both worker file inputs. All three independently recomputed its SHA-256, each received one input change, and each transfer used **134 bounded chunks** followed by one commit. The sidebar returned to ready state and all three pages closed cleanly. Remote upload acceptance and large generated-file downloads were not tested.

The studio check completed four genuine local file-revision cycles under controlled model replies. It checked the fresh right-worker audit, actual syntax parser result, exact same-name revision previews, issue history, archive round-trip, restoring earlier bytes, delivery manifest hashes and reconnecting without stale requests. A generated side-effect marker remained absent: the candidate program was never executed on the host.

Final review rules reject a worker certifying its own fix, and explicit passing-program-test conditions require executed evidence. Informational unexecuted-program coverage remains labelled unverified during a static-only file review; it cannot satisfy a requested test gate.

## What each verification layer means

Model review, manual assessment and executed local checks retain distinct evidence labels. Local reports name the selected candidate and exact file hashes. Changing a task or revision invalidates current acceptance; loading a saved project restores local outputs and history without restoring browser authentication or pending requests.

The optional fresh audit opens a new **right worker conversation** carrying the selected candidate, exact files, acceptance contract and findings. Its verdict remains model evidence. Controlled fixture coverage can establish the app's orchestration and ownership rules; it does not establish the quality of an authenticated provider answer.

Static checks parse supported syntax and formats. PDF checks report both page parsing and bounded rendering coverage. Rasterization success does not establish aesthetic layout quality, clipping, factual accuracy or the quality of pages outside the render sample. Native image decoding establishes readability and dimensions. Unsupported checks stay unverified.

Project and delivery exports are separate formats. Project archives retain local task/source/revision data and exact blob identities; delivery packages retain the current candidate, verification logs, requirement and issue status, limitations and file manifest. Neither archive serializes browser credentials or live request ownership.

## Practical limits

The portable is unsigned. Installer upgrades, a 1.9.0 Mac build, live account behavior and a real one-hour remote model run were not exercised. Long-task scheduling used controlled clocks and localhost monitoring. Docker execution is unavailable on this host. These limits are retained in the delivery summary; worker agreement does not guarantee universal correctness or profitability.
