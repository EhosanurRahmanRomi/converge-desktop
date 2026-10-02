> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge for Chrome 0.4.0 — verification

Date: 2026-10-01. This report covers local verification, not a live ChatGPT run.

## Changes

- Stop stays available while another control action is pending. Errors and timeouts cancel both pages; a late response or delayed media export cannot restart the run.
- Long rich-editor prompts are checked with browser paragraph normalization. A submitted user message must match the actual prompt; an old conversation cannot satisfy submission by its message count.
- Uploads require new image previews or new document-name evidence and wait for exposed processing indicators. Unconfirmed uploads block Start until fresh chats are opened.
- Experimental generated-output sharing captures completed, readable displayed images as PNG and supported visible download links. It attaches the actual files before sending each review. No bytes, cookies, or download URLs are written to extension session storage.
- Repeated exports hash the actual file bytes and reject a changed file. New output sources create a new candidate, revoke earlier acceptance, and reopen previous findings for review.
- Draft and review uncertainties remain unresolved until explicitly cleared. Invalid issue descriptions cannot be silently dropped into an acceptance.
- Shared question/settings sync between panels. Running controls reflect and retain the actual run's settings. Output names render safely and link back to their original page.

## Checks

- `npm test`: 76 passed, 0 failed. This includes 45 extension tests and 31 tests for the existing desktop code.
- `scripts/qa-extension-panel-flow.js`: 13 checks passed against rendered HTML/CSS/JavaScript in an isolated Chromium profile, including immediate Stop, shared settings, output source selection, failed uploads, and 320 px layout.
- `scripts/qa-extension-dom.js`: real Chromium editor/Send/file-picker behavior, multiline prompts, upload processing, image-only response, PNG canvas export, incoming image attachment before the next prompt, exact visible CSV link, unreadable canvas failure, and late cancelled dispatch.
- `scripts/qa-extension-pipeline.js`: actual panel, coordinator, and content scripts over a local fixture transport. Two independent drafts lead to PNG/TXT transfers, a challenged candidate C1, replacement C2, an explicit resolved issue, and fresh acceptance of C2 by both reviewers. Five replies and three transfers of two files were checked. Media bytes were absent from saved state.
- Script syntax checks passed. The local preview was rendered and inspected; the panel's preview-only guard remains active outside Chrome's extension context.

All browser fixtures use separate local profiles. They do not sign in, read exported cookies, or access live ChatGPT.

## Remaining validation

The live ChatGPT page was not accessed in this build. Its current editor, privacy controls, image rendering, download controls, account limits, and upload behavior can differ from the fixtures. Generated-media sharing remains experimental. Temporary and Unpersonalized modes require user confirmation when the visible page does not expose reliable state. Unsupported or unreadable outputs stop the run; video, audio, and separate tool viewers are unsupported.

Agreement between two reviewers does not establish 100% correctness.
