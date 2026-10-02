# Converge for Chrome

Converge for Chrome v0.4.0 is a local extension that opens two ChatGPT pages in side-by-side Chrome windows. It uses the Chrome profile where you installed it, so there is no cookie export or separate app sign-in. A control panel sends the same question to both pages, passes answers and accessible generated outputs across, asks for concrete critiques, and stops when both reviewers accept the same candidate, you press Stop, or a configured limit is reached.

## Install locally

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this `chrome-extension` folder.
4. Pin **Converge for Chrome** and click its icon to open the side panel.

Do **not** open `panel.html` as a file in a Chrome tab. That only shows a preview; Chrome's extension controls are unavailable there. If you downloaded the ZIP, extract it first and select the inner `chrome-extension` folder that contains `manifest.json`.
If you already loaded an earlier unpacked version, click **Reload** on its card in `chrome://extensions` after replacing the files.

No Chrome cookie or API key is copied into the extension. It does not request the Chrome cookies permission. Chat messages use the visible composer and Send control. File relay reads only the exact visible download link; it does not discover or construct hidden service endpoints.

## Use

1. Click **Open two chats**. Converge arranges two ChatGPT Chrome windows side by side on the current display. It attempts **Temporary → Unpersonalized** only if those controls clearly expose their state.
2. In each visible page, select the model you want. If either privacy setting could not be verified, choose **Temporary → Unpersonalized** yourself before the first message, then click **Check pages**. Use **Maximize A** and **Maximize B** if the Temporary button is hidden by the narrow split view, then **Restore split**. Tick the panel's A and B checkboxes only after you have verified those settings in the visible pages.
   If maximizing B covers the panel, use **Alt+Tab** to return to the left Chrome window and press **Restore split**.
3. Enter a question, optional review direction, and round limit. Use **Attach to both** for source files. **Automatically share generated images and files** is enabled by default and is experimental. Turn it off for a text-only exchange. Click **Start exchange**.
4. Watch the two pages and the control panel. Press **Stop** at any time, including while the first prompt or media transfer is pending. Copy or export the best current text answer. **View original outputs** opens the page containing the current candidate's pictures or files. Click **Open two chats** for each new question so the independent drafts start without previous chat history.

The extension treats page text and files as task data, not as commands to the extension. It does not intentionally read or save account cookies. Run state is kept in Chrome's in-memory extension session storage, which is cleared when the browser session ends.

## Current limits

- ChatGPT's page structure changes. If the composer, send control, or new completed answer cannot be recognized, Converge stops and shows the reason. An unknown privacy state requires your visible-page confirmation before starting. It does not silently copy an older answer.
- **Attach to both** supports up to five PNG/JPEG/WebP/GIF, PDF, TXT/Markdown/CSV/JSON, DOCX/XLSX/PPTX files (12 MB per file, 24 MB total). It confirms image uploads by new thumbnails and documents by visible names, and waits for exposed upload progress to finish. If an attempt fails, open two fresh chats to reset uncertain attachments; you can then add the same files manually in both pages if their picker is not exposed.
- Generated media sharing is **experimental and not yet verified on live ChatGPT**. It copies a completed response's readable displayed images as PNG and supported visible download links into the next reviewer’s composer before sending the review. A revised image/file creates a new candidate and resets earlier acceptance. Browser restrictions, expired links, redirects, unsupported formats, missing controls, and unavailable images stop the exchange with an error. Videos, audio, tool canvases, and outputs accessible only through a separate viewer are not supported. Images may be re-encoded; the original remains in ChatGPT. The Markdown answer export contains text and output names, not the media itself.
- Generated output bytes are read during transfer and are not written to session storage. Session storage retains output names and source request IDs so a sleeping extension worker can resume a transfer from the original page. Reloading or closing that page can make its outputs unavailable.
- ChatGPT may not expose a reliable Temporary or Unpersonalized state. Automatic selection is attempted only for a unique control whose state can be checked; otherwise you must select and confirm the mode yourself.
- The two pages must remain open. Navigation, login prompts, limits, or a page that never finishes answering can interrupt the run.
- Agreement is a review signal, not a guarantee of correctness.
- Draft and review uncertainties remain tracked as unresolved issues until a reviewer explicitly resolves them. A replacement reopens earlier findings for a regression check. A malformed or image-only response cannot count as acceptance.
- The adapter has local fixture tests. Live ChatGPT page automation requires testing in a Chrome profile where the user permits access; it was not verified on the user's live pages during this build.

If a page still shows an error, click **Copy safe page diagnostics** and send the copied JSON with the exact error. The diagnostics include only control states and counts; they omit chat text, files, cookies, and account details.

## Local checks

From the parent project folder:

```powershell
node --test chrome-extension/test/*.test.js
node_modules/.bin/electron.cmd scripts/qa-extension-dom.js
node_modules/.bin/electron.cmd scripts/qa-extension-panel-flow.js
node_modules/.bin/electron.cmd scripts/qa-extension-pipeline.js
```

The extension has no build step. `manifest.json`, `background.js`, `content.js`, `panel.html`, `panel.css`, `panel.js`, and `assets` are the installable files.
