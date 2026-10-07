# Session setup

[User guide](USER_GUIDE.md) · [Mac setup](MACOS_GUIDE.md) · [Recovery](MODEL_ERROR_RECOVERY.md)

## Current desktop connection

Converge **1.9.9** embeds three ChatGPT browser pages: the boss and two workers. The current desktop connection imports your own browser-session export. It does not require an API key and does not use the older API/Codex adapters retained in the source tree.

Converge is an independent application. Session import does not grant a new account, subscription, model entitlement or usage allowance. Its browser adapter depends on the provider's current page behavior.

## Import your session

1. Open the controls drawer.
2. Choose **Import JSON file** and select your current ChatGPT cookie export. Pasting the JSON array is also available.
3. Choose **Temporary**, **Normal** or **Work mode**.
4. Press **Open the team** and allow all three pages to become ready.
5. Select the model independently in the boss and each worker page.

Chat modes and models depend on the account. The app reports loading, authentication or unsupported-mode problems instead of treating them as completed work. A loading error can occur independently of whether the export parses successfully.

## Session lifetime

The imported session uses Converge's in-memory browser profile. Converge does not read, modify or sign out the Chrome profile. Reset retains the imported session while creating fresh team conversations.

Closing the workspace clears its imported session. On Mac, opening a fresh workspace through application activation requires importing again. Project recovery is separate: saved projects retain task history and file bytes, not cookie values or live request state.

## Keep exports private

Treat session exports as credentials. Import them through the app's setup controls; keep them out of Git, public screenshots, issue attachments and delivery archives.

Public release source, verification fixtures and manuals contain no session exports. Project archives exclude browser authentication, but they can contain your task inputs and generated files. Inspect them before sharing.

## If setup fails

| Symptom | Action |
|---|---|
| JSON is rejected | Choose the JSON-array export for your own ChatGPT session |
| Signed-out or expired session | Import a current export, then open the team again |
| Loading timeout | Inspect the page and network status; retry opening the team after resolving the reported blocker |
| Account challenge or limit | Complete the provider's requested action or wait for the allowance to recover |
| Only one page is ready | Resolve that page's state before starting coordinated work |
| Work mode is unavailable | Choose a mode that the account exposes |
| Model differs between pages | Select it separately on all three pages |

An accepted export is not proof that the provider will accept a session or a long-running task. Do not repeatedly replay a task after ambiguous submission; use the app's owned-request recovery and retained results.

## Historical adapters

Earlier prototypes and authentication research are preserved in [historical authentication notes](AUTH_OPTIONS_HISTORY.md). Their adapters, model examples and integration proposals describe those earlier implementations and are not current setup instructions.
