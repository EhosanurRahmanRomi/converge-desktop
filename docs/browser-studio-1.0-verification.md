> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Browser Studio 1.0 verification

Date: 2026-10-01. Windows x64, Electron 44.5.1.

## Final build checks

- `npm test`: **98 passed, 0 failed**.
- Full packaged desktop integration: **10 stages passed**. The actual production modules, shell and sandboxed preloads were loaded from `dist/win-unpacked/resources/app.asar`; nine packaged production files match the latest source by SHA256.
- Native application and UI bootstrap both report **1.0.0**. See `desktop-cookie-packaged-qa-result.json` for the archive hash and precise test scope.
- Both `Converge-Setup-1.0.0-x64.exe` and `Converge-Portable-1.0.0-x64.exe` were built successfully.
- The actual packaged `Converge.exe` was opened through Windows and visually inspected on this computer. Its cookie import field, two empty page panes and controls rendered correctly at the current display size.

## Live ChatGPT test

The user authorized opening fresh test chats in their existing signed-in Chrome profile, with the explicit condition that Chrome must not be logged out. Testing used the already installed extension as a host for the same page bridge and debate coordinator shipped by the desktop app. Chrome account/security settings and authentication storage were not changed.

Question: **What is 17 × 23? Verify using two methods. Keep the answer brief.**

Observed live sequence after Start, without intervening Send clicks or manual transfers:

1. Chat A submitted its prompt and returned 391, with distributive checks 340 + 51 and 230 + 161.
2. Chat B submitted independently and returned 391 using the same two checks.
3. The app transferred candidate C1 to B. B returned a JSON accept record with no issues or uncertainties.
4. The app transferred C1 to A. A also returned a JSON accept record with no issues or uncertainties.
5. The panel showed **Both reviewers accepted this answer**, Round 1, four transcript records and the final answer. The exchange stopped automatically.

This verifies real text submission, answer detection, automatic relay, exact-candidate acceptance and automatic termination for one short live question. It does not verify arbitrary tasks, every model, live media transfer, or authentication inside Electron after a cookie import.

## Failures found and corrected

- The supplied recording showed paragraph formatting made the old full-prompt check reject valid input before Send. Validation now ignores rich-editor whitespace differences while preserving words, punctuation and the tracking ID.
- The live page exposes Temporary state through a **Turn off temporary chat** control, rather than an explicit selected attribute. It exposes the current **Unpersonalized** choice in the main page. The bridge now recognizes these visible states and attempts their setup automatically before the first message.
- Composer, header and privacy dropdown hydrate separately. Preparation waits for each visible control within a bounded period.
- The first live Send test timed out with the full prompt unsent. Native Send worked. Waiting for the current editor and enabled Send control to settle, reacquiring them after React updates, then clicking once fixed the next full live run. Failed submission never triggers a blind second Send.
- Manual privacy confirmations are revoked on fresh layouts and reloads, including desktop panes whose internal IDs are reused.
- Valid cookie import followed by page failure retains the app's imported-session state and recovery controls.
- Source attachment status is displayed correctly. Stop remains accessible when the sidebar is hidden.

## Local desktop integration

`scripts/qa-desktop-cookie.js` runs the actual desktop shell, guarded Electron IPC, sandboxed page preloads and two native WebContentsViews against localhost fixtures. All remote traffic is blocked. Authentication cookies and model responses in this test are fictitious.

Verified: import-field clearing, cookie import/open/setup, delayed modern privacy UI, privacy revocation, fresh-layout revocation, native pane expansion/restoration, five automatic submissions with revised generated image/document transfer and dual acceptance, Stop during unfinished download, Stop on both generations, and clearing only the app session. See `desktop-cookie-qa-result.json` for the exact latest stages.

The fixture does not prove that ChatGPT will accept an imported session. Native child screenshot capture returned UnknownVizError; shell screenshots omit those child pixels. The test asserts actual native-view bounds and obtains reply/attachment state from the fixture instead of presenting a fabricated composite.

## Remaining limits

- The final Windows app requires a current cookie export imported locally. Its separate live authenticated session still needs a real test.
- Expired sessions, sign-in redirects, account limits and browser verification challenges can prevent a run. The app does not bypass these controls.
- Generated image/file relay has local integration coverage but no successful live media test in this verification.
- Supported output limits: five files, 12 MB each, 24 MB total. Not all ChatGPT output types or download behaviors are supported.
- Agreement is a review outcome, not a guarantee of correctness or an increase in the underlying model's reasoning setting.
- The installer is unsigned. Session, transcript and cookie state are in memory; app exit loses them.
