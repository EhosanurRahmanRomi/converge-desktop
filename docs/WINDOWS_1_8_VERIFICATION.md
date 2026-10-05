# Windows 1.8 verification

Converge 1.8.0 was built and checked on Windows on 5 October 2026. This record describes the new boss workspace. Earlier Windows and Mac records describe their own releases.

## Recorded checks

| Check | Result |
|---|---|
| Final source suite | **405 / 405 passed**, sequential execution, no skipped tests |
| Packaged production workflows with local replies | **15 / 15 passed** |
| Packaged source parity | **21 runtime files** matched source bytes; package version is 1.8.0 |
| Actual built Windows executable | Native window opened, showed **v1.8.0** and the three-character workspace, and closed through its own Close control |
| Live GPT-5.6 Sol High file task | Boss directed **four work cycles**, applied a queued user instruction, and both workers accepted the same **C4** candidate |
| Live generated files and native Save | Two actual downloadable Python files were relayed, checked and saved; saved hashes matched the accepted files |
| Independent local check of saved files | **16 / 16 Python tests passed**, including a deterministic **320-case** test; compilation succeeded |
| Live fixed-answer follow-up | Same three chats returned **10** for `4 + 6` after one work pair and one final verification pair; old file requirements were cleared |
| Native chat backgrounds | Horror, Alien and Night captured with distinct images and visibly different backgrounds |
| Character and panel controls | Robot, Explorer and Spirit render; boss drawer opens/closes and returns focus correctly |

An earlier concurrent suite run encountered three legacy UI test timeouts while several Electron windows and live chats were active. The final sequential run passed all 405 tests with their existing deadlines. No timeout was increased to produce the passing result.

## What the packaged fixture exercised

The fixture uses the real packaged host, shell and sandboxed page preload with isolated local pages. It checks source uploads to all three chats, separate boss assignments, worker results and generated-file delivery to the boss, minimum work cycles, exact candidate verification, native Save bytes, queued instructions during boss and worker generation, same-chat follow-ups, Stop, Reset, three chat modes, malformed controller responses, backgrounds, characters and focus restoration.

The fixture is deterministic transport evidence. It does not establish model answer quality or account-specific Work mode availability. Its native file selection is supplied by an isolated localhost dialog hook; the live saved-file check separately used the real Windows Save dialogs.

## Live file task

All three page model selectors were observed as **5.6 Sol High**. The task requested a finite numeric clamp function and tests, including arbitrary-size Python integers. During the run, an added instruction requested at least 200 deterministic randomized cases and stronger rejection coverage. The boss discarded its stale pending plan and incorporated that instruction.

The implementation remained stable when no defect was found. The tests improved through successive actual file revisions: huge-integer boundary checks, 320 randomized cases, and a final expected-value calculation using `min`/`max` instead of repeating the implementation's branches. Both workers checked the exact same final hashes before the boss completed the task. The saved output was then inspected and tested independently on this Windows host.

| Saved file | SHA-256 |
|---|---|
| `clamp_value.py` | `e675182627cf277390965c0b4fe76a45fa9c6a6966c2ccd83486bb949c08291c` |
| `test_clamp_value.py` | `b416108424dfbbd7e1980014afd319ca8dc4ca15989e10b3d11e9238f7d6e78c` |

The live file check ran from the production source under the matching development Electron runtime. The final packaged fixture separately checked the rebuilt archive, including the subsequent file-request and focus fixes. Live sources contained no user attachments; only the test task and its generated files were exchanged.

## Artifact identities

| Artifact | SHA-256 |
|---|---|
| Windows installer | `30c417f95a1375715c24cbf0176925e433e625008c0fde22e1af6570d3368c64` |
| Windows portable executable | `b4db8cb252ae348c7e2c1fc9f400e7493070df0c4db4ae9f49ba73a9a4e83187` |
| Tested `app.asar` | `1c22aee70757dddeaf3687dfde7343193249428e359d9ee5ed78b4477143ff31` |

## Scope

- The Windows installer and portable wrapper were built; installation, upgrade and portable extraction were not exercised. The built unpacked application's own executable was opened and closed visibly.
- No macOS 1.8 binary was built or tested. The published Mac 1.7 release remains separate.
- Chat backgrounds remain still; decorative motion suspends when hidden or minimized and can be disabled. A quantitative GPU benchmark was not performed.
- A successful finite task and two agreeing reviewers do not establish universal correctness. Provider changes, account limits, unsupported downloads and unavailable tools can still stop a run. Trading performance requires actual market data and backtest evidence.

See the [boss guide](BOSS_WORKSPACE.md), [architecture](BOSS_ARCHITECTURE.md) and [machine-readable evidence](evidence/windows-1.8.json).
